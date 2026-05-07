import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Order, Trade } from '../models';
import { PriceLevel } from '../price-level/price-level';

export interface SingleLevelMatchResult {
  trades: Trade[];
  takerRemainingQty: number;
  levelExhausted: boolean;
  exhaustedMakers: Array<{ id: string; traderId: string }>;
  partialMaker: { id: string; traderId: string; remainingQty: number } | null;
}

@Injectable()
export class MatchingEngine {
  /**
   * Walks the given price level from front to back, consuming resting orders
   * against the incoming order. Mutates the level directly via dequeue/prepend.
   * Returns null if the incoming order cannot match at this level:
   * spread too wide, level empty, or self-trade at the front.
   * Does not touch the OrderBook.
   */
  match(incomingOrder: Order, level: PriceLevel): SingleLevelMatchResult | null {
    const crossable =
      incomingOrder.side === 'buy'
        ? level.price <= incomingOrder.price
        : level.price >= incomingOrder.price;

    if (!crossable) return null;

    const frontOrder = level.peek();
    if (!frontOrder) return null;
    if (frontOrder.traderId === incomingOrder.traderId) return null;

    const trades: Trade[] = [];
    const exhaustedMakers: Array<{ id: string; traderId: string }> = [];
    let partialMaker: SingleLevelMatchResult['partialMaker'] = null;
    let takerRemaining = incomingOrder.remainingQty;

    while (takerRemaining > 0) {
      const maker = level.dequeue();
      if (!maker) break;

      if (maker.traderId === incomingOrder.traderId) {
        // Self-trade encountered mid-level: restore and stop
        level.prepend(maker);
        break;
      }

      const fillQty = Math.min(takerRemaining, maker.remainingQty);

      trades.push({
        id: uuidv4(),
        ticker: incomingOrder.ticker,
        buyOrderId: incomingOrder.side === 'buy' ? incomingOrder.id : maker.id,
        sellOrderId: incomingOrder.side === 'sell' ? incomingOrder.id : maker.id,
        price: level.price,
        quantity: fillQty,
        timestamp: Date.now(),
      });

      takerRemaining -= fillQty;
      maker.remainingQty -= fillQty;

      if (maker.remainingQty > 0) {
        level.prepend(maker); // Partially filled: restore to front with updated remainingQty
        partialMaker = { id: maker.id, traderId: maker.traderId, remainingQty: maker.remainingQty };
        break;                // Taker is satisfied
      }
      // Maker fully consumed — record for order.completed emission upstream
      exhaustedMakers.push({ id: maker.id, traderId: maker.traderId });
    }

    return {
      trades,
      takerRemainingQty: takerRemaining,
      levelExhausted: level.isEmpty(),
      exhaustedMakers,
      partialMaker,
    };
  }
}

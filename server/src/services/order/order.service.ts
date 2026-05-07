import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { Order, Side, Ticker, Trade } from '../../domain/models';
import { MatchingEngine } from '../../domain/matching-engine/matching-engine';
import { OrderBookRegistry } from '../order-book-registry/order-book-registry.service';
import { Events } from '../../events';

export type OrderStatus = 'open' | 'partial' | 'filled';

export interface PlaceOrderInput {
  traderId: string;
  ticker: Ticker;
  side: Side;
  price: number;
  quantity: number;
}

export interface PlaceOrderResult {
  order: Order;
  trades: Trade[];
  status: OrderStatus;
}

export interface CancelOrderResult {
  orderId: string;
  cancelled: boolean;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly registry: OrderBookRegistry,
    private readonly engine: MatchingEngine,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  placeOrder(input: PlaceOrderInput): PlaceOrderResult {
    const order: Order = {
      id: uuidv4(),
      traderId: input.traderId,
      ticker: input.ticker,
      side: input.side,
      price: input.price,
      quantity: input.quantity,
      remainingQty: input.quantity,
      timestamp: Date.now(),
    };

    const book = this.registry.getOrCreate(order.ticker);
    const trades: Trade[] = [];

    while (order.remainingQty > 0) {
      const level =
        order.side === 'buy' ? book.bestAskLevel() : book.bestBidLevel();
      if (!level) break;

      const result = this.engine.match(order, level);
      if (!result) break;

      order.remainingQty = result.takerRemainingQty;
      trades.push(...result.trades);

      result.trades.forEach(trade => this.eventEmitter.emit(Events.TRADE_EXECUTED, trade));
      result.exhaustedMakers.forEach(maker =>
        this.eventEmitter.emit(Events.ORDER_COMPLETED, { orderId: maker.id, traderId: maker.traderId }),
      );

      if (result.partialMaker) {
        const filledQty = result.trades.reduce((sum, t) => sum + t.quantity, 0);
        this.eventEmitter.emit(Events.ORDER_PARTIAL_FILL, {
          orderId: result.partialMaker.id,
          traderId: result.partialMaker.traderId,
          filledQty,
          remainingQty: result.partialMaker.remainingQty,
        });
      }

      if (result.levelExhausted) {
        book.removePriceLevel(level.price, order.side === 'buy' ? 'sell' : 'buy');
      }

      this.eventEmitter.emit(Events.ORDERBOOK_UPDATED, { ticker: order.ticker, snapshot: book.snapshot() });
    }

    if (order.remainingQty > 0) {
      book.addOrder(order);
      this.registry.registerOrder(order.id, order.ticker);
    }

    return { order, trades, status: this.deriveStatus(trades, order) };
  }

  cancelOrder(orderId: string): CancelOrderResult {
    const ticker = this.registry.findTickerByOrderId(orderId);
    if (!ticker) return { orderId, cancelled: false };

    const book = this.registry.get(ticker);
    if (!book) throw new Error(`Invariant violated: book not found for ticker ${ticker}`);

    const cancelled = book.cancelOrder(orderId);
    if (cancelled) {
      this.registry.unregisterOrder(orderId);
      this.eventEmitter.emit(Events.ORDERBOOK_UPDATED, { ticker, snapshot: book.snapshot() });
    }

    return { orderId, cancelled };
  }

  private deriveStatus(trades: Trade[], order: Order): OrderStatus {
    if (trades.length === 0) return 'open';
    if (order.remainingQty === 0) return 'filled';
    return 'partial';
  }
}

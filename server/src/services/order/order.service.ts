import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Order, Side, Ticker, Trade } from '../../domain/models';
import { MatchingEngine } from '../../domain/matching-engine/matching-engine';
import { OrderBookRegistry } from '../order-book-registry/order-book-registry.service';

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

      if (result.levelExhausted) {
        book.removePriceLevel(level.price, order.side === 'buy' ? 'sell' : 'buy');
      }
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
    if (cancelled) this.registry.unregisterOrder(orderId);

    return { orderId, cancelled };
  }

  private deriveStatus(trades: Trade[], order: Order): OrderStatus {
    if (trades.length === 0) return 'open';
    if (order.remainingQty === 0) return 'filled';
    return 'partial';
  }
}

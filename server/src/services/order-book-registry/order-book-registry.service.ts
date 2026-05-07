import { Injectable } from '@nestjs/common';
import { Ticker } from '../../domain/models';
import { OrderBook } from '../../domain/order-book/order-book';

@Injectable()
export class OrderBookRegistry {
  private readonly books = new Map<Ticker, OrderBook>();
  private readonly orderTicker = new Map<string, Ticker>();

  getOrCreate(ticker: Ticker): OrderBook {
    if (!this.books.has(ticker)) {
      this.books.set(ticker, new OrderBook(ticker));
    }
    // Non-null safe: has() check above guarantees the key exists
    return this.books.get(ticker)!;
  }

  get(ticker: Ticker): OrderBook | undefined {
    return this.books.get(ticker);
  }

  registerOrder(orderId: string, ticker: Ticker): void {
    this.orderTicker.set(orderId, ticker);
  }

  unregisterOrder(orderId: string): void {
    this.orderTicker.delete(orderId);
  }

  findTickerByOrderId(orderId: string): Ticker | undefined {
    return this.orderTicker.get(orderId);
  }
}

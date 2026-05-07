import { Injectable } from '@nestjs/common';
import { Ticker } from '../../domain/models';
import { OrderBook } from '../../domain/order-book/order-book';

@Injectable()
export class OrderBookRegistry {
  private readonly books = new Map<Ticker, OrderBook>();

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
}

import BTree from 'sorted-btree';
import { Order, OrderBookSnapshot, PriceLevelSnapshot, Side, Ticker } from '../models';
import { PriceLevel } from '../price-level/price-level';

type OrderIndexValue = {
  level: PriceLevel,
  side: Side,
}

export class OrderBook {
  private readonly bids = new BTree<number, PriceLevel>();
  private readonly asks = new BTree<number, PriceLevel>();
  private readonly orderIndex = new Map<string, OrderIndexValue>;

  constructor(public readonly ticker: Ticker) {}

  addOrder(order: Order): void {
    const tree = order.side === 'buy' ? this.bids : this.asks;
    let level = tree.get(order.price);
    if (!level) {
      level = new PriceLevel(order.price);
      tree.set(order.price, level);
    }
    level.enqueue(order);
    this.orderIndex.set(order.id, { level, side: order.side });
  }

  cancelOrder(orderId: string): boolean {
    const orderIndexValue = this.orderIndex.get(orderId);
    if (!orderIndexValue) return false;

    const { level, side } = orderIndexValue; 

    const removed = level.remove(orderId);
    if (removed) {
      
      this.orderIndex.delete(orderId);
      if (level.isEmpty()) {
        this.removePriceLevel(level.price, side);
      }
    }
    return removed;
  }

  // Read-only inspection — safe for any caller
  peekBestBid(): Order | undefined {
    const key = this.bids.maxKey();
    if (key === undefined) return undefined;

    return this.bids.get(key)?.peek();
  }

  peekBestAsk(): Order | undefined {
    const key = this.asks.minKey();
    if (key === undefined) return undefined;

    return this.asks.get(key)?.peek();
  }

  /**
   * Mutable access — only for the MatchingEngine during matching
   * Returns the live PriceLevel at the top of the ask side.
   * The caller may dequeue from it directly — ownership of dequeued orders transfers to the caller.
   */
  bestBidLevel(): PriceLevel | undefined {
    const key = this.bids.maxKey();
    return key !== undefined ? this.bids.get(key) : undefined;
  }

  bestAskLevel(): PriceLevel | undefined {
    const key = this.asks.minKey();
    return key !== undefined ? this.asks.get(key) : undefined;
  }

  removePriceLevel(price: number, side: Side): void {
    const tree = side === 'buy' ? this.bids : this.asks;
    tree.delete(price);
  }

  snapshot(): OrderBookSnapshot {
    const bids: PriceLevelSnapshot[] = [];
    this.bids.forEach((level: PriceLevel) => {
      bids.push(level.snapshot());
    });
    bids.reverse();

    const asks: PriceLevelSnapshot[] = [];
    this.asks.forEach((level) => {
      asks.push(level.snapshot());
    });

    return {
      ticker: this.ticker,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }
}

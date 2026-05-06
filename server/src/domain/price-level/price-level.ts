import { Order, PriceLevelSnapshot } from '../models';

export class PriceLevel {
  private readonly orders: Order[] = [];

  constructor(public readonly price: number) {}

  /**
   * Enqueues a copy of the order. The caller's reference cannot affect book state after this point.
   */
  enqueue(order: Order): void {
    this.orders.push({ ...order });
  }

  /**
   * Removes and returns the front order, transferring ownership to the caller.
   * The caller may mutate the returned object freely.
   */
  dequeue(): Order | undefined {
    return this.orders.shift();
  }

  remove(orderId: string): boolean {
    const index = this.orders.findIndex((o) => o.id === orderId);
    if (index === -1) return false;
    this.orders.splice(index, 1);
    return true;
  }

  /**
   * Returns a shallow copy. Callers cannot mutate the live order through this reference.
   */
  peek(): Order | undefined {
    return this.orders[0] ? { ...this.orders[0] } : undefined;
  }

  isEmpty(): boolean {
    return this.orders.length === 0;
  }

  totalQuantity(): number {
    return this.orders.reduce((sum, o) => sum + o.remainingQty, 0);
  }

  snapshot(): PriceLevelSnapshot {
    return {
      price: this.price,
      totalQuantity: this.totalQuantity(),
      orderCount: this.orders.length,
    };
  }
}

import { PriceLevel } from './price-level';
import { Order } from '../models';

function makeOrder(id: string, remainingQty: number, quantity?: number): Order {
  return {
    id,
    traderId: 'trader-1',
    ticker: 'AAPL',
    side: 'buy',
    price: 100,
    quantity: quantity ?? remainingQty,
    remainingQty,
    timestamp: Date.now(),
  };
}

describe('PriceLevel', () => {
  let level: PriceLevel;

  beforeEach(() => {
    level = new PriceLevel(100);
  });

  describe('enqueue / dequeue', () => {
    it('returns orders in FIFO order', () => {
      const a = makeOrder('a', 10);
      const b = makeOrder('b', 20);
      level.enqueue(a);
      level.enqueue(b);
      expect(level.dequeue()).toStrictEqual(a);
      expect(level.dequeue()).toStrictEqual(b);
    });

    it('stores a copy — mutating the original does not affect the queued order', () => {
      const a = makeOrder('a', 10);
      level.enqueue(a);
      a.remainingQty = 9999;
      expect(level.dequeue()!.remainingQty).toBe(10);
    });

    it('returns undefined when empty', () => {
      expect(level.dequeue()).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('returns the head without consuming it', () => {
      const a = makeOrder('a', 10);
      level.enqueue(a);
      expect(level.peek()).toStrictEqual(a);
      expect(level.peek()).toStrictEqual(a);
      expect(level.dequeue()).toStrictEqual(a);
    });

    it('returns a copy — mutating the result does not affect the queued order', () => {
      level.enqueue(makeOrder('a', 10));
      const peeked = level.peek()!;
      peeked.remainingQty = 9999;
      expect(level.peek()!.remainingQty).toBe(10);
    });

    it('returns undefined when empty', () => {
      expect(level.peek()).toBeUndefined();
    });
  });

  describe('isEmpty', () => {
    it('is true before any enqueue', () => {
      expect(level.isEmpty()).toBe(true);
    });

    it('is false after an enqueue', () => {
      level.enqueue(makeOrder('a', 10));
      expect(level.isEmpty()).toBe(false);
    });

    it('is true again after dequeuing all orders', () => {
      level.enqueue(makeOrder('a', 10));
      level.dequeue();
      expect(level.isEmpty()).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes an order by id and returns true', () => {
      const a = makeOrder('a', 10);
      const b = makeOrder('b', 20);
      level.enqueue(a);
      level.enqueue(b);
      expect(level.remove('a')).toBe(true);
      expect(level.dequeue()).toStrictEqual(b);
    });

    it('returns false when the id is not found', () => {
      level.enqueue(makeOrder('a', 10));
      expect(level.remove('nonexistent')).toBe(false);
    });

    it('leaves the queue unchanged when id is not found', () => {
      const a = makeOrder('a', 10);
      level.enqueue(a);
      level.remove('nonexistent');
      expect(level.dequeue()).toStrictEqual(a);
    });
  });

  describe('totalQuantity', () => {
    it('sums remainingQty across all orders', () => {
      level.enqueue(makeOrder('a', 30));
      level.enqueue(makeOrder('b', 70));
      expect(level.totalQuantity()).toBe(100);
    });

    it('uses remainingQty, not quantity, for partially filled orders', () => {
      level.enqueue(makeOrder('a', 40, 100));
      expect(level.totalQuantity()).toBe(40);
    });

    it('is 0 when empty', () => {
      expect(level.totalQuantity()).toBe(0);
    });
  });

  describe('snapshot', () => {
    it('returns correct price, totalQuantity, and orderCount', () => {
      level.enqueue(makeOrder('a', 30));
      level.enqueue(makeOrder('b', 70));
      expect(level.snapshot()).toEqual({
        price: 100,
        totalQuantity: 100,
        orderCount: 2,
      });
    });

    it('returns a copy — mutating the result does not affect internal state', () => {
      level.enqueue(makeOrder('a', 50));
      const snap = level.snapshot();
      snap.totalQuantity = 9999;
      expect(level.snapshot().totalQuantity).toBe(50);
    });
  });
});

import { OrderBook } from './order-book';
import { Order, Side } from '../models';

function makeOrder(id: string, side: Side, price: number, remainingQty: number): Order {
  return {
    id,
    traderId: 'trader-1',
    ticker: 'AAPL',
    side,
    price,
    quantity: remainingQty,
    remainingQty,
    timestamp: Date.now(),
  };
}

describe('OrderBook', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook('AAPL');
  });

  describe('addOrder', () => {
    it('routes a buy order to the bid side', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      expect(book.bestBidLevel()?.price).toBe(100);
      expect(book.bestAskLevel()).toBeUndefined();
    });

    it('routes a sell order to the ask side', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      expect(book.bestAskLevel()?.price).toBe(101);
      expect(book.bestBidLevel()).toBeUndefined();
    });

    it('aggregates two orders at the same price into one level', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      book.addOrder(makeOrder('b', 'buy', 100, 20));
      const level = book.bestBidLevel()!;
      expect(level.totalQuantity()).toBe(30);
      expect(level.snapshot().orderCount).toBe(2);
    });

    it('creates separate levels for different prices', () => {
      book.addOrder(makeOrder('a', 'buy', 99, 10));
      book.addOrder(makeOrder('b', 'buy', 100, 10));
      const snap = book.snapshot();
      expect(snap.bids).toHaveLength(2);
    });

    it('indexes the order so it can be cancelled', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      expect(book.cancelOrder('a')).toBe(true);
    });
  });

  describe('cancelOrder', () => {
    it('returns true and removes the order from its level', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      book.addOrder(makeOrder('b', 'buy', 100, 20));
      expect(book.cancelOrder('a')).toBe(true);
      expect(book.bestBidLevel()!.totalQuantity()).toBe(20);
    });

    it('returns false for an unknown orderId', () => {
      expect(book.cancelOrder('nonexistent')).toBe(false);
    });

    it('removes the price level from the book when the last order is cancelled', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      book.cancelOrder('a');
      expect(book.bestBidLevel()).toBeUndefined();
    });

    it('removes ask level when last sell order is cancelled', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      book.cancelOrder('a');
      expect(book.bestAskLevel()).toBeUndefined();
    });

    it('leaves other orders at the same level intact', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      book.addOrder(makeOrder('b', 'sell', 101, 20));
      book.cancelOrder('a');
      expect(book.bestAskLevel()!.totalQuantity()).toBe(20);
    });
  });

  describe('peekBestBid', () => {
    it('returns undefined when bids are empty', () => {
      expect(book.peekBestBid()).toBeUndefined();
    });

    it('returns the front order of the highest-price bid level', () => {
      book.addOrder(makeOrder('a', 'buy', 99, 10));
      book.addOrder(makeOrder('b', 'buy', 101, 20));
      const order = book.peekBestBid()!;
      expect(order.price).toBe(101);
      expect(order.remainingQty).toBe(20);
    });

    it('returns a copy — mutating it does not affect book state', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      const order = book.peekBestBid()!;
      order.remainingQty = 9999;
      expect(book.peekBestBid()!.remainingQty).toBe(10);
    });
  });

  describe('peekBestAsk', () => {
    it('returns undefined when asks are empty', () => {
      expect(book.peekBestAsk()).toBeUndefined();
    });

    it('returns the front order of the lowest-price ask level', () => {
      book.addOrder(makeOrder('a', 'sell', 103, 10));
      book.addOrder(makeOrder('b', 'sell', 101, 20));
      const order = book.peekBestAsk()!;
      expect(order.price).toBe(101);
      expect(order.remainingQty).toBe(20);
    });

    it('returns a copy — mutating it does not affect book state', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      const order = book.peekBestAsk()!;
      order.remainingQty = 9999;
      expect(book.peekBestAsk()!.remainingQty).toBe(10);
    });
  });

  describe('bestBidLevel', () => {
    it('returns undefined when bids are empty', () => {
      expect(book.bestBidLevel()).toBeUndefined();
    });

    it('returns the highest-price bid level', () => {
      book.addOrder(makeOrder('a', 'buy', 99, 10));
      book.addOrder(makeOrder('b', 'buy', 101, 10));
      book.addOrder(makeOrder('c', 'buy', 100, 10));
      expect(book.bestBidLevel()!.price).toBe(101);
    });

    it('returns a live reference — dequeuing updates the level', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      const level = book.bestBidLevel()!;
      level.dequeue();
      expect(book.bestBidLevel()!.isEmpty()).toBe(true);
    });
  });

  describe('bestAskLevel', () => {
    it('returns undefined when asks are empty', () => {
      expect(book.bestAskLevel()).toBeUndefined();
    });

    it('returns the lowest-price ask level', () => {
      book.addOrder(makeOrder('a', 'sell', 103, 10));
      book.addOrder(makeOrder('b', 'sell', 101, 10));
      book.addOrder(makeOrder('c', 'sell', 102, 10));
      expect(book.bestAskLevel()!.price).toBe(101);
    });

    it('returns a live reference — dequeuing updates the level', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      const level = book.bestAskLevel()!;
      level.dequeue();
      expect(book.bestAskLevel()!.isEmpty()).toBe(true);
    });
  });

  describe('removePriceLevel', () => {
    it('removes a bid level by price', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 10));
      book.removePriceLevel(100, 'buy');
      expect(book.bestBidLevel()).toBeUndefined();
    });

    it('removes an ask level by price', () => {
      book.addOrder(makeOrder('a', 'sell', 101, 10));
      book.removePriceLevel(101, 'sell');
      expect(book.bestAskLevel()).toBeUndefined();
    });

    it('does not throw when the price does not exist', () => {
      expect(() => book.removePriceLevel(999, 'buy')).not.toThrow();
    });
  });

  describe('snapshot', () => {
    it('returns empty bid and ask arrays when the book is empty', () => {
      const snap = book.snapshot();
      expect(snap.bids).toEqual([]);
      expect(snap.asks).toEqual([]);
    });

    it('returns the correct ticker and a timestamp', () => {
      const snap = book.snapshot();
      expect(snap.ticker).toBe('AAPL');
      expect(typeof snap.timestamp).toBe('number');
    });

    it('orders bids descending by price', () => {
      book.addOrder(makeOrder('a', 'buy', 99, 10));
      book.addOrder(makeOrder('b', 'buy', 101, 10));
      book.addOrder(makeOrder('c', 'buy', 100, 10));
      const prices = book.snapshot().bids.map((l) => l.price);
      expect(prices).toEqual([101, 100, 99]);
    });

    it('orders asks ascending by price', () => {
      book.addOrder(makeOrder('a', 'sell', 103, 10));
      book.addOrder(makeOrder('b', 'sell', 101, 10));
      book.addOrder(makeOrder('c', 'sell', 102, 10));
      const prices = book.snapshot().asks.map((l) => l.price);
      expect(prices).toEqual([101, 102, 103]);
    });

    it('returns correct price, totalQuantity, and orderCount per level', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 30));
      book.addOrder(makeOrder('b', 'buy', 100, 70));
      const [level] = book.snapshot().bids;
      expect(level).toEqual({ price: 100, totalQuantity: 100, orderCount: 2 });
    });

    it('mutating the returned snapshot does not affect internal state', () => {
      book.addOrder(makeOrder('a', 'buy', 100, 50));
      const snap = book.snapshot();
      snap.bids[0].totalQuantity = 9999;
      expect(book.snapshot().bids[0].totalQuantity).toBe(50);
    });
  });
});

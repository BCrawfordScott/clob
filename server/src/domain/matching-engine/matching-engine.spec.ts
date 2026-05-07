import { MatchingEngine } from './matching-engine';
import { PriceLevel } from '../price-level/price-level';
import { Order } from '../models';

function makeOrder(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id,
    traderId: 'trader-A',
    ticker: 'AAPL',
    side: 'sell',
    price: 100,
    quantity: 10,
    remainingQty: 10,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MatchingEngine', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine();
  });

  describe('no match', () => {
    it('returns null when the spread is too wide', () => {
      const level = new PriceLevel(105);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', price: 105, remainingQty: 10 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      expect(engine.match(incoming, level)).toBeNull();
    });

    it('returns null when the level is empty', () => {
      const level = new PriceLevel(100);
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      expect(engine.match(incoming, level)).toBeNull();
    });

    it('returns null and leaves the level unmodified when the front order is a self-trade', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-A', side: 'sell', remainingQty: 10 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      expect(engine.match(incoming, level)).toBeNull();
      expect(level.isEmpty()).toBe(false);
    });
  });

  describe('full fill', () => {
    it('produces one trade and exhausts the level when taker qty equals maker qty', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', price: 100, remainingQty: 10 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(10);
      expect(result.takerRemainingQty).toBe(0);
      expect(result.levelExhausted).toBe(true);
    });
  });

  describe('partial fill', () => {
    it('exhausts the level when the taker qty exceeds a single maker qty', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', price: 100, remainingQty: 5 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(5);
      expect(result.takerRemainingQty).toBe(5);
      expect(result.levelExhausted).toBe(true);
    });

    it('restores the partially-filled maker to the front when the taker is satisfied first', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', price: 100, remainingQty: 20 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(10);
      expect(result.takerRemainingQty).toBe(0);
      expect(result.levelExhausted).toBe(false);
      expect(level.peek()!.remainingQty).toBe(10);
    });
  });

  describe('multi-order level', () => {
    it('fills across multiple resting orders and restores the last partially-filled maker', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      level.enqueue(makeOrder('maker-2', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      level.enqueue(makeOrder('maker-3', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 12 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(3);
      expect(result.trades.map((t) => t.quantity)).toEqual([5, 5, 2]);
      expect(result.takerRemainingQty).toBe(0);
      expect(result.levelExhausted).toBe(false);
      expect(level.peek()!.remainingQty).toBe(3);
    });

    it('exhausts the level when all resting orders are fully consumed', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-1', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      level.enqueue(makeOrder('maker-2', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(2);
      expect(result.levelExhausted).toBe(true);
      expect(level.isEmpty()).toBe(true);
    });

    it('fills the earlier-enqueued order first (time priority)', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('early', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      level.enqueue(makeOrder('late', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades[0].sellOrderId).toBe('early');
      expect(result.trades[1].sellOrderId).toBe('late');
    });
  });

  describe('self-trade prevention', () => {
    it('stops at a self-trade mid-level and restores that order to the front', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker-valid', { traderId: 'trader-B', side: 'sell', remainingQty: 5 }));
      level.enqueue(makeOrder('maker-self', { traderId: 'trader-A', side: 'sell', remainingQty: 5 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].sellOrderId).toBe('maker-valid');
      expect(level.peek()!.id).toBe('maker-self');
    });
  });

  describe('trade fields', () => {
    it('assigns buyOrderId and sellOrderId correctly when the incoming order is a sell', () => {
      const level = new PriceLevel(100);
      level.enqueue(makeOrder('maker', { traderId: 'trader-B', side: 'buy', price: 100, remainingQty: 10 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'sell', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades[0].buyOrderId).toBe('maker');
      expect(result.trades[0].sellOrderId).toBe('taker');
    });

    it('executes trades at the maker price (level price), not the taker limit price', () => {
      const level = new PriceLevel(98);
      level.enqueue(makeOrder('maker', { traderId: 'trader-B', side: 'sell', price: 98, remainingQty: 10 }));
      const incoming = makeOrder('taker', { traderId: 'trader-A', side: 'buy', price: 100, remainingQty: 10 });
      const result = engine.match(incoming, level)!;
      expect(result.trades[0].price).toBe(98);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { OrderService, PlaceOrderInput } from './order.service';
import { OrderBookRegistry } from '../order-book-registry/order-book-registry.service';
import { MatchingEngine } from '../../domain/matching-engine/matching-engine';

function makeInput(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    traderId: 'trader-A',
    ticker: 'AAPL',
    side: 'buy',
    price: 100,
    quantity: 10,
    ...overrides,
  };
}

describe('OrderService', () => {
  let service: OrderService;
  let registry: OrderBookRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderService, OrderBookRegistry, MatchingEngine],
    }).compile();

    service = module.get<OrderService>(OrderService);
    registry = module.get<OrderBookRegistry>(OrderBookRegistry);
  });

  describe('placeOrder — no match', () => {
    it('returns status open and no trades when no counter-orders exist', () => {
      const result = service.placeOrder(makeInput({ side: 'buy', price: 100, quantity: 10 }));
      expect(result.status).toBe('open');
      expect(result.trades).toHaveLength(0);
    });

    it('adds the order to the book when it does not match', () => {
      service.placeOrder(makeInput({ side: 'buy', price: 100, quantity: 10 }));
      const book = registry.getOrCreate('AAPL');
      expect(book.peekBestBid()?.price).toBe(100);
    });

    it('auto-creates a book for an unknown ticker', () => {
      const result = service.placeOrder(makeInput({ ticker: 'TSLA', side: 'buy', price: 200, quantity: 5 }));
      expect(result.status).toBe('open');
      expect(registry.get('TSLA')).toBeDefined();
    });
  });

  describe('placeOrder — full fill', () => {
    it('returns status filled and one trade when taker exactly matches a resting maker', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      const result = service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      expect(result.status).toBe('filled');
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(10);
    });

    it('clears the book after a full fill', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const book = registry.getOrCreate('AAPL');
      expect(book.bestAskLevel()).toBeUndefined();
      expect(book.bestBidLevel()).toBeUndefined();
    });

    it('cannot cancel a fully filled order', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      const buy = service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      expect(buy.status).toBe('filled');
      expect(service.cancelOrder(buy.order.id).cancelled).toBe(false);
    });
  });

  describe('placeOrder — partial fill', () => {
    it('returns status partial when taker qty exceeds all available counter-side liquidity', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 5 }));
      const result = service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      expect(result.status).toBe('partial');
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe(5);
    });

    it('adds the residual taker quantity to the book', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 5 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const book = registry.getOrCreate('AAPL');
      expect(book.peekBestBid()?.remainingQty).toBe(5);
    });
  });

  describe('placeOrder — multi-level fill', () => {
    it('fills across multiple price levels in price priority order', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 99, quantity: 5 }));
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 5 }));
      const result = service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      expect(result.status).toBe('filled');
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].price).toBe(99);
      expect(result.trades[1].price).toBe(100);
    });
  });

  describe('cancelOrder', () => {
    it('cancels a resting order and reports cancelled: true', () => {
      const placed = service.placeOrder(makeInput({ side: 'sell', price: 100, quantity: 10 }));
      const result = service.cancelOrder(placed.order.id);
      expect(result.cancelled).toBe(true);
      expect(result.orderId).toBe(placed.order.id);
    });

    it('removes the cancelled order from the book', () => {
      const placed = service.placeOrder(makeInput({ side: 'sell', price: 100, quantity: 10 }));
      service.cancelOrder(placed.order.id);
      const book = registry.getOrCreate('AAPL');
      expect(book.bestAskLevel()).toBeUndefined();
    });

    it('returns cancelled: false for an unknown orderId', () => {
      const result = service.cancelOrder('nonexistent-id');
      expect(result.cancelled).toBe(false);
    });

    it('returns cancelled: false when cancelling the same order twice', () => {
      const placed = service.placeOrder(makeInput({ side: 'sell', price: 100, quantity: 10 }));
      service.cancelOrder(placed.order.id);
      const second = service.cancelOrder(placed.order.id);
      expect(second.cancelled).toBe(false);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderService, PlaceOrderInput } from './order.service';
import { OrderBookRegistry } from '../order-book-registry/order-book-registry.service';
import { MatchingEngine } from '../../domain/matching-engine/matching-engine';
import { Events } from '../../events';

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
  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    mockEventEmitter.emit.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderBookRegistry,
        MatchingEngine,
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
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

  describe('event emission', () => {
    it('emits no events when placeOrder produces no match', () => {
      service.placeOrder(makeInput({ side: 'buy', price: 100, quantity: 10 }));
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits trade.executed once per trade on a full fill', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const tradeCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.TRADE_EXECUTED);
      expect(tradeCalls).toHaveLength(1);
      expect(tradeCalls[0][1]).toMatchObject({ quantity: 10 });
    });

    it('emits orderbook.updated after each matched level', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const updateCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDERBOOK_UPDATED);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toMatchObject({ ticker: 'AAPL' });
    });

    it('emits orderbook.updated once per level on a multi-level fill', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 99, quantity: 5 }));
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 5 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const updateCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDERBOOK_UPDATED);
      expect(updateCalls).toHaveLength(2);
    });

    it('emits order.completed when a maker is fully consumed', () => {
      const maker = service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const completedCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDER_COMPLETED);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0][1]).toEqual({ orderId: maker.order.id, traderId: 'trader-B' });
    });

    it('does not emit order.completed when the maker is only partially filled', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 20 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const completedCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDER_COMPLETED);
      expect(completedCalls).toHaveLength(0);
    });

    it('emits orderbook.updated after a successful cancel', () => {
      const placed = service.placeOrder(makeInput({ side: 'sell', price: 100, quantity: 10 }));
      mockEventEmitter.emit.mockClear();
      service.cancelOrder(placed.order.id);
      const updateCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDERBOOK_UPDATED);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toMatchObject({ ticker: 'AAPL' });
    });

    it('emits no events when cancelOrder finds no order', () => {
      service.cancelOrder('nonexistent-id');
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('emits order.partialFill with correct payload when a partial maker fill occurs', () => {
      const maker = service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 20 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const partialCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDER_PARTIAL_FILL);
      expect(partialCalls).toHaveLength(1);
      expect(partialCalls[0][1]).toEqual({
        orderId: maker.order.id,
        traderId: 'trader-B',
        filledQty: 10,
        remainingQty: 10,
      });
    });

    it('does not emit order.partialFill when the maker is fully consumed', () => {
      service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
      service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));
      const partialCalls = mockEventEmitter.emit.mock.calls.filter(([event]) => event === Events.ORDER_PARTIAL_FILL);
      expect(partialCalls).toHaveLength(0);
    });
  });
});

import { OrderBookRegistry } from './order-book-registry.service';

describe('OrderBookRegistry', () => {
  let registry: OrderBookRegistry;

  beforeEach(() => {
    registry = new OrderBookRegistry();
  });

  describe('getOrCreate', () => {
    it('returns an OrderBook with the correct ticker for a new symbol', () => {
      const book = registry.getOrCreate('AAPL');
      expect(book.ticker).toBe('AAPL');
    });

    it('returns the same instance on repeated calls for the same ticker', () => {
      const first = registry.getOrCreate('AAPL');
      const second = registry.getOrCreate('AAPL');
      expect(first).toBe(second);
    });

    it('returns distinct instances for different tickers', () => {
      const aapl = registry.getOrCreate('AAPL');
      const tsla = registry.getOrCreate('TSLA');
      expect(aapl).not.toBe(tsla);
      expect(aapl.ticker).toBe('AAPL');
      expect(tsla.ticker).toBe('TSLA');
    });
  });

  describe('get', () => {
    it('returns undefined for an unknown ticker', () => {
      expect(registry.get('AAPL')).toBeUndefined();
    });

    it('returns the existing instance after getOrCreate', () => {
      const created = registry.getOrCreate('AAPL');
      expect(registry.get('AAPL')).toBe(created);
    });
  });

  describe('registerOrder / findTickerByOrderId / unregisterOrder', () => {
    it('findTickerByOrderId returns undefined before registration', () => {
      expect(registry.findTickerByOrderId('order-1')).toBeUndefined();
    });

    it('findTickerByOrderId returns the registered ticker', () => {
      registry.registerOrder('order-1', 'AAPL');
      expect(registry.findTickerByOrderId('order-1')).toBe('AAPL');
    });

    it('unregisterOrder removes the entry so findTickerByOrderId returns undefined', () => {
      registry.registerOrder('order-1', 'AAPL');
      registry.unregisterOrder('order-1');
      expect(registry.findTickerByOrderId('order-1')).toBeUndefined();
    });

    it('unregisterOrder on an unknown orderId does not throw', () => {
      expect(() => registry.unregisterOrder('nonexistent')).not.toThrow();
    });
  });
});

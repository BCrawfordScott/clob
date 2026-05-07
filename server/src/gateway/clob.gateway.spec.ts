import { Socket } from 'socket.io';
import { ClobGateway } from './clob.gateway';
import { OrderService } from '../services/order/order.service';
import { OrderBookRegistry } from '../services/order-book-registry/order-book-registry.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { SubscribeBookDto } from './dto/subscribe-book.dto';
import { Trade } from '../domain/models';
import { OrderBookUpdatedPayload, OrderCompletedPayload, OrderPartialFillEvent } from '../events';

type MockSocket = { id: string; emit: jest.Mock; join: jest.Mock };

function makeSocket(id = 'socket-1'): MockSocket {
  return { id, emit: jest.fn(), join: jest.fn() };
}

function makePlaceOrderDto(overrides: Partial<PlaceOrderDto> = {}): PlaceOrderDto {
  return { traderId: 'trader-A', ticker: 'AAPL', side: 'buy', price: 100, quantity: 10, ...overrides } as PlaceOrderDto;
}

function makeCancelOrderDto(orderId = 'order-123'): CancelOrderDto {
  return { orderId } as CancelOrderDto;
}

function makeSubscribeBookDto(ticker = 'AAPL'): SubscribeBookDto {
  return { ticker } as SubscribeBookDto;
}

describe('ClobGateway', () => {
  let gateway: ClobGateway;
  let orderService: { placeOrder: jest.Mock; cancelOrder: jest.Mock };

  beforeEach(() => {
    orderService = {
      placeOrder: jest.fn().mockReturnValue({ order: { id: 'order-123' }, trades: [], status: 'open' }),
      cancelOrder: jest.fn().mockReturnValue({ orderId: 'order-123', cancelled: true }),
    };

    gateway = new ClobGateway(
      orderService as unknown as OrderService,
      {} as OrderBookRegistry,
    );
  });

  describe('handlePlaceOrder', () => {
    it('calls orderService.placeOrder with the received body', () => {
      const client = makeSocket();
      const body = makePlaceOrderDto();
      gateway.handlePlaceOrder(client as unknown as Socket, body);
      expect(orderService.placeOrder).toHaveBeenCalledWith(body);
    });

    it('emits order_placed with orderId and status on success', () => {
      const client = makeSocket();
      orderService.placeOrder.mockReturnValue({ order: { id: 'order-xyz' }, trades: [], status: 'filled' });
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto());
      expect(client.emit).toHaveBeenCalledWith('order_placed', { orderId: 'order-xyz', status: 'filled' });
    });

    it('registers traderId in clientTraderMap and traderClientMap', () => {
      const client = makeSocket('socket-A');
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto({ traderId: 'trader-X' }));
      expect((gateway as any).clientTraderMap.get('socket-A')).toBe('trader-X');
      expect((gateway as any).traderClientMap.get('trader-X')).toBe('socket-A');
    });

    it('emits error and does not throw when orderService throws an Error', () => {
      const client = makeSocket();
      orderService.placeOrder.mockImplementation(() => { throw new Error('book failure'); });
      expect(() => gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto())).not.toThrow();
      expect(client.emit).toHaveBeenCalledWith('error', { message: 'book failure' });
    });

    it('emits error with fallback message for non-Error throws', () => {
      const client = makeSocket();
      orderService.placeOrder.mockImplementation(() => { throw 'raw string'; });
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto());
      expect(client.emit).toHaveBeenCalledWith('error', { message: 'Unknown error' });
    });
  });

  describe('handleCancelOrder', () => {
    it('calls orderService.cancelOrder with the orderId', () => {
      const client = makeSocket();
      gateway.handleCancelOrder(client as unknown as Socket, makeCancelOrderDto('order-abc'));
      expect(orderService.cancelOrder).toHaveBeenCalledWith('order-abc');
    });

    it('emits order_cancelled with orderId and status cancelled on success', () => {
      const client = makeSocket();
      orderService.cancelOrder.mockReturnValue({ orderId: 'order-abc', cancelled: true });
      gateway.handleCancelOrder(client as unknown as Socket, makeCancelOrderDto('order-abc'));
      expect(client.emit).toHaveBeenCalledWith('order_cancelled', { orderId: 'order-abc', status: 'cancelled' });
    });

    it('emits error when the order is not found', () => {
      const client = makeSocket();
      orderService.cancelOrder.mockReturnValue({ orderId: 'order-abc', cancelled: false });
      gateway.handleCancelOrder(client as unknown as Socket, makeCancelOrderDto('order-abc'));
      expect(client.emit).toHaveBeenCalledWith('error', { message: 'Order order-abc not found' });
    });

    it('does not emit order_cancelled when the order is not found', () => {
      const client = makeSocket();
      orderService.cancelOrder.mockReturnValue({ orderId: 'order-abc', cancelled: false });
      gateway.handleCancelOrder(client as unknown as Socket, makeCancelOrderDto('order-abc'));
      const emittedEvents = client.emit.mock.calls.map(([event]) => event);
      expect(emittedEvents).not.toContain('order_cancelled');
    });

    it('emits error and does not throw when orderService throws an Error', () => {
      const client = makeSocket();
      orderService.cancelOrder.mockImplementation(() => { throw new Error('cancel failure'); });
      expect(() => gateway.handleCancelOrder(client as unknown as Socket, makeCancelOrderDto())).not.toThrow();
      expect(client.emit).toHaveBeenCalledWith('error', { message: 'cancel failure' });
    });
  });

  describe('handleSubscribeBook', () => {
    it('joins the client to a room named after the ticker', () => {
      const client = makeSocket();
      gateway.handleSubscribeBook(client as unknown as Socket, makeSubscribeBookDto('TSLA'));
      expect(client.join).toHaveBeenCalledWith('TSLA');
    });
  });

  describe('handleDisconnect', () => {
    it('removes the client from both clientTraderMap and traderClientMap', () => {
      const client = makeSocket('socket-A');
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto({ traderId: 'trader-X' }));
      expect((gateway as any).clientTraderMap.has('socket-A')).toBe(true);
      expect((gateway as any).traderClientMap.has('trader-X')).toBe(true);

      gateway.handleDisconnect(client as unknown as Socket);
      expect((gateway as any).clientTraderMap.has('socket-A')).toBe(false);
      expect((gateway as any).traderClientMap.has('trader-X')).toBe(false);
    });

    it('does not throw when the disconnecting client was never registered', () => {
      const client = makeSocket('socket-unknown');
      expect(() => gateway.handleDisconnect(client as unknown as Socket)).not.toThrow();
    });
  });

  describe('@OnEvent handlers', () => {
    let mockEmit: jest.Mock;
    let mockTo: jest.Mock;

    beforeEach(() => {
      mockEmit = jest.fn();
      mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (gateway as any).server = { to: mockTo };
    });

    describe('handleTradeExecuted', () => {
      it('broadcasts trade_executed to the ticker room', () => {
        const trade = { ticker: 'TW', buyOrderId: 'b1', sellOrderId: 's1', quantity: 5 } as Trade;
        gateway.handleTradeExecuted(trade);
        expect(mockTo).toHaveBeenCalledWith('TW');
        expect(mockEmit).toHaveBeenCalledWith('trade_executed', trade);
      });
    });

    describe('handleOrderBookUpdated', () => {
      it('broadcasts orderbook_update snapshot to the ticker room', () => {
        const payload: OrderBookUpdatedPayload = {
          ticker: 'TW',
          snapshot: { ticker: 'TW', bids: [], asks: [], timestamp: 1000 },
        };
        gateway.handleOrderBookUpdated(payload);
        expect(mockTo).toHaveBeenCalledWith('TW');
        expect(mockEmit).toHaveBeenCalledWith('orderbook_update', payload.snapshot);
      });
    });

    describe('handleOrderCompleted', () => {
      it('emits order_completed to the trader socket when the trader is connected', () => {
        (gateway as any).traderClientMap.set('trader-X', 'socket-A');
        const payload: OrderCompletedPayload = { orderId: 'order-abc', traderId: 'trader-X' };
        gateway.handleOrderCompleted(payload);
        expect(mockTo).toHaveBeenCalledWith('socket-A');
        expect(mockEmit).toHaveBeenCalledWith('order_completed', { orderId: 'order-abc', status: 'filled' });
      });

      it('does not emit and does not throw when the trader is not connected', () => {
        const payload: OrderCompletedPayload = { orderId: 'order-abc', traderId: 'unknown-trader' };
        expect(() => gateway.handleOrderCompleted(payload)).not.toThrow();
        expect(mockTo).not.toHaveBeenCalled();
      });
    });

    describe('handleOrderPartialFill', () => {
      it('emits order_partial_fill to the trader socket when the trader is connected', () => {
        (gateway as any).traderClientMap.set('trader-X', 'socket-A');
        const payload: OrderPartialFillEvent = {
          orderId: 'order-abc',
          traderId: 'trader-X',
          filledQty: 10,
          remainingQty: 10,
        };
        gateway.handleOrderPartialFill(payload);
        expect(mockTo).toHaveBeenCalledWith('socket-A');
        expect(mockEmit).toHaveBeenCalledWith('order_partial_fill', {
          orderId: 'order-abc',
          filledQty: 10,
          remainingQty: 10,
        });
      });

      it('does not emit and does not throw when the trader is not connected', () => {
        const payload: OrderPartialFillEvent = {
          orderId: 'order-abc',
          traderId: 'unknown-trader',
          filledQty: 5,
          remainingQty: 15,
        };
        expect(() => gateway.handleOrderPartialFill(payload)).not.toThrow();
        expect(mockTo).not.toHaveBeenCalled();
      });
    });
  });
});


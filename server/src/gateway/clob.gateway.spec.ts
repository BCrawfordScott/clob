import { Socket } from 'socket.io';
import { ClobGateway } from './clob.gateway';
import { OrderService } from '../services/order/order.service';
import { OrderBookRegistry } from '../services/order-book-registry/order-book-registry.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { SubscribeBookDto } from './dto/subscribe-book.dto';

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

    it('registers traderId in clientTraderMap', () => {
      const client = makeSocket('socket-A');
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto({ traderId: 'trader-X' }));
      expect((gateway as any).clientTraderMap.get('socket-A')).toBe('trader-X');
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
    it('removes the client entry from clientTraderMap', () => {
      const client = makeSocket('socket-A');
      gateway.handlePlaceOrder(client as unknown as Socket, makePlaceOrderDto({ traderId: 'trader-X' }));
      expect((gateway as any).clientTraderMap.has('socket-A')).toBe(true);

      gateway.handleDisconnect(client as unknown as Socket);
      expect((gateway as any).clientTraderMap.has('socket-A')).toBe(false);
    });

    it('does not throw when the disconnecting client was never registered', () => {
      const client = makeSocket('socket-unknown');
      expect(() => gateway.handleDisconnect(client as unknown as Socket)).not.toThrow();
    });
  });
});

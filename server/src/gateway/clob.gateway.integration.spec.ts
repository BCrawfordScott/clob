import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Socket } from 'socket.io';
import { ClobGateway } from './clob.gateway';
import { OrderService } from '../services/order/order.service';
import { OrderBookRegistry } from '../services/order-book-registry/order-book-registry.service';
import { MatchingEngine } from '../domain/matching-engine/matching-engine';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { SubscribeBookDto } from './dto/subscribe-book.dto';

type MockSocket = { id: string; emit: jest.Mock; join: jest.Mock };

function makeSocket(id = 'socket-1'): MockSocket {
  return { id, emit: jest.fn(), join: jest.fn() };
}

describe('ClobGateway + OrderService integration', () => {
  let module: TestingModule;
  let gateway: ClobGateway;
  let mockEmit: jest.Mock;
  let mockTo: jest.Mock;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [ClobGateway, OrderService, OrderBookRegistry, MatchingEngine],
    }).compile();

    // module.init() triggers onModuleInit lifecycle hooks, which is required for
    // @OnEvent decorators to register their handlers via EventEmitterExplorer.
    await module.init();

    gateway = module.get<ClobGateway>(ClobGateway);

    mockEmit = jest.fn();
    mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
    (gateway as any).server = { to: mockTo };
  });

  afterEach(async () => {
    await module.close();
  });

  it('handlePlaceOrder (no match) → client receives order_placed and ticker room receives orderbook_update', () => {
    const client = makeSocket();

    gateway.handlePlaceOrder(
      client as unknown as Socket,
      { traderId: 'trader-A', ticker: 'AAPL', side: 'buy', price: 100, quantity: 10 } as PlaceOrderDto,
    );

    expect(client.emit).toHaveBeenCalledWith('order_placed', expect.objectContaining({ status: 'open' }));

    const broadcasts = mockTo.mock.calls.map((args, i) => ({
      room: args[0],
      event: mockEmit.mock.calls[i]?.[0],
    }));
    expect(broadcasts).toContainEqual({ room: 'AAPL', event: 'orderbook_update' });
  });

  it('handlePlaceOrder (full fill) → trade_executed and orderbook_update both broadcast to ticker room', () => {
    const makerSocket = makeSocket('socket-B');
    const takerSocket = makeSocket('socket-A');

    gateway.handlePlaceOrder(
      makerSocket as unknown as Socket,
      { traderId: 'trader-B', ticker: 'AAPL', side: 'sell', price: 100, quantity: 10 } as PlaceOrderDto,
    );
    mockTo.mockClear();
    mockEmit.mockClear();

    gateway.handlePlaceOrder(
      takerSocket as unknown as Socket,
      { traderId: 'trader-A', ticker: 'AAPL', side: 'buy', price: 100, quantity: 10 } as PlaceOrderDto,
    );

    const broadcasts = mockTo.mock.calls.map((args, i) => ({
      room: args[0],
      event: mockEmit.mock.calls[i]?.[0],
    }));
    expect(broadcasts).toContainEqual({ room: 'AAPL', event: 'trade_executed' });
    expect(broadcasts).toContainEqual({ room: 'AAPL', event: 'orderbook_update' });
  });

  it('handleCancelOrder → client receives order_cancelled and ticker room receives orderbook_update', () => {
    const client = makeSocket();

    gateway.handlePlaceOrder(
      client as unknown as Socket,
      { traderId: 'trader-A', ticker: 'AAPL', side: 'sell', price: 100, quantity: 10 } as PlaceOrderDto,
    );
    const orderId: string = (client.emit as jest.Mock).mock.calls
      .find(([event]) => event === 'order_placed')[1].orderId;

    (client.emit as jest.Mock).mockClear();
    mockTo.mockClear();
    mockEmit.mockClear();

    gateway.handleCancelOrder(
      client as unknown as Socket,
      { orderId } as CancelOrderDto,
    );

    expect(client.emit).toHaveBeenCalledWith('order_cancelled', { orderId, status: 'cancelled' });

    const broadcasts = mockTo.mock.calls.map((args, i) => ({
      room: args[0],
      event: mockEmit.mock.calls[i]?.[0],
    }));
    expect(broadcasts).toContainEqual({ room: 'AAPL', event: 'orderbook_update' });
  });

  it('handleSubscribeBook → immediate snapshot sent to subscriber when book has existing state', () => {
    const makerSocket = makeSocket('socket-B');
    const subscriberSocket = makeSocket('socket-C');

    gateway.handlePlaceOrder(
      makerSocket as unknown as Socket,
      { traderId: 'trader-B', ticker: 'AAPL', side: 'sell', price: 100, quantity: 10 } as PlaceOrderDto,
    );

    gateway.handleSubscribeBook(
      subscriberSocket as unknown as Socket,
      { ticker: 'AAPL' } as SubscribeBookDto,
    );

    const snapshotCall = (subscriberSocket.emit as jest.Mock).mock.calls
      .find(([event]) => event === 'orderbook_update');
    expect(snapshotCall).toBeDefined();
    expect(snapshotCall![1]).toMatchObject({
      ticker: 'AAPL',
      asks: [{ price: 100, totalQuantity: 10, orderCount: 1 }],
    });
  });
});

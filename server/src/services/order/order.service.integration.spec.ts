import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { OrderService, PlaceOrderInput } from './order.service';
import { OrderBookRegistry } from '../order-book-registry/order-book-registry.service';
import { MatchingEngine } from '../../domain/matching-engine/matching-engine';
import {
  Events,
  OrderBookUpdatedPayload,
  OrderPartialFillEvent,
  TradeExecutedPayload,
} from '../../events';

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

describe('OrderService — real EventEmitter2 integration', () => {
  let service: OrderService;
  let emitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [OrderService, OrderBookRegistry, MatchingEngine],
    }).compile();

    service = module.get<OrderService>(OrderService);
    emitter = module.get<EventEmitter2>(EventEmitter2);
  });

  it('fires orderbook.updated with correct snapshot shape after placing an unmatched order', () => {
    const received: OrderBookUpdatedPayload[] = [];
    emitter.on(Events.ORDERBOOK_UPDATED, (payload: OrderBookUpdatedPayload) => received.push(payload));

    service.placeOrder(makeInput({ side: 'buy', price: 100, quantity: 10 }));

    expect(received).toHaveLength(1);
    expect(received[0].ticker).toBe('AAPL');
    expect(received[0].snapshot).toMatchObject({
      ticker: 'AAPL',
      bids: [{ price: 100, totalQuantity: 10, orderCount: 1 }],
      asks: [],
    });
  });

  it('fires trade.executed, order.completed, then orderbook.updated in that order on a full fill', () => {
    const eventOrder: string[] = [];
    emitter.on(Events.TRADE_EXECUTED, () => eventOrder.push(Events.TRADE_EXECUTED));
    emitter.on(Events.ORDER_COMPLETED, () => eventOrder.push(Events.ORDER_COMPLETED));
    emitter.on(Events.ORDERBOOK_UPDATED, () => eventOrder.push(Events.ORDERBOOK_UPDATED));

    service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 10 }));
    eventOrder.length = 0; // discard the setup ORDERBOOK_UPDATED

    service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));

    expect(eventOrder).toEqual([
      Events.TRADE_EXECUTED,
      Events.ORDER_COMPLETED,
      Events.ORDERBOOK_UPDATED,
    ]);
  });

  it('fires order.partialFill with correct filledQty and remainingQty when a maker is partially consumed', () => {
    const received: OrderPartialFillEvent[] = [];
    emitter.on(Events.ORDER_PARTIAL_FILL, (payload: OrderPartialFillEvent) => received.push(payload));

    const maker = service.placeOrder(makeInput({ traderId: 'trader-B', side: 'sell', price: 100, quantity: 20 }));
    service.placeOrder(makeInput({ traderId: 'trader-A', side: 'buy', price: 100, quantity: 10 }));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      orderId: maker.order.id,
      traderId: 'trader-B',
      filledQty: 10,
      remainingQty: 10,
    });
  });

  it('fires only orderbook.updated (no trade events) after a successful cancel', () => {
    const tradeEvents: TradeExecutedPayload[] = [];
    const updates: OrderBookUpdatedPayload[] = [];
    emitter.on(Events.TRADE_EXECUTED, (t: TradeExecutedPayload) => tradeEvents.push(t));
    emitter.on(Events.ORDERBOOK_UPDATED, (p: OrderBookUpdatedPayload) => updates.push(p));

    const placed = service.placeOrder(makeInput({ side: 'sell', price: 100, quantity: 10 }));
    tradeEvents.length = 0;
    updates.length = 0;

    service.cancelOrder(placed.order.id);

    expect(tradeEvents).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].snapshot).toMatchObject({ ticker: 'AAPL', asks: [] });
  });
});

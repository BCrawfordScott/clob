import { Injectable } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import { BehaviorSubject, combineLatest, merge } from 'rxjs';
import { map, scan, shareReplay, startWith } from 'rxjs/operators';
import {
  ClobErrorEvent,
  OrderBookSnapshot,
  OrderCancelledEvent,
  OrderCompletedEvent,
  OrderPartialFillEvent,
  OrderPlacedEvent,
  PlaceOrderArgs,
  TrackedOrder,
  Trade,
} from '../models/clob.models';

@Injectable({ providedIn: 'root' })
export class ClobService {
  readonly traderId = crypto.randomUUID();

  readonly orderPlaced$ = this.socket.fromEvent<OrderPlacedEvent>('order_placed');
  readonly orderCancelled$ = this.socket.fromEvent<OrderCancelledEvent>('order_cancelled');
  readonly orderCompleted$ = this.socket.fromEvent<OrderCompletedEvent>('order_completed');
  readonly orderPartialFill$ = this.socket.fromEvent<OrderPartialFillEvent>('order_partial_fill');
  readonly tradeExecuted$ = this.socket.fromEvent<Trade>('trade_executed');
  readonly orderBookUpdate$ = this.socket.fromEvent<OrderBookSnapshot>('orderbook_update');
  readonly error$ = this.socket.fromEvent<ClobErrorEvent>('error');

  readonly connected$ = merge(
    this.socket.fromEvent<void>('connect').pipe(map(() => true)),
    this.socket.fromEvent<void>('disconnect').pipe(map(() => false)),
  ).pipe(startWith(false), shareReplay(1));

  private readonly _subscribedTickers = new BehaviorSubject<string[]>([]);
  readonly subscribedTickers$ = this._subscribedTickers.asObservable();

  private readonly _activeTicker = new BehaviorSubject<string | null>(null);
  readonly activeTicker$ = this._activeTicker.asObservable();

  private readonly _allSnapshots$ = this.orderBookUpdate$.pipe(
    scan(
      (acc, s) => new Map(acc).set(s.ticker, s),
      new Map<string, OrderBookSnapshot>(),
    ),
    startWith(new Map<string, OrderBookSnapshot>()),
    shareReplay(1),
  );

  readonly activeSnapshot$ = combineLatest([this._allSnapshots$, this.activeTicker$]).pipe(
    map(([snapshots, ticker]) => (ticker ? (snapshots.get(ticker) ?? null) : null)),
  );

  private readonly _pendingArgs: PlaceOrderArgs[] = [];
  private readonly _openOrders = new BehaviorSubject<TrackedOrder[]>([]);
  readonly openOrders$ = this._openOrders.asObservable();

  constructor(private readonly socket: Socket) {
    this.orderPlaced$.subscribe(event => {
      const args = this._pendingArgs.shift();
      if (!args || event.status === 'filled') return;
      this._openOrders.next([
        ...this._openOrders.value,
        {
          orderId: event.orderId,
          ticker: args.ticker,
          side: args.side,
          price: args.price,
          quantity: args.quantity,
          remainingQty: args.quantity,
          status: event.status,
        },
      ]);
    });

    this.orderPartialFill$.subscribe(event => {
      this._openOrders.next(
        this._openOrders.value.map(o =>
          o.orderId === event.orderId
            ? { ...o, remainingQty: event.remainingQty, status: 'partial' as const }
            : o,
        ),
      );
    });

    this.orderCancelled$.subscribe(event => {
      this._openOrders.next(this._openOrders.value.filter(o => o.orderId !== event.orderId));
    });

    this.orderCompleted$.subscribe(event => {
      this._openOrders.next(this._openOrders.value.filter(o => o.orderId !== event.orderId));
    });
  }

  placeOrder(args: PlaceOrderArgs): void {
    this._pendingArgs.push(args);
    this.socket.emit('place_order', { traderId: this.traderId, ...args });
  }

  cancelOrder(orderId: string): void {
    this.socket.emit('cancel_order', { orderId });
  }

  subscribeBook(ticker: string): void {
    const current = this._subscribedTickers.value;
    if (!current.includes(ticker)) {
      this._subscribedTickers.next([...current, ticker]);
      if (this._activeTicker.value === null) {
        this._activeTicker.next(ticker);
      }
    }
    this.socket.emit('subscribe_book', { ticker });
  }

  setActiveTicker(ticker: string): void {
    this._activeTicker.next(ticker);
  }
}

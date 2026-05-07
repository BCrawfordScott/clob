import { Injectable } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import { merge } from 'rxjs';
import { map, shareReplay, startWith } from 'rxjs/operators';
import {
  ClobErrorEvent,
  OrderBookSnapshot,
  OrderCancelledEvent,
  OrderCompletedEvent,
  OrderPartialFillEvent,
  OrderPlacedEvent,
  PlaceOrderArgs,
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

  constructor(private readonly socket: Socket) {}

  placeOrder(args: PlaceOrderArgs): void {
    this.socket.emit('place_order', { traderId: this.traderId, ...args });
  }

  cancelOrder(orderId: string): void {
    this.socket.emit('cancel_order', { orderId });
  }

  subscribeBook(ticker: string): void {
    this.socket.emit('subscribe_book', { ticker });
  }
}

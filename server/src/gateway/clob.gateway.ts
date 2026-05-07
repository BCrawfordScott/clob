import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { OrderService } from '../services/order/order.service';
import { OrderBookRegistry } from '../services/order-book-registry/order-book-registry.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { SubscribeBookDto } from './dto/subscribe-book.dto';
import { Events, OrderBookUpdatedPayload, OrderCompletedPayload, OrderPartialFillEvent, TradeExecutedPayload } from '../events';

@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@WebSocketGateway({ cors: { origin: '*' } })
export class ClobGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Injected by @WebSocketServer() decorator at runtime, not in the constructor
  @WebSocketServer()
  private readonly server!: Server;

  private readonly clientTraderMap = new Map<string, string>(); // socketId → traderId
  private readonly traderClientMap = new Map<string, string>(); // traderId → socketId

  constructor(
    private readonly orderService: OrderService,
    private readonly registry: OrderBookRegistry,
  ) {}

  handleConnection(_client: Socket): void {}

  handleDisconnect(client: Socket): void {
    const traderId = this.clientTraderMap.get(client.id);
    if (traderId) this.traderClientMap.delete(traderId);
    this.clientTraderMap.delete(client.id);
  }

  @SubscribeMessage('place_order')
  handlePlaceOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: PlaceOrderDto,
  ): void {
    try {
      this.clientTraderMap.set(client.id, body.traderId);
      this.traderClientMap.set(body.traderId, client.id);
      const result = this.orderService.placeOrder(body);
      client.emit('order_placed', { orderId: result.order.id, status: result.status });
    } catch (e) {
      client.emit('error', { message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  @SubscribeMessage('cancel_order')
  handleCancelOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CancelOrderDto,
  ): void {
    try {
      const result = this.orderService.cancelOrder(body.orderId);
      if (!result.cancelled) {
        client.emit('error', { message: `Order ${body.orderId} not found` });
        return;
      }
      client.emit('order_cancelled', { orderId: result.orderId, status: 'cancelled' });
    } catch (e) {
      client.emit('error', { message: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  @SubscribeMessage('subscribe_book')
  handleSubscribeBook(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeBookDto,
  ): void {
    client.join(body.ticker);
  }

  @OnEvent(Events.TRADE_EXECUTED)
  handleTradeExecuted(trade: TradeExecutedPayload): void {
    this.server.to(trade.ticker).emit('trade_executed', trade);
  }

  @OnEvent(Events.ORDERBOOK_UPDATED)
  handleOrderBookUpdated(payload: OrderBookUpdatedPayload): void {
    this.server.to(payload.ticker).emit('orderbook_update', payload.snapshot);
  }

  @OnEvent(Events.ORDER_COMPLETED)
  handleOrderCompleted(payload: OrderCompletedPayload): void {
    const socketId = this.traderClientMap.get(payload.traderId);
    if (!socketId) return; // trader not currently connected — no-op
    this.server.to(socketId).emit('order_completed', { orderId: payload.orderId, status: 'filled' });
  }

  @OnEvent(Events.ORDER_PARTIAL_FILL)
  handleOrderPartialFill(payload: OrderPartialFillEvent): void {
    const socketId = this.traderClientMap.get(payload.traderId);
    if (!socketId) return; // trader not currently connected — no-op
    this.server.to(socketId).emit('order_partial_fill', {
      orderId: payload.orderId,
      filledQty: payload.filledQty,
      remainingQty: payload.remainingQty,
    });
  }
}

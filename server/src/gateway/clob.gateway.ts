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
import { Server, Socket } from 'socket.io';
import { OrderService } from '../services/order/order.service';
import { OrderBookRegistry } from '../services/order-book-registry/order-book-registry.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { SubscribeBookDto } from './dto/subscribe-book.dto';

@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@WebSocketGateway({ cors: { origin: '*' } })
export class ClobGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Injected by @WebSocketServer() decorator at runtime, not in the constructor
  @WebSocketServer()
  private readonly server!: Server;

  // socketId → traderId; populated on place_order, used in Step 10 for targeted delivery
  private readonly clientTraderMap = new Map<string, string>();

  constructor(
    private readonly orderService: OrderService,
    private readonly registry: OrderBookRegistry,
  ) {}

  handleConnection(_client: Socket): void {}

  handleDisconnect(client: Socket): void {
    this.clientTraderMap.delete(client.id);
  }

  @SubscribeMessage('place_order')
  handlePlaceOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: PlaceOrderDto,
  ): void {
    try {
      this.clientTraderMap.set(client.id, body.traderId);
      const result = this.orderService.placeOrder(body);
      client.emit('order_placed', { orderId: result.order.id, status: result.status });
      // TODO Step 10: emit trade_executed for each result.trade
      // TODO Step 10: emit orderbook_update snapshot to ticker room
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
      // TODO Step 10: emit orderbook_update snapshot to ticker room
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
    // TODO Step 10: emit current orderbook_update snapshot to client
  }
}

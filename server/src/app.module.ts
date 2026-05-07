import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MatchingEngine } from './domain/matching-engine/matching-engine';
import { OrderBookRegistry } from './services/order-book-registry/order-book-registry.service';
import { OrderService } from './services/order/order.service';
import { ClobGateway } from './gateway/clob.gateway';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [MatchingEngine, OrderBookRegistry, OrderService, ClobGateway],
})
export class AppModule {}

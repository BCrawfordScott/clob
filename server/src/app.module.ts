import { Module } from '@nestjs/common';
import { MatchingEngine } from './domain/matching-engine/matching-engine';
import { OrderBookRegistry } from './services/order-book-registry/order-book-registry.service';
import { OrderService } from './services/order/order.service';
import { ClobGateway } from './gateway/clob.gateway';

@Module({
  providers: [MatchingEngine, OrderBookRegistry, OrderService, ClobGateway],
})
export class AppModule {}

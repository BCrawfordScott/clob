import { Module } from '@nestjs/common';
import { MatchingEngine } from './domain/matching-engine/matching-engine';
import { OrderBookRegistry } from './services/order-book-registry/order-book-registry.service';
import { OrderService } from './services/order/order.service';

@Module({
  providers: [MatchingEngine, OrderBookRegistry, OrderService],
})
export class AppModule {}

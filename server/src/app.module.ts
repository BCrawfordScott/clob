import { Module } from '@nestjs/common';
import { OrderBookRegistry } from './services/order-book-registry/order-book-registry.service';

@Module({
  providers: [OrderBookRegistry],
})
export class AppModule {}

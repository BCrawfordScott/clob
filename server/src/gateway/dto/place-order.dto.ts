import { IsString, IsNotEmpty, IsNumber, IsPositive, IsIn } from 'class-validator';
import { PlaceOrderInput } from '../../services/order/order.service';

export class PlaceOrderDto implements PlaceOrderInput {
  @IsString() @IsNotEmpty() declare traderId: string;
  @IsString() @IsNotEmpty() declare ticker: string;
  @IsIn(['buy', 'sell']) declare side: 'buy' | 'sell';
  @IsNumber() @IsPositive() declare price: number;
  @IsNumber() @IsPositive() declare quantity: number;
}

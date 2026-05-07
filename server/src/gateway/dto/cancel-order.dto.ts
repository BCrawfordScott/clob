import { IsString, IsNotEmpty } from 'class-validator';

export class CancelOrderDto {
  @IsString() @IsNotEmpty() declare orderId: string;
}

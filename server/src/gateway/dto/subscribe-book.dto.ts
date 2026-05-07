import { IsString, IsNotEmpty } from 'class-validator';

export class SubscribeBookDto {
  @IsString() @IsNotEmpty() declare ticker: string;
}

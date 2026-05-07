import { Component, Input } from '@angular/core';
import { OrderBookSnapshot } from '../../models/clob.models';

@Component({
  selector: 'app-order-book',
  templateUrl: './order-book.component.html',
})
export class OrderBookComponent {
  @Input() snapshot: OrderBookSnapshot | null = null;
}

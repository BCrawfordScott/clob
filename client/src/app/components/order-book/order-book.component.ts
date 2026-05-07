import { Component } from '@angular/core';
import { ClobService } from '../../services/clob.service';

@Component({
  selector: 'app-order-book',
  templateUrl: './order-book.component.html',
})
export class OrderBookComponent {
  protected readonly snapshot$ = this.clobService.orderBookUpdate$;

  constructor(private readonly clobService: ClobService) {}
}

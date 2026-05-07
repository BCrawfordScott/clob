import { Component } from '@angular/core';
import { ClobService } from '../../services/clob.service';

@Component({
  selector: 'app-order-book',
  templateUrl: './order-book.component.html',
})
export class OrderBookComponent {
  protected readonly snapshot$ = this.clobService.activeSnapshot$;
  protected readonly tickers$ = this.clobService.subscribedTickers$;
  protected readonly activeTicker$ = this.clobService.activeTicker$;

  constructor(private readonly clobService: ClobService) {}

  selectTicker(ticker: string): void {
    this.clobService.setActiveTicker(ticker);
  }
}

import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { scan, startWith } from 'rxjs/operators';
import { ClobService } from '../../services/clob.service';
import { Trade } from '../../models/clob.models';

@Component({
  selector: 'app-trade-feed',
  templateUrl: './trade-feed.component.html',
})
export class TradeFeedComponent {
  protected readonly trades$: Observable<Trade[]> = this.clobService.tradeExecuted$.pipe(
    scan((acc: Trade[], trade: Trade) => [trade, ...acc].slice(0, 50), []),
    startWith([] as Trade[]),
  );

  constructor(private readonly clobService: ClobService) {}

  formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
}

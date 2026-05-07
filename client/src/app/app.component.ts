import { Component } from '@angular/core';
import { Observable } from 'rxjs';
import { ClobService } from './services/clob.service';
import { ClobErrorEvent, OrderBookSnapshot } from './models/clob.models';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  protected readonly connected$: Observable<boolean> = this.clobService.connected$;
  protected readonly error$: Observable<ClobErrorEvent> = this.clobService.error$;
  protected readonly orderBookUpdate$: Observable<OrderBookSnapshot> = this.clobService.orderBookUpdate$;
  protected isDismissed = false;

  constructor(private readonly clobService: ClobService) {}
}

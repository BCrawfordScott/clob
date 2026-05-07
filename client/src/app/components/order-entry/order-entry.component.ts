import { Component } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { ClobService } from '../../services/clob.service';

@Component({
  selector: 'app-order-entry',
  templateUrl: './order-entry.component.html',
})
export class OrderEntryComponent {
  protected readonly lastOrderId$: Observable<string | null> = this.clobService.orderPlaced$.pipe(
    map(e => e.orderId),
    startWith(null),
  );

  constructor(protected readonly clobService: ClobService) {}

  onPlaceOrder(form: NgForm): void {
    if (!form.valid) return;
    const { ticker, side, price, quantity } = form.value as {
      ticker: string;
      side: 'buy' | 'sell';
      price: string;
      quantity: string;
    };
    this.clobService.subscribeBook(ticker);
    this.clobService.placeOrder({ ticker, side, price: +price, quantity: +quantity });
    form.resetForm();
  }

  onCancelOrder(form: NgForm): void {
    if (!form.valid) return;
    this.clobService.cancelOrder((form.value as { orderId: string }).orderId);
    form.resetForm();
  }

  onSubscribeBook(input: HTMLInputElement): void {
    const ticker = input.value.trim();
    if (ticker) {
      this.clobService.subscribeBook(ticker);
      input.value = '';
    }
  }
}

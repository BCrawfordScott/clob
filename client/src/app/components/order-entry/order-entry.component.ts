import { Component } from '@angular/core';
import { NgForm } from '@angular/forms';
import { ClobService } from '../../services/clob.service';

@Component({
  selector: 'app-order-entry',
  templateUrl: './order-entry.component.html',
})
export class OrderEntryComponent {
  protected readonly openOrders$ = this.clobService.openOrders$;

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

  onSubscribeBook(input: HTMLInputElement): void {
    const ticker = input.value.trim();
    if (ticker) {
      this.clobService.subscribeBook(ticker);
      input.value = '';
    }
  }

  cancelOrder(orderId: string): void {
    this.clobService.cancelOrder(orderId);
  }
}

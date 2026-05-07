import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { SocketIoModule } from 'ngx-socket-io';

import { environment } from '../environments/environment';
import { AppComponent } from './app.component';
import { OrderEntryComponent } from './components/order-entry/order-entry.component';
import { OrderBookComponent } from './components/order-book/order-book.component';
import { TradeFeedComponent } from './components/trade-feed/trade-feed.component';

@NgModule({
  declarations: [
    AppComponent,
    OrderEntryComponent,
    OrderBookComponent,
    TradeFeedComponent,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    SocketIoModule.forRoot({ url: environment.wsUrl, options: { transports: ['websocket'] } }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

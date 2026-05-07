import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../app.module';

// ─── helpers ─────────────────────────────────────────────────────────────────

function connect(url: string): Socket {
  return io(url, { transports: ['websocket'] });
}

function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for '${event}'`)),
      5000,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Resolves with the payload if the event fires within `ms`, otherwise null.
function maybeReceive<T>(socket: Socket, event: string, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    let received: T | null = null;
    const handler = (data: T) => { received = data; };
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve(received);
    }, ms);
  });
}

// ─── ticker counter — isolates each test's book state ────────────────────────
let tickerSeq = 0;
function ticker(): string {
  return `SYM${++tickerSeq}`;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('ClobGateway (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addr = (app.getHttpServer() as any).address();
    url = `http://localhost:${addr.port}`;
  });

  afterAll(() => app.close());

  // ── 1. place_order round-trip ─────────────────────────────────────────────

  describe('place_order', () => {
    it('emits order_placed (open) and orderbook_update when no match occurs', async () => {
      const sym = ticker();
      const client = connect(url);
      await waitFor(client, 'connect');
      client.emit('subscribe_book', { ticker: sym });

      const placedP = waitFor<{ orderId: string; status: string }>(client, 'order_placed');
      const bookP = waitFor<{ ticker: string; bids: { price: number; totalQuantity: number }[]; asks: unknown[] }>(client, 'orderbook_update');

      client.emit('place_order', { traderId: 'trader-A', ticker: sym, side: 'buy', price: 100, quantity: 10 });

      const [placed, book] = await Promise.all([placedP, bookP]);

      expect(placed.status).toBe('open');
      expect(typeof placed.orderId).toBe('string');
      expect(book.ticker).toBe(sym);
      expect(book.bids).toHaveLength(1);
      expect(book.bids[0].price).toBe(100);
      expect(book.bids[0].totalQuantity).toBe(10);
      expect(book.asks).toHaveLength(0);

      client.disconnect();
    });
  });

  // ── 2. cross-client trade ─────────────────────────────────────────────────

  describe('cross-client trade', () => {
    it('both clients receive trade_executed and the maker receives order_completed', async () => {
      const sym = ticker();
      const buyer = connect(url);
      const seller = connect(url);

      await Promise.all([waitFor(buyer, 'connect'), waitFor(seller, 'connect')]);
      buyer.emit('subscribe_book', { ticker: sym });
      seller.emit('subscribe_book', { ticker: sym });

      // Buyer places a resting bid (maker)
      const buyerPlacedP = waitFor<{ orderId: string; status: string }>(buyer, 'order_placed');
      buyer.emit('place_order', { traderId: 'buyer-1', ticker: sym, side: 'buy', price: 100, quantity: 10 });
      const buyerPlaced = await buyerPlacedP;
      expect(buyerPlaced.status).toBe('open');

      // Seller crosses (taker) — triggers trade
      const sellerPlacedP = waitFor<{ orderId: string; status: string }>(seller, 'order_placed');
      const buyerCompletedP = waitFor<{ orderId: string; status: string }>(buyer, 'order_completed');
      const tradeOnBuyerP = waitFor<{ ticker: string; price: number; quantity: number }>(buyer, 'trade_executed');
      const tradeOnSellerP = waitFor<{ ticker: string; price: number; quantity: number }>(seller, 'trade_executed');

      seller.emit('place_order', { traderId: 'seller-1', ticker: sym, side: 'sell', price: 100, quantity: 10 });

      const [sellerPlaced, buyerCompleted, tradeOnBuyer, tradeOnSeller] = await Promise.all([
        sellerPlacedP,
        buyerCompletedP,
        tradeOnBuyerP,
        tradeOnSellerP,
      ]);

      expect(sellerPlaced.status).toBe('filled');
      expect(buyerCompleted.orderId).toBe(buyerPlaced.orderId);
      expect(buyerCompleted.status).toBe('filled');
      expect(tradeOnBuyer).toMatchObject({ ticker: sym, price: 100, quantity: 10 });
      expect(tradeOnSeller).toMatchObject({ ticker: sym, price: 100, quantity: 10 });

      buyer.disconnect();
      seller.disconnect();
    });
  });

  // ── 3. subscription scoping ───────────────────────────────────────────────

  describe('subscription scoping', () => {
    it('a client subscribed to sym B does not receive orderbook_update for sym A', async () => {
      const symA = ticker();
      const symB = ticker();

      const clientA = connect(url);
      const clientB = connect(url);

      await Promise.all([waitFor(clientA, 'connect'), waitFor(clientB, 'connect')]);
      clientA.emit('subscribe_book', { ticker: symA });
      clientB.emit('subscribe_book', { ticker: symB });

      // Set up listeners before emitting the order
      const bookOnAP = waitFor<{ ticker: string }>(clientA, 'orderbook_update');
      const bookOnBP = maybeReceive<{ ticker: string }>(clientB, 'orderbook_update', 300);

      clientA.emit('place_order', { traderId: 'scope-trader', ticker: symA, side: 'buy', price: 50, quantity: 5 });

      const [bookOnA, bookOnB] = await Promise.all([bookOnAP, bookOnBP]);

      expect(bookOnA.ticker).toBe(symA);
      expect(bookOnB).toBeNull();

      clientA.disconnect();
      clientB.disconnect();
    });
  });

  // ── 4. cancel_order ───────────────────────────────────────────────────────

  describe('cancel_order', () => {
    it('removes the order from the book and emits order_cancelled + empty orderbook_update', async () => {
      const sym = ticker();
      const client = connect(url);
      await waitFor(client, 'connect');
      client.emit('subscribe_book', { ticker: sym });

      // Register listeners BEFORE emitting so neither event is missed
      const placedP = waitFor<{ orderId: string; status: string }>(client, 'order_placed');
      const firstBookP = waitFor<unknown>(client, 'orderbook_update');
      client.emit('place_order', { traderId: 'canceller', ticker: sym, side: 'buy', price: 99, quantity: 3 });
      const [{ orderId }] = await Promise.all([placedP, firstBookP]);

      // Register cancel listeners BEFORE emitting cancel_order
      const cancelledP = waitFor<{ orderId: string; status: string }>(client, 'order_cancelled');
      const bookAfterP = waitFor<{ bids: unknown[]; asks: unknown[] }>(client, 'orderbook_update');
      client.emit('cancel_order', { orderId });

      const [cancelled, bookAfter] = await Promise.all([cancelledP, bookAfterP]);

      expect(cancelled.orderId).toBe(orderId);
      expect(cancelled.status).toBe('cancelled');
      expect(bookAfter.bids).toHaveLength(0);
      expect(bookAfter.asks).toHaveLength(0);

      client.disconnect();
    });

    it('emits error when attempting to cancel an unknown order id', async () => {
      const client = connect(url);
      await waitFor(client, 'connect');

      const errP = waitFor<{ message: string }>(client, 'error');
      client.emit('cancel_order', { orderId: 'does-not-exist' });
      const err = await errP;

      expect(err.message).toContain('does-not-exist');

      client.disconnect();
    });
  });

  // ── 5. partial fill ───────────────────────────────────────────────────────

  describe('partial fill', () => {
    it('emits order_partial_fill to the maker when only part of their resting order is consumed', async () => {
      const sym = ticker();
      const maker = connect(url);
      const taker = connect(url);

      await Promise.all([waitFor(maker, 'connect'), waitFor(taker, 'connect')]);
      maker.emit('subscribe_book', { ticker: sym });
      taker.emit('subscribe_book', { ticker: sym });

      // Maker places a 10-share ask — register both listeners before emitting
      const makerPlacedP = waitFor<{ orderId: string; status: string }>(maker, 'order_placed');
      const firstBookP = waitFor<unknown>(maker, 'orderbook_update');
      maker.emit('place_order', { traderId: 'maker-1', ticker: sym, side: 'sell', price: 100, quantity: 10 });
      const [makerPlaced] = await Promise.all([makerPlacedP, firstBookP]);
      expect(makerPlaced.status).toBe('open');

      // Taker buys only 5 → maker partially filled
      const takerPlacedP = waitFor<{ orderId: string; status: string }>(taker, 'order_placed');
      const partialFillP = waitFor<{ orderId: string; filledQty: number; remainingQty: number }>(maker, 'order_partial_fill');
      taker.emit('place_order', { traderId: 'taker-1', ticker: sym, side: 'buy', price: 100, quantity: 5 });

      const [takerPlaced, partialFill] = await Promise.all([takerPlacedP, partialFillP]);

      expect(takerPlaced.status).toBe('filled');
      expect(partialFill.orderId).toBe(makerPlaced.orderId);
      expect(partialFill.filledQty).toBe(5);
      expect(partialFill.remainingQty).toBe(5);

      maker.disconnect();
      taker.disconnect();
    });
  });

  // ── 6. subscribe_book snapshot ────────────────────────────────────────────

  describe('subscribe_book', () => {
    it('immediately delivers the current book snapshot to a late-joining subscriber', async () => {
      const sym = ticker();

      // Client A populates the book — register both listeners before emitting
      const clientA = connect(url);
      await waitFor(clientA, 'connect');
      clientA.emit('subscribe_book', { ticker: sym });
      const setupPlacedP = waitFor<unknown>(clientA, 'order_placed');
      const setupBookP = waitFor<unknown>(clientA, 'orderbook_update');
      clientA.emit('place_order', { traderId: 'setup', ticker: sym, side: 'sell', price: 200, quantity: 7 });
      await Promise.all([setupPlacedP, setupBookP]);

      // Client B arrives after the order is resting
      const clientB = connect(url);
      await waitFor(clientB, 'connect');

      const snapshotP = waitFor<{ ticker: string; asks: { price: number; totalQuantity: number }[] }>(clientB, 'orderbook_update');
      clientB.emit('subscribe_book', { ticker: sym });

      const snapshot = await snapshotP;

      expect(snapshot.ticker).toBe(sym);
      expect(snapshot.asks).toHaveLength(1);
      expect(snapshot.asks[0].price).toBe(200);
      expect(snapshot.asks[0].totalQuantity).toBe(7);

      clientA.disconnect();
      clientB.disconnect();
    });
  });
});

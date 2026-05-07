# CLOB — Central Limit Order Book

A real-time Central Limit Order Book (CLOB) built with **NestJS**, **Socket.IO**, and **Angular**. The server matches buy and sell orders using price-time priority and pushes live order book updates and trade confirmations to connected clients over WebSockets.

---

## Quick Start

### Prerequisites

- Node.js 20+
- npm 9+

### Install and Run

```bash
npm install
npm start
```

- **Server** listens on `http://localhost:3000`
- **Client** serves on `http://localhost:4200`

Open `http://localhost:4200` in a browser. The UI connects to the server automatically.

### Run Tests

```bash
npm test
```

Runs all workspace test scripts: server unit and integration tests (Jest), and Angular client tests (`ng test`, requires Chrome/Chromium). To run E2E tests separately:

```bash
npm run test:e2e --workspace=server
```

---

## Using the UI

1. **Subscribe to a ticker** — Type a symbol (e.g. `AAPL`) in the Subscribe field and press Subscribe. You can subscribe to multiple tickers; tabs appear at the top of the order book display to switch between them.

2. **Place an order** — Fill in the ticker, side (buy/sell), price, and quantity, then click Place Order. The order book updates immediately.

3. **Cancel an order** — Open orders are listed beneath the order entry form. Each has a Cancel button. Clicking it sends a cancel and removes the order from the list when confirmed.

4. **Watch the trade feed** — The right column shows the 50 most recent trades across all subscribed tickers in reverse-chronological order.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Angular Client                     │
│  OrderEntryComponent  OrderBookComponent  TradeFeed │
│              └──────────────────────┘               │
│                     ClobService                     │
│               (ngx-socket-io wrapper)               │
└────────────────────┬────────────────────────────────┘
                     │  Socket.IO (WebSocket)
┌────────────────────▼────────────────────────────────┐
│                  NestJS Server                      │
│                                                     │
│  ClobGateway  ←→  OrderService  ←→  MatchingEngine  │
│       │                │                            │
│  EventEmitter2   OrderBookRegistry                  │
│       │                │                            │
│  (broadcasts     Map<Ticker, OrderBook>             │
│   to rooms)            │                            │
│                   OrderBook (BTree)                 │
│                        │                            │
│                   PriceLevel (FIFO queue)            │
└─────────────────────────────────────────────────────┘
```

### Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Domain | `server/src/domain/` | Pure data structures and matching logic — no I/O. `PriceLevel` and `OrderBook` have no NestJS dependencies; `MatchingEngine` carries `@Injectable()` so it can participate in DI |
| Services | `server/src/services/` | Application logic: order lifecycle, book registry, event emission |
| Gateway | `server/src/gateway/` | WebSocket transport: validates inbound messages, routes to services, broadcasts events |
| Client | `client/src/app/` | Angular UI: subscribes to server events, renders book and trades, sends orders |

---

## How Matching Works

Orders are matched by **price-time priority**:

1. A new buy order matches against the cheapest available asks (ascending price). A new sell order matches against the highest available bids (descending price).
2. Within a price level, orders at the front of the queue (earliest arrival) fill first.
3. The fill price is always the **resting (maker) order's price**.
4. **Self-trades are prevented** — two checks apply. If the first order in the queue belongs to the taker, no match occurs at all (`null` is returned). If a self-trade order is encountered partway through the queue, matching stops at that point and any trades already executed in that pass are still returned.

### Data Structures

**`PriceLevel`** — a FIFO queue (`Order[]`) at a single price point. Exposes `enqueue`, `dequeue`, `prepend`, `remove`, `peek`, `isEmpty`, `totalQuantity`, and `snapshot`. All read/write boundaries apply defensive copying so external callers cannot corrupt internal state.

**`OrderBook`** — two `sorted-btree` BTrees (bids and asks), each keyed by price and mapping to a `PriceLevel`. Best bid is `bids.maxKey()`; best ask is `asks.minKey()`. A flat `orderIndex` map (`orderId → { level, side }`) enables O(1) cancel lookup.

**`MatchingEngine`** — a stateless service. `match(incomingOrder, level)` walks a single `PriceLevel`, consuming resting orders via `dequeue` and restoring a partially-filled maker via `prepend`. Returns `{ trades, takerRemainingQty, levelExhausted, exhaustedMakers, partialMaker }` or `null` if no match is possible at this level.

**`OrderService`** — drives the cross-level matching loop: fetches the best counter-side level, calls `MatchingEngine.match`, removes exhausted levels from the book, and adds any residual taker quantity as a resting order. Emits domain events via NestJS `EventEmitter2` after each mutation.

### Performance Profile

| Operation | Complexity |
|-----------|-----------|
| Best bid / best ask | O(1) |
| Insert order | O(log n) |
| Cancel order | O(1) lookup + O(m) removal (m = orders at price level) |
| Full book snapshot | O(n) |

---

## WebSocket API

### Client → Server

**`place_order`**
```json
{
  "traderId": "string",
  "ticker": "AAPL",
  "side": "buy",
  "price": 150.00,
  "quantity": 100
}
```

**`cancel_order`**
```json
{ "orderId": "string" }
```

**`subscribe_book`**
```json
{ "ticker": "AAPL" }
```
Joins the client to the ticker's broadcast room. If a book has previously been created for that ticker (i.e., at least one order has ever been placed), the current snapshot is delivered immediately — even if the book is currently empty.

---

### Server → Client

| Event | When | Shape |
|-------|------|-------|
| `order_placed` | Immediately after placement | `{ orderId, status: "open" \| "partial" \| "filled" }` |
| `order_cancelled` | Immediately after cancellation | `{ orderId, status: "cancelled" }` |
| `order_completed` | Maker order fully filled | `{ orderId, status: "filled" }` |
| `order_partial_fill` | Maker order partially filled | `{ orderId, filledQty, remainingQty }` |
| `orderbook_update` | After any book mutation | `{ ticker, bids: PriceLevelSnapshot[], asks: PriceLevelSnapshot[], timestamp }` |
| `trade_executed` | For every fill | `{ id, ticker, buyOrderId, sellOrderId, price, quantity, timestamp }` |
| `error` | Validation or business error | `{ message: string }` |

`orderbook_update` and `trade_executed` are broadcast to **all subscribers** of the ticker. `order_placed`, `order_cancelled`, `order_completed`, `order_partial_fill`, and `error` are sent only to the originating client.

---

## Project Structure

```
/
├── package.json              # Monorepo root — workspaces + concurrently
├── server/
│   └── src/
│       ├── domain/
│       │   ├── models/           # Core types: Order, Trade, Ticker, etc.
│       │   ├── price-level/      # PriceLevel class + unit tests
│       │   ├── order-book/       # OrderBook class + unit tests
│       │   └── matching-engine/  # MatchingEngine + unit tests
│       ├── services/
│       │   ├── order-book-registry/  # Ticker → OrderBook map
│       │   └── order/                # OrderService + integration tests
│       ├── gateway/
│       │   ├── clob.gateway.ts       # WebSocket gateway
│       │   └── dto/                  # Validated inbound message DTOs
│       ├── events/               # Typed domain event definitions
│       └── test/                 # E2E tests (Socket.IO client against live server)
└── client/
    └── src/app/
        ├── services/             # ClobService (ngx-socket-io wrapper)
        ├── components/           # OrderBook, OrderEntry, TradeFeed
        └── models/               # Shared client-side types
```

---

## Testing

The test suite has three layers:

**Unit tests** (`*.spec.ts` alongside each domain file) — cover `PriceLevel`, `OrderBook`, and `MatchingEngine` in isolation. No NestJS context required.

**Integration tests** (`order.service.spec.ts`, `order-book-registry.service.spec.ts`) — exercise `OrderService` through the NestJS testing module with a real in-memory book.

**E2E tests** (`server/src/test/clob.e2e-spec.ts`) — spin up a full NestJS application on a random port, connect real Socket.IO clients, and verify end-to-end flows: order placement, cross-client trade, subscription scoping, cancellation, partial fills, and late-join snapshot delivery.

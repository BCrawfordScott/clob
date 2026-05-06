# CLAUDE.md — CLOB Project

This file is the authoritative reference for Claude Code when generating, modifying, or reviewing code in this repository. Read it in full before taking any action.

---

## Project Overview

This is a **Central Limit Orderbook (CLOB)** implementation. The system accepts orders via a WebSocket API, matches them using price-time priority, and publishes orderbook state changes and trade events back to connected clients.

**Stack:** Node.js · TypeScript (strict) · NestJS · Socket.IO · Angular

**Key constraints:**

- No persistence layer. All state is in-memory.
- Must run out of the box with `npm install` and `npm start` from the monorepo root.
- Code should be simple, legible, and easy to follow. Favor clarity over cleverness.
- All AI prompts used during development are captured in `/prompts/`.

---

## Repository Structure

```txt
/
├── package.json              # Monorepo root: workspaces, concurrently, unified scripts
├── CLAUDE.md
├── README.md
├── prompts/                  # All AI prompts used during development
│   └── session-log.md
├── server/                   # NestJS backend (npm workspace)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── domain/           # Track 1: Pure domain logic, no NestJS dependencies
│       │   ├── models/       # Interfaces and types: Order, Trade, Ticker, Trader, etc.
│       │   ├── price-level/  # PriceLevel class (queue abstraction over an array)
│       │   ├── order-book/   # OrderBook class (sorted-btree bid/ask sides)
│       │   └── matching-engine/ # MatchingEngine: pure price-time priority matching logic
│       ├── services/         # Track 2: NestJS application services
│       │   ├── order-book-registry/ # Symbol → OrderBook map
│       │   ├── order/        # OrderService: coordinates matching and event emission
│       │   └── trader/       # TraderService: trader identity management
│       ├── gateway/          # Track 3: WebSocket gateway and DTOs
│       │   ├── clob.gateway.ts
│       │   └── dto/          # Inbound message DTOs with class-validator decorators
│       ├── events/           # Typed domain event definitions
│       ├── test/             # E2E tests
│       └── app.module.ts
└── client/                   # Angular frontend (npm workspace)
    ├── package.json
    └── src/
        └── app/
            ├── services/     # WebSocket service (ngx-socket-io wrapper)
            └── components/   # Orderbook display, order entry form, trade feed
```

---

## Domain Model

These are the core types. All other code derives from them. Do not change these shapes without updating this file.

```typescript
// A stock ticker symbol, 1-4 characters
type Ticker = string;

// A registered participant in the system
interface Trader {
  id: string;
  name: string;
}

// The side of a trade
type Side = 'buy' | 'sell';

// An instruction to buy or sell at a specific price
interface Order {
  id: string;           // UUID, assigned on receipt
  traderId: string;
  ticker: Ticker;
  side: Side;
  price: number;        // Limit price, in dollars
  quantity: number;     // Shares requested
  remainingQty: number; // Shares not yet filled
  timestamp: number;    // Date.now() on receipt — used for time priority
}

// A completed match between a buy and sell order
interface Trade {
  id: string;
  ticker: Ticker;
  buyOrderId: string;
  sellOrderId: string;
  price: number;        // The price at which the trade executes (maker's price)
  quantity: number;     // Shares exchanged
  timestamp: number;
}

// Public aggregated view of one side of the book (anonymous, by price level)
interface PriceLevelSnapshot {
  price: number;
  totalQuantity: number;
  orderCount: number;
}

// The public orderbook snapshot emitted to clients
interface OrderBookSnapshot {
  ticker: Ticker;
  bids: PriceLevelSnapshot[]; // Descending price (best bid first)
  asks: PriceLevelSnapshot[]; // Ascending price (best ask first)
  timestamp: number;
}
```

---

## Performance Profile

| Operation | Target | Implementation |
| --- | --- | --- |
| Top of book (best bid / best ask) | O(1) | `btree.maxKey()` for bids, `btree.minKey()` for asks |
| Insert order | O(log n) | `btree.set(price, priceLevel)` |
| Cancel order by ID | O(1) lookup + O(m) removal | Hash map of `orderId → {price, side}`, then splice from PriceLevel array |
| Full book snapshot | O(n) | Iterate tree in sorted order |

**Known tradeoff:** PriceLevel order removal is O(m) where m = orders at that price. In typical usage m is expected to be small. A doubly-linked list would achieve true O(1) removal if throughput demands it.

---

## Data Structures

### OrderBook (per symbol)

Uses **`sorted-btree`** (`BTree` from `sorted-btree`) for both bid and ask sides.

- **Bid side:** keyed by price ascending; top of book is `maxKey()`
- **Ask side:** keyed by price ascending; top of book is `minKey()`
- Each key maps to a `PriceLevel` instance

Also maintains a flat `Map<orderId, { price: number; side: Side }>` for O(1) cancel lookup.

### PriceLevel

A thin class wrapping an `Order[]` array. Exposes only:

- `enqueue(order: Order): void` — push to tail
- `dequeue(): Order | undefined` — shift from head
- `remove(orderId: string): boolean` — splice by ID (used for cancels)
- `peek(): Order | undefined` — head without removal
- `isEmpty(): boolean`
- `totalQuantity(): number`
- `snapshot(): PriceLevelSnapshot`

Do not expose the raw array. All access goes through this interface.

### MatchingEngine

A **stateless service** (or pure function). Its signature:

```typescript
match(incomingOrder: Order, book: OrderBook): { trades: Trade[]; residualOrder: Order | null }
```

It does not mutate global state. It returns results; the `OrderService` is responsible for applying them to the book and emitting events. This keeps the engine fully unit-testable without any NestJS wiring.

**Matching logic:**

1. If `side === 'buy'`: walk asks in ascending price order while `ask.price <= order.price`
2. If `side === 'sell'`: walk bids in descending price order while `bid.price >= order.price`
3. At each price level, consume orders from the front of the queue (time priority)
4. Produce a `Trade` for each fill; update `remainingQty` on both orders
5. Remove exhausted orders and empty price levels from the book
6. If the incoming order has remaining quantity after matching, add it to the book at its price level

---

## WebSocket Message Protocol

### Inbound (client → server)

**`place_order`**

```json
{
  "traderId": "string",
  "ticker": "string",
  "side": "buy | sell",
  "price": 99.50,
  "quantity": 100
}
```

**`cancel_order`**

```json
{
  "orderId": "string"
}
```

**`subscribe_book`**

```json
{
  "ticker": "string"
}
```

### Outbound (server → client)

**`orderbook_update`** — emitted after any order placement or cancellation that changes the book state

```json
{
  "ticker": "string",
  "bids": [{ "price": 99.50, "totalQuantity": 450, "orderCount": 3 }],
  "asks": [{ "price": 99.55, "totalQuantity": 200, "orderCount": 1 }],
  "timestamp": 1234567890
}
```

**`trade_executed`** — emitted for each trade that occurs during matching

```json
{
  "id": "string",
  "ticker": "string",
  "buyOrderId": "string",
  "sellOrderId": "string",
  "price": 99.52,
  "quantity": 100,
  "timestamp": 1234567890
}
```

**`order_placed`** — confirmation to the originating client

```json
{
  "orderId": "string",
  "status": "open | filled | partial"
}
```

**`order_cancelled`** — confirmation to the originating client

```json
{
  "orderId": "string",
  "status": "cancelled"
}
```

**`error`** — validation or business logic failure

```json
{
  "message": "string"
}
```

---

## Testing Expectations

### Unit Tests (Track 1 — domain)

Every class and function in `src/domain/` must have a corresponding `*.spec.ts` file. Cover:

- `PriceLevel`: enqueue, dequeue, remove, isEmpty, totalQuantity, snapshot
- `OrderBook`: add order creates price level, cancel removes order, top-of-book correctness, snapshot shape
- `MatchingEngine`: no match (spread too wide), full fill, partial fill, multi-level fill, time priority within a price level, self-trade prevention (buyer and seller are the same trader — treat as no match)

### Integration Tests (Track 2 — services)

Test `OrderService` end-to-end through the service layer without a live WebSocket. Use NestJS testing module. Cover:

- Place order → no match → book state correct
- Place order → full match → trade emitted, book updated
- Place order → partial match → residual rests in book
- Cancel order → book updated, event emitted
- Unknown ticker → new book created automatically

### E2E Tests (Track 3 — gateway)

Use a real Socket.IO client against a live test server. Cover:

- Full message round-trip: `place_order` → `order_placed` + `orderbook_update`
- Cross-client trade: two clients, one buys, one sells → both receive `trade_executed`
- Subscription scoping: subscribing to TW should not receive updates for AAPL

---

## Angular Frontend

The UI is intentionally minimal. It should demonstrate the WebSocket integration, not win a design award.

**Required components:**

- **OrderEntryForm** — inputs for ticker, side, price, quantity; submit calls `place_order`
- **OrderBookDisplay** — renders bid/ask table from latest `orderbook_update` for a subscribed symbol; bids descending, asks ascending
- **TradeFeed** — scrolling list of `trade_executed` events

**WebSocket service** wraps `ngx-socket-io` and exposes typed observables for each outbound event type.

---

## Dependencies

### Monorepo Root

```json
{
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "install": "npm install --workspaces",
    "start": "concurrently \"npm:start --workspace=server\" \"npm:start --workspace=client\"",
    "test": "npm run test --workspaces --if-present"
  },
  "devDependencies": {
    "concurrently": "^8.x"
  }
}
```

### Server

```json
{
  "dependencies": {
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/platform-socket.io": "^10.x",
    "@nestjs/websockets": "^10.x",
    "socket.io": "^4.x",
    "sorted-btree": "^1.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x",
    "rxjs": "^7.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.x",
    "@types/node": "^20.x",
    "@types/uuid": "^9.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "supertest": "^6.x",
    "typescript": "^5.x"
  }
}
```

### Client

```json
{
  "dependencies": {
    "@angular/core": "^17.x",
    "@angular/common": "^17.x",
    "@angular/forms": "^17.x",
    "@angular/platform-browser": "^17.x",
    "ngx-socket-io": "^4.x",
    "socket.io-client": "^4.x",
    "rxjs": "^7.x"
  }
}
```

---

## Code Conventions

- **TypeScript strict mode is on.** No `any`. No non-null assertions without a comment explaining why.
- **NestJS patterns:** Use `@Injectable()` services, `@WebSocketGateway()` for transport, `@SubscribeMessage()` for inbound handlers. No business logic in the gateway — it delegates to services only.
- **No persistence.** Do not introduce a database, file system writes, or any external store.
- **Immutability at boundaries.** Snapshots returned to clients must be copies, not references to internal state.
- **Errors are typed.** Use a consistent `AppError` or NestJS `WsException` pattern rather than throwing raw strings.
- **Naming:** `camelCase` for variables and methods, `PascalCase` for classes and interfaces, `SCREAMING_SNAKE_CASE` for true constants.

---

## What to Build — Sequence

Follow this order to maximize logical layering and testability at each step:

1. Project scaffold — root `package.json` with workspaces + `concurrently`, server and client workspace `package.json` files, tsconfig files
2. Domain types — all interfaces in `src/domain/models/`
3. PriceLevel — class + unit tests
4. OrderBook — class + unit tests
5. MatchingEngine — pure matching logic + unit tests
6. OrderBookRegistry — NestJS service
7. OrderService — coordinates matching, book updates, event emission + integration tests
8. TraderService — lightweight identity management
9. WebSocket Gateway — inbound handlers, DTO validation
10. Event publishing — outbound event emission wired through OrderService
11. Angular client — WebSocket service, three components
12. E2E tests — full round-trip validation
13. README — verify `npm install` / `npm start` from root works clean; document architecture and perf profile

---

*This file was authored prior to code generation and reflects deliberate architectural decisions. Do not deviate from the patterns described here without a documented reason.*

*Any new information, updates, or corrections to this file — including decisions that contradict the initial declarations above — must be appended below this line as a dated addendum. Do not edit the sections above. The addendum is the authoritative record of architectural drift.*

---

## Addenda

### 2026-05-05 — Session Prompt Logging

After every user prompt, append the prompt to `/prompts/session-log.md` under the current session heading before doing anything else. Use the format already established in that file: a `### Prompt N — Short Title` heading, followed by a newline, followed by the prompt text as a blockquote.

### 2026-05-05 — Defensive Copying for Mutable Domain Objects

All classes that hold collections of mutable domain objects (`Order`, etc.) must apply defensive copying at their boundaries to prevent external callers from silently corrupting internal state. The established pattern, as implemented in `PriceLevel`, is:

- **`enqueue` (write):** Store a shallow copy (`{ ...order }`) rather than the caller's reference. The caller retaining or mutating their original object cannot affect book state.
- **`peek` (read without transfer):** Return a shallow copy. The caller receives the current values but cannot mutate the live object through that reference.
- **`dequeue` (read with transfer):** Return the actual internal reference. Ownership transfers to the caller; they may mutate it freely (e.g., the matching engine updating `remainingQty`). Document this transfer of ownership in a comment.
- **`snapshot` (aggregate read):** Always return a plain value object constructed from internal state — never a reference into the collection.

Apply this same boundary discipline in `OrderBook` and any future service that holds live domain objects. The goal is that no caller can observe a change they did not explicitly make through a mutating method.

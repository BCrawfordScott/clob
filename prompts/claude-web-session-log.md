# AI Session Log — CLOB Project

This file captures the prompts submitted to Claude (claude.ai) and the substantive responses received during the architectural planning phase of this project. It is included for transparency and reproducibility.

---

## Session 1 — Architecture & Build Planning

**Date:** 2026-05-05

---

### Prompt 1

> As part of a software engineering project, I have been tasked with implementing a "simple Central Limit Orderbook (CLOB)."
>
> I have been given a clear set of expectations and criteria for building the CLOB, with explicit encouragement to use agentic AI tools. I will share the prompt along with these instructions.
>
> For this project, I would like to establish a roadmap and build order for each piece of the CLOB that will facilitate the following:
>
> * My understanding of each layer as we build it
> * Use of Claude Code to actually generate the code
> * Logical layering of each piece
> * Mimic parallelized workflows, ie: imagine 3 engineers were working on this simultaneously, how would the work be logically separated so they could all work independently and come together in the end
>
> Now, please analyze the prompt, and outline the build order for each piece of the project. After review, we will move on to generating the Claude.md file for the project.
>
> **Project spec provided:**
> - Platform: Node.js
> - Language: TypeScript
> - Framework: NestJS
> - API: WebSocket
> - State: In-memory only, no persistence layer
> - Core domain objects: Ticker, Trader, Order, Trade
> - Matching algorithm: price-time priority
> - Public view: anonymous, aggregated by price level
> - Internal view: full order identity and ownership

**Response summary:**

Analyzed the domain and proposed a three-track parallel build structure:

- **Track 1 — Domain Core:** Pure business logic with no framework dependencies. PriceLevel, OrderBook, MatchingEngine, and all unit tests. Fully testable in isolation.
- **Track 2 — Application Services:** NestJS services coordinating domain objects. OrderBookRegistry, OrderService, TraderService, and integration tests.
- **Track 3 — Transport Layer:** NestJS WebSocket gateway, DTOs, validation, and event publishing. E2E tests via real Socket.IO client.

Sequential build order established:
1. Project scaffold
2. Domain types
3. PriceLevel + OrderBook + tests
4. MatchingEngine + tests
5. OrderBookRegistry
6. OrderService + integration tests
7. WebSocket Gateway (inbound)
8. Event publishing (outbound)
9. Angular client
10. E2E tests
11. README

Key design decisions flagged for CLAUDE.md: MatchingEngine as pure/stateless function, typed domain events, separation of internal vs. public orderbook snapshot shape, WebSocket DTOs defined upfront.

---

### Prompt 2

> Before we build the Claude.md, I'd also like to formalize the performance expectations and dependencies we anticipate.
>
> I understand CLOBs have very specific performance expectations:
> * O(1) look up - "top of book"
> * O(n) get all - full order book
> * O(1) deletion - remove order by Id
> * O(log n) insertion - new orders inserted, sorted by price
>
> This means we'll need a data structure like a Red Black tree to maintain our BuyOrder and SellOrder orderbooks. I don't think it's worth building this from scratch - what's an appropriate existing library we can use?
>
> Each node in the orderbooks tree will need a queue to represent the "price-time priority" of orders. Is there a JS Queue library worth adding as a dependency, or should we simply use an array with a dedicated interface?
>
> We will need a frontend for the UI, given the emphasis on websockets I think Angular would be an appropriate choice. The UI will not need to be complex, just providing the interface necessary to use the application. We'll also need websocket dependencies, I believe.
>
> List out the dependencies we predict we'll need.

**Response summary:**

**Red-Black Tree / Sorted structure:** Recommended `sorted-btree` (npm). Provides O(log n) insert/delete, O(1) min/max key access (top of book), full TypeScript types, actively maintained. Alternatives evaluated and rejected: `bintrees` (unmaintained, no types), `functional-red-black-tree` (immutable, unnecessary overhead), `js-sdsl` (heavier, less ergonomic).

**Queue for price-time priority:** Recommended a plain array with a dedicated `PriceLevel` class interface — no library needed. Queue depth per price level is typically small; `push()`/`shift()` is sufficient. `denque` noted as a path to true O(1) dequeue if needed, worth mentioning as a known tradeoff.

**Frontend:** Confirmed Angular is appropriate given the WebSocket/RxJS-native architecture. `ngx-socket-io` recommended as the Angular WebSocket wrapper; pairs with NestJS's built-in Socket.IO adapter.

**Full dependency list produced:**

*Server:* `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-socket.io`, `@nestjs/websockets`, `socket.io`, `sorted-btree`, `class-validator`, `class-transformer`, `rxjs`, `uuid` (prod); `@nestjs/testing`, `jest`, `ts-jest`, `supertest`, `typescript`, `@types/node`, `@types/socket.io` (dev).

*Client:* `@angular/core` + standard Angular suite, `ngx-socket-io`, `socket.io-client`, `rxjs`.

**Performance profile table established:**

| Operation | Target | Implementation |
|---|---|---|
| Top of book | O(1) | `btree.minKey()` / `btree.maxKey()` |
| Insert order | O(log n) | `btree.set()` |
| Cancel order by ID | O(1) lookup + O(m) removal | Hash map + PriceLevel splice |
| Full book snapshot | O(n) | Tree iteration |

O(m) removal noted as known tradeoff; doubly-linked list identified as upgrade path.

---

### Prompt 3

> Yes, let's draft the Claude.md

**Response summary:**

Produced the full `CLAUDE.md` covering:
- Project overview and stack
- Repository structure with three-track folder layout
- Complete domain model (TypeScript interfaces for Ticker, Trader, Side, Order, Trade, PriceLevelSnapshot, OrderBookSnapshot)
- Performance profile table
- Data structure specifications (OrderBook via sorted-btree, PriceLevel interface contract, MatchingEngine as stateless pure function with explicit signature)
- Full WebSocket message protocol (inbound: `place_order`, `cancel_order`, `subscribe_book`; outbound: `orderbook_update`, `trade_executed`, `order_placed`, `order_cancelled`, `error`)
- Testing expectations across all three tracks (unit, integration, E2E)
- Angular frontend component breakdown
- Full dependency lists for server and client
- Code conventions (strict TypeScript, NestJS patterns, immutability at boundaries, typed errors, naming conventions)
- 13-step sequential build order
- Closing architectural declaration and addendum policy

---

### Prompt 4

> Which of the two better facilitates ease of use: `npm install && npm start` then it just works? [monorepo vs. sibling directories]

**Response summary:**

Recommended monorepo with npm workspaces. With sibling directories the reviewer needs two terminals and two install/start sequences. With a monorepo root, a single `npm install && npm start` from the root installs all workspaces and uses `concurrently` to run both the NestJS server and Angular client in one terminal with prefixed, color-coded output. `npm run test --workspaces` also runs the full test suite from the root in a single command.

Root `package.json` scripts shape provided:

```json
{
  "scripts": {
    "install": "npm install --workspaces",
    "start": "concurrently \"npm:start --workspace=server\" \"npm:start --workspace=client\"",
    "test": "npm run test --workspaces --if-present"
  },
  "workspaces": ["server", "client"]
}
```

`concurrently` added as a root-level dev dependency.

---

### Prompt 5

> Yes update the Claude.md to be a mono-repo, and also remove the explicit mentions of [the company] or "[assessment type]": I intend to publish this on GitHub, and don't want to accidentally make public [the company's] assessment format.

**Response summary:**

Applied the following changes to `CLAUDE.md`:
- Title updated to `CLOB Project`
- Project overview rewritten to describe the system generically
- `npm install/start` bullet updated to reference monorepo root
- Repository structure updated: root `package.json` added, `prompts/` and `test/` relocated, `server/` and `client/` restructured as proper workspace siblings
- Dependencies section restructured with a new **Monorepo Root** block containing the `package.json` shape
- "Known tradeoff" note cleaned of assessment-specific language
- Build sequence step 1 updated to specify root `package.json` with workspaces
- README step reframed neutrally

---

### Prompt 6

> One more change: the final line is good. I'd like to add an additional instruction that explicitly states any new information added to this claude.md should go below the architectural declarations as an addendum, even contradictions to the initial declarations.

**Response summary:**

Updated the closing section of `CLAUDE.md` to include:
1. The original immutable declaration (do not deviate without documented reason)
2. A new addendum policy: all new information, updates, or contradictions must be appended below as a dated addendum — never retroactively editing the sections above
3. An `## Addenda` header standing ready for Claude Code to populate

Rationale: gives Claude Code a sanctioned escape valve when reality diverges from the plan, while preserving a clear audit trail of architectural drift.

---

### Prompt 7

> Please produce an export of this chat's prompts/responses for inclusion in the /prompts directory of the project. Where possible, scrub mention of [the company] and that this is [an assessment].

**Response summary:**

Produced this document. Reconstructed manually from conversation context as the transcripts directory was not populated. Prompts paraphrased and sanitized; response summaries written to capture substantive decisions and reasoning without reproducing the full verbatim exchange.

---

### Prompt 8

> Claude Code produced the following PriceLevel class. I want to review it for durability, and scrutinize the `peek()` method: should it return a copy of the order at index[0] to safeguard against mutation?
>
> *(PriceLevel implementation provided for review)*

**Response summary:**

Confirmed that `peek()` should return a spread copy (`{ ...this.orders[0] }`) rather than a direct reference. Returning the live reference allows callers to silently mutate book state — particularly dangerous in the MatchingEngine's inner matching loop.

Extended the analysis to the full class:

- **`peek()`** — must return a shallow copy. `Order` contains only primitives and strings so a spread is a true copy; noted that nested reference types would require deep cloning in future.
- **`dequeue()`** — safe as-is because `shift()` removes the reference from the array before returning it, but the implicit "ownership transfer" contract should be documented in a JSDoc comment.
- **`snapshot()`** — confirmed safe; returns only primitive values, no object references.
- **`enqueue()`** — identified a subtle risk: the caller retains a reference to the same object after enqueuing, meaning post-enqueue mutations affect live book state. Recommended storing a spread copy: `this.orders.push({ ...order })`.

Produced a revised final class with all four fixes applied and JSDoc comments on `enqueue()`, `dequeue()`, and `peek()` to make ownership and copy semantics explicit.

Noted one tradeoff for the review: spread copies are shallow, which is sufficient while `Order` contains only primitives. This assumption should be explicitly documented so it's easy to catch if `Order` ever gains a nested reference type.

---

### Prompt 9

> Update the session log document you created to include these most recent prompts, and from this point forward keep the session log document updated as this chat progresses.

**Response summary:**

Appended Prompts 8 and 9 to the session log. Established ongoing instruction: the session log will be updated at the end of each exchange for the remainder of this chat session.

---

*This log is actively maintained. New prompts and response summaries are appended as the session progresses.*

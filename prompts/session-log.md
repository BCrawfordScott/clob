# Session Prompt Log

All AI prompts used during development of this project with Claude Code, in chronological order.

NB: Each step began after using /clear to clear the current context of the claude-code session. Each Step began with the /plan command to establish what would be created before executing.

---

## Session 1 — 2026-05-05

### Prompt 1 — Project Understanding

> This directory contains only a CLAUDE.md file. Read the file and confirm for my your understanding of this project and its goals. Do not write any code.

### Prompt 2 — Step 1 Scaffold

> Yes, execute only step 1. Do not commit any changes to git. Be sure to create the /prompts directory as defined in the Repository Structure and append to it your sessions prompts as we go.

### Prompt 3 — Fix npm install

> npm install from the root is broken - the dependency tree has issues. Diagnose and resolve, please.

### Prompt 4 — Add session-log instruction to CLAUDE.md

> Update the claude.md to include instructions to always, after every prompt, append the prompt to the session-log.md. Make sure this instruction goes into the Addenda section of the Claude.md

### Prompt 5 — Create .gitignore

> Create a sensible gitignore for this project based on the current structure and the project's roadmap

### Prompt 6 — Plan Step 2

> Step 1 as outlined in What to Build - Sequence is complete. Please plan step 2 for review before executing.

### Prompt 7 — Plan Step 3

> Step 2 from What to Build - Sequence is complete. Please plan step 3 for review before executing.

### Prompt 8 — Defensive Copying Addendum

> I made three adjustments to the PriceLevel class: enqueue makes a shallow copy of the order before placing it in the queue, dequeue explicitly states in comments that the caller has the ability to mutate the order (as intended) and peek returns a shallow copy of the topmost order. These are defensive mechanisms to prevent order state corruption. UPdate the claude.md in the Addenda section to conform to this type of defensive mutable state care for future class/service implementations.

### Prompt 9 — Fix Tests After Manual Changes

> run the test suite and address any failures based on the manual changes I made.

### Prompt 10 — Test Defensive Copying Behavior

> Add test cases to enqueue and peek that cover the copying mechanisms we've added, validating that the return value of peek is not the 0 index order in the queue, and that the order enqueued by enqueue is not equal to the order given as the argument.

## Session 2 — 2026-05-06

### Prompt 11 — Plan Step 4

> Steps 1 - 3 of the What to Build - Sequence list in the Claude.md are complete. Please Plan step 4 before we execute.

### Prompt 12 — Execute Step 4 Without Ultraplan

> Proceed without ultraplan, I would like to manually approve each edit

### Prompt 13 — Build Test File and Run Tests

> Build the test file now and run the tests

## Session 3 — 2026-05-07

### Prompt 14 — Step 5: MatchingEngine (see Session 3 above)

> Steps 1–4 are complete. The domain layer has PriceLevel (FIFO queue over Order[] with enqueue, dequeue, prepend, remove, peek, isEmpty, totalQuantity, and snapshot) and OrderBook (BTree-backed bid/ask sides with addOrder, cancelOrder, bestBidLevel, bestAskLevel, peekBestBid, peekBestAsk, removePriceLevel, and snapshot). We are now implementing Step 5: the MatchingEngine.
>
> Responsibility Boundaries
> MatchingEngine.match() owns mutations on a PriceLevel. It may call dequeue() and prepend() on the level it is given. It does not touch the OrderBook directly — no removePriceLevel(), addOrder(), or cancelOrder().
> OrderService owns mutations on the OrderBook. It fetches levels from the book, passes them to match(), and after each call applies book-level mutations: removing exhausted levels and adding residual orders.
>
> Design
> match() receives the incoming order and the live counter-side price level to match against. It walks the orders in that level from front to back, consuming resting orders via dequeue(), producing one Trade per fill, and returning when either the taker is satisfied or the level is exhausted. If a resting order is partially filled, it is restored to the front of the level via prepend() with the updated remainingQty before returning.
> OrderService drives the cross-level loop:
> [...]
>
> Files to Create: matching-engine.ts and matching-engine.spec.ts with 12 test cases covering no-match, full fill, partial fill, multi-level fill, time priority, self-trade prevention, order ID assignment, and maker's price used.

### Prompt 15 — Step 6: OrderBookRegistry

> Step 5 in What to Build - Sequence of Claude.md is complete. Please plan step 6: The OrderBookRegistry is a NestJS @Injectable() singleton that acts as the directory of all active OrderBook instances in the system.
> Its sole responsibility is answering one question: given a ticker symbol, give me its OrderBook. That's it.
> [implementation sketch with getOrCreate and get methods provided]

### Prompt 16 — Step 7: OrderService

> Step 6 in the What to Build - Sequence is complete. Please plan step 7. Use placeholders for event emission for now, as events are designated for a future step.

### Prompt 17 — OrderService refactors

> Three fixes are required in order.service.ts, plus one refactor to order-book-registry.service.ts.
> 1. Inject MatchingEngine via NestJS DI
> 2. Extract status derivation to a named private method deriveStatus
> 3. Assert book existence in cancelOrder (throw on invariant violation instead of optional chain)
> 4. Move orderTicker map to OrderBookRegistry with registerOrder, unregisterOrder, findTickerByOrderId methods

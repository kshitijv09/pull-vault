# Auction Architecture

## Overview

The auction system is an event-driven pipeline:

1. Initialize auction timers and live state.
2. Process bids atomically in Redis/Lua.
3. Stream updates over WebSocket.
4. Finalize on expiry in PostgreSQL.

Core requirements: consistency under simultaneous bids, server-authoritative time, and reliable recovery.

---

## Listing Lifecycle

A listing moves through a deterministic state machine:

- `pending` → listed but not yet open for bidding.
- `live` → actively accepting bids in real time.
- `sold` → ended with a valid winner.
- `unsold` → ended with no valid winner.

**Pending → Live:** Listings are created in slots with scheduled start times. Frontend uses slot timing and listing status to activate real-time bidding UX.

**Live bidding path:** Redis + Lua handles bid validation, highest-bid updates, wallet hold/release, and anti-sniping extensions. WebSocket publishes bid updates, min-next-bid, bid history, and viewer count.

**Expiry → Sold/Unsold:** Redis key expiry events trigger `auctionExpiryProcessor`. Processor runs a DB transaction to finalize listing status, transfer card ownership, persist wallet balances, credit seller net proceeds (winning bid minus 10% fee), and record company earnings.

**Fee model:** Buyer pays winning bid. Seller receives 90%. Platform earns 10% seller-side fee.

---

## Architecture

### Phase 1 — Auction initialization and timer

- Auction start writes authoritative end-time state (Redis timer key + DB listing end-time).
- Frontend receives end time and renders a display countdown (`endTime - now`).
- Bid scripts validate auction is still within valid end-time before mutation.

### Phase 2 — Wallet handling and lazy loading

- Auction wallet balances are lazy-loaded into Redis on first bid session / init.
- Outbid users receive wallet restoration in cached auction state.
- Cached balances are reconciled back to DB on finalization.

### Phase 3 — Core bidding logic (Lua)

- Bid requests (`auctionId`, `bidderId`, `biddingPrice`) run through atomic Lua scripts.
- Scripts enforce bidder/price validity, current-high updates, and state write ordering.
- End-time checks prevent post-expiry mutations.

### Phase 4 — Increment rules and anti-sniping

- Min increment derived from configured price bands.
- Socket payloads include `minNextBidUsd` so UI can enforce valid bid entry.
- Anti-sniping extends end-time when bids arrive in the trigger window near close.
- Extension count is tracked; once it reaches `AUCTION_ANTI_SNIPING_EXTENSIONS_BEFORE_SEALED`, sealed phase starts.

### Phase 5 — Sealed bid phase

Triggered after `AUCTION_ANTI_SNIPING_EXTENSIONS_BEFORE_SEALED` anti-snipe extensions have fired on a single listing. Constants: `AUCTION_ANTI_SNIPING_EXTENSIONS_BEFORE_SEALED`, `AUCTION_SEALED_PHASE_MIN_DURATION_MS` (in `shared/constants/auctionSealedPhase.constants.ts`).

**Semantics (Option A — single sealed envelope):**
- Each user may submit or replace one sealed bid until the auction closes.
- Stored in Redis: `pullvault:auction:<id>:sealed_bids` (hash, userId → amount).
- No public broadcast of competitor sealed bids; UI shows "Sealed phase — bids hidden."
- Anti-snipe extensions are disabled once sealed is active.

**Winner resolution (finalize):** `max(open_phase_high_bid, all_sealed_bids)`. Ties broken by submission timestamp.

**Wallet handling:** Balance is reserved on sealed submission (atomic Lua); non-winners are refunded during finalization.

**Redis keys:**
| Key | Purpose |
|-----|---------|
| `pullvault:auction:<id>:anti_snipe_extensions` | Count of extensions applied |
| `pullvault:auction:<id>:sealed_phase` | `"1"` when sealed phase active |
| `pullvault:auction:<id>:sealed_bids` | Hash of userId → amount |

**API:** `POST /auctions/:auctionId/bids/sealed` (auth required). Open-phase bid endpoint returns 400 once sealed is active.

**Socket events:**
- `auction_sealed_phase_started` — `{ auctionListingId, endTime, reason: "anti_snipe_threshold" }`
- `auction_finalized` — unchanged, adds optional `winningBidSource: "open" | "sealed"`.

### Phase 6 — Pub/Sub and socket notifications

- Redis Pub/Sub fans out events to subscribed auction clients.
- Broadcast includes bid updates, min-next-bid, bid history, and lifecycle events.
- During sealed phase, no competitor bid amounts are broadcast.

### Phase 7 — Viewer tracking and state sync

- Unique viewers tracked and counted per auction.
- Viewer-count events broadcast on membership changes.
- New/reconnected clients receive current high bid + bid history snapshot.

### Phase 8 — Expiry handling

- Redis key expiry triggers `auctionExpiryProcessor`.
- Finalizer loads sealed bids + open phase cached state.
- DB settlement transaction: mark listing sold/unsold, transfer card ownership, settle wallets, persist company earnings.
- Runtime auction cache cleared after settlement.

---

## Fraud Review Heuristics

`POST /auctions/:auctionId/fraud-review` runs `AuctionService.evaluateAuctionFraudReview`. Computes H1, H2, H3, H6 independently; sets `auction_listings.needs_fraud_review` if **any** fires (logical OR). Constants in `backend/src/shared/constants/auctionFraudReview.constants.ts`. Open-phase bids are read from `auction_bid_history`.

### H1 — Repeated pair trading

Catch sellers and buyers who repeatedly close sold auctions with each other (wash trading / collusion).

**Trigger:** Count sold listings in the last `AUCTION_FRAUD_REPEAT_PAIR_WINDOW_DAYS` (default 30) with the same `seller_id` and `current_high_bidder_id`. If count ≥ `AUCTION_FRAUD_REPEAT_PAIR_MIN_CLOSED_TRADES` (default 3), H1 fires.

### H2 — Uncontested low-price close

Auction closes sold with one distinct open-phase bidder and a winning bid far below catalog value.

**Trigger:** `status === 'sold'`, exactly one distinct `bidder_id` in `auction_bid_history`, `market_value_usd > 0`, and `current_high_bid / market_value_usd < AUCTION_FRAUD_UNCONTESTED_LOW_PRICE_RATIO_MAX` (default 0.3).

### H3 — Heavy open bidding then losing

Targets one listing where a non-winner placed many open-phase bids (price pumping / burner account).

**Trigger:** Listing `status === 'sold'`, winner set. Among non-winners and non-sellers, take per-bidder counts in `auction_bid_history`. H3 fires if `max ≥ AUCTION_FRAUD_H3_MIN_OPEN_BIDS_NON_WINNER` (default 6).

### H6 — Single-account bid spam

Rapid-fire bids from one account, or bids that violate minimum increment rules.

**Trigger (either):**
1. **Rolling window:** for each bid as window start, count that bidder's bids in `[bid_at, bid_at + AUCTION_FRAUD_BID_SPAM_WINDOW_SECONDS]` (default 60s). If max count `> AUCTION_FRAUD_BID_SPAM_COUNT_THRESHOLD` (default 5), H6 fires.
2. **Increment:** walk bids ordered by `bid_at`. Any bid below prior bid + `min_increment` from `auction_bid_increment_rules` increments a violation counter; if `> 0`, H6 fires.

### API response

Returns `AuctionFraudReviewResult` (`auction.types.ts`): boolean flags per heuristic, aggregate `needsFraudReview`, and a `heuristics` object with the numeric metrics for auditing and tuning.

---

## Analytics API

Mounted at `GET /api/analytics/auctions/summary` and `GET /api/analytics/auctions/timeseries`.

### `GET /summary`

Query params: `range` (`24h` | `7d` | `30d` | `90d` | `ytd` | `all`), `from` / `to` (ISO datetime override), `snipeWindowSeconds` (5–600, default 30).

**Population:** Listings with `status IN ('sold','unsold')` whose `end_time` falls in the resolved window.

**Metrics:**
- **Participation:** share of settled listings with ≥ 1 row in `auction_bid_history`; avg distinct open bidders and avg open bid rows.
- **Pricing vs market (sold only):** `current_high_bid / card.market_value_usd` — avg and median.
- **Snipe rate (sold, open phase):** share of sold listings where `MAX(bid_at) ≥ end_time − snipeWindowSeconds`.
- **Flag rate:** share with `needs_fraud_review`.
- **Sealed phase:** count / rate with `sealed_phase_active`.

### `GET /timeseries`

Same range params plus `groupBy` (`day` | `week` | `month`, default `day`), `order` (`asc` | `desc`, default `desc`). Buckets by `date_trunc(groupBy, end_time)` with counts: settled, sold, unsold, listings with open bids, fraud-flagged.

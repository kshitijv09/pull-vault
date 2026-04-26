# Auction Architecture

## Logic

The auction system is built as an event-driven pipeline:

1. initialize auction timers and live state,
2. process bids atomically in Redis/Lua,
3. stream updates over WebSocket,
4. finalize on expiry in PostgreSQL.

Core requirements are consistency under simultaneous bids, server-authoritative time, and reliable recovery.

## Architecture as Implemented

### Phase 1: Auction initialization and timer

- Auction start writes authoritative end-time state (Redis timer key + DB listing end-time).
- Frontend receives end time and renders display countdown (`endTime - now`).
- Bid scripts validate auction is still within valid end-time before mutation.

### Phase 2: Wallet handling and lazy loading

- Auction wallet balances are lazy-loaded into Redis on first bid session/init.
- Outbid users receive wallet restoration in cached auction state.
- Cached balances are reconciled back to DB on auction finalization.

### Phase 3: Core bidding logic (Lua)

- Bid requests (`auctionId`, `bidderId`, `biddingPrice`) run through atomic Lua scripts.
- Scripts enforce bidder/price validity, current-high updates, and state write ordering.
- End-time checks prevent post-expiry mutations.

### Phase 4: Increment rules and anti-sniping

- Min increment is derived from configured price bands.
- Socket payloads include `minNextBidUsd` so UI can enforce valid bid entry.
- Anti-sniping extends end-time when bids arrive in trigger window near close.

### Phase 5: Pub/Sub and socket notifications

- Redis Pub/Sub fans out events to subscribed auction clients.
- Broadcast includes bid updates, min-next-bid, bid history, and lifecycle events.

### Phase 6: Bid history persistence

- Bid history (`amount`, `bidder`, `timestamp`) is persisted in DB.
- Recent history is included in socket snapshots/updates for reconnecting clients.

### Phase 7: Viewer tracking and state sync

- Unique viewers per auction are tracked and counted.
- Viewer-count events are broadcast when membership changes.
- New/reconnected clients receive current high bid + bid history snapshot.

### Phase 8: Expiry handling

- Redis key expiry triggers `auctionExpiryProcessor`.
- Finalizer loads cached high bid + wallet state and executes DB settlement transaction:
  - mark listing sold/unsold,
  - transfer card ownership when sold,
  - settle seller payout and platform fee,
  - persist and synchronize wallet balances.
- Runtime auction cache is cleared after settlement.

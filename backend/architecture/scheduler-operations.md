# Scheduler Operations

## Logic

Background schedulers handle time-based consistency and analytics freshness:

- finalize expired auctions,
- refresh inventory-linked card prices,
- and persist user portfolio snapshots.

## Architecture as Implemented

1. **Auction Expiry Processor**
   - Start call: `startAuctionExpiryProcessor()`
   - Wired in: `backend/src/server.ts`
   - Implementation: `backend/src/modules/auction/auctionExpiryProcessor.ts`
   - Behavior: subscribes to Redis key expiry and finalizes auctions.

2. **Inventory Card Price Refresh Job**
   - Start call: `startInventoryCardPriceRefreshJob()`
   - Wired in: `backend/src/server.ts`
   - Implementation: `backend/src/jobs/inventoryCardPriceRefreshJob.ts`
   - Behavior: periodic price refresh + publish updates.

3. **User Portfolio Snapshot Job**
   - Start call: `startUserPortfolioSnapshotJob()`
   - Wired in: `backend/src/server.ts`
   - Implementation: `backend/src/jobs/userPortfolioSnapshotJob.ts`
   - Behavior: periodic portfolio snapshot persistence.

## Current Status

The scheduler startup calls above are currently commented/disabled in `backend/src/server.ts`.

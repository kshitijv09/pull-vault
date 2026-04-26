# Auction Listing Lifecycle

## Logic

An auction listing moves through a deterministic state machine:

- `pending`: listed but not yet open for bidding.
- `live`: actively accepting bids in real time.
- `sold`: ended with a valid winner.
- `unsold`: ended with no valid winner.

The system prioritizes fast bid-time operations with Redis and authoritative settlement in PostgreSQL.

## Architecture as Implemented

- **Pending to Live**
  - Listings are created in slots with scheduled start times.
  - Frontend uses slot timing and listing status to activate real-time bidding UX.
- **Live bidding path**
  - Redis + Lua handles bid validation, highest-bid updates, wallet hold/release behavior, and anti-sniping extensions.
  - WebSocket publishes bid updates, min-next-bid, bid history, and viewer count to subscribed clients.
- **Expiry to Sold/Unsold**
  - Redis key expiry events trigger `auctionExpiryProcessor`.
  - Processor reads final cached highest bid + bidder, then runs a DB transaction to:
    - finalize listing status (`sold` or `unsold`),
    - transfer card ownership for sold listings,
    - persist participant wallet balances,
    - credit seller net proceeds (winning bid minus 10% fee),
    - record company earnings.
- **Fee model (current)**
  - Buyer pays winning bid only.
  - Seller receives 90% of winning bid.
  - Platform earns 10% seller-side auction fee.

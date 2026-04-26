# PullVault -- Work Trial

Build a Pokemon card collectibles platform with pack ripping, real market data, peer-to-peer trading, and live auctions.

---

## Before You Start

This trial has two parts.

**Part A** is the core platform build. **Part B** introduces requirement changes, a platform economics challenge, and integrity systems. Part B is sent after you submit Part A.

Most strong candidates complete both. Plan your time accordingly. Do not over-polish Part A at the expense of never reaching Part B. A working system with rough edges that reaches Part B is better than a pixel-perfect Part A that stops there.

Total time: 40 hours. All tools available.

---

## Product Concept

PullVault is a consumer platform where users buy mystery packs of Pokemon cards, reveal them one by one, and discover their real market value. Users build a portfolio of cards whose values fluctuate with the real TCGPlayer market, trade cards with other users, and compete in live auctions.

The core loop: **Deposit funds. Buy a pack. Rip it open. Discover what you pulled. Hold it, trade it, or auction it.**

Reference products: Courtyard.io, Packz.io, StockX, Pokemon TCG Live

---

## Key Parameters

Some parameters are fixed. Others are yours to design.

| Parameter | Value |
|-----------|-------|
| Item Type | Pokemon TCG cards |
| Price Source | TCGPlayer API / Pokemon TCG API (free tier) |
| Currency | USD (paper trading -- default balance is yours to decide) |
| Pack Tiers | You decide. Multiple tiers at different price points. Justify your choices. |
| Cards Per Pack | You decide per tier. |
| Pack Prices | You decide per tier. Must create a meaningful range from casual to high-stakes. |
| Trading Fee | You decide. The platform must take a cut on trades. |
| Auction Fee | You decide. The platform must take a cut on auctions. |
| Min Bid Increment | You decide. |
| Auction Durations | You decide. Multiple options. |
| Anti-Snipe Mechanism | Sniping is a known problem in online auctions. Design a solution. |
| Rarity Weights | You decide per pack tier. The economics must work -- explain in your architecture doc. |

You will be asked to justify every parameter choice in the review call.

---

## Objective

Build a working platform where a user can:

- Sign up and see their balance
- Browse available packs and see a countdown to the next drop
- Buy a pack when the drop goes live (competing with other users for limited inventory)
- Rip the pack open, reveal cards one by one, see each card's real TCGPlayer market value
- View their collection with live-updating portfolio value
- List a card for sale or browse other users' listings and buy
- Put a card up for live auction and watch bids come in real-time
- See platform economics: how much the house earns on fees, pack margins, etc.

We want your interpretation, not pixel-perfect uniformity. Cut scope wherever necessary to get the important parts working. But the parts you do build must work correctly under concurrent usage -- no race conditions, no double-spending, no phantom inventory.

---

## Deliverables

### 1. Pack Drop System

Limited packs drop at scheduled times. This is the concurrency test.

**Drop mechanics:**

Packs have limited inventory. Drops go live at a scheduled time. Before the drop, users see a countdown. At drop time, users compete to buy. Inventory decrements are visible in real-time via WebSocket. After selling out, users see a clear sold-out state.

You decide the inventory quantities per tier per drop.

**What must not break:**

- If N users click 'Buy' on M available packs at the same millisecond, exactly M purchases succeed and exactly N-M get a clean 'Sold Out' error. Not M+1. Not M-1.
- A user's balance must be debited atomically with the inventory decrement. No state where the money is taken but the pack isn't granted, or vice versa.
- A user cannot buy more packs than they can afford, even if they click rapidly or send concurrent API requests.

**Key goal:** This should feel like a real drop. Tense countdown. Instant resolution. No ambiguity about whether you got it or not.

---

### 2. Pack Reveal Experience

After purchasing, the user rips the pack open and reveals cards.

**Reveal flow:**

- Pack appears on screen (can be simple -- doesn't need to be 3D)
- User clicks/taps to open
- Cards revealed one at a time: name, set, image, rarity, and current market value
- Build tension: commons revealed first, rares last
- Summary screen: all cards laid out, total pack value vs price paid, profit/loss indicator

**Rarity system:**

Design a rarity distribution per pack tier. Higher-priced packs should have better odds at rare cards. The exact weights are yours to decide, but they must be documented and the economics must make sense (covered in your architecture doc and tested further in Part B).

Cards are drawn from a pool of real Pokemon cards fetched from the API. Pack contents must be determined server-side at purchase time (not at reveal time) to prevent manipulation.

**Key goal:** The reveal should feel satisfying. The market values make it exciting -- pulling a card worth more than your pack price is the dopamine hit.

---

### 3. Live Market Prices and Price Engine

Every card in the system has a real market value that changes over time.

**Data source:**

- Primary: TCGPlayer API (https://docs.tcgplayer.com/docs) -- free developer tier
- Fallback: Pokemon TCG API (https://pokemontcg.io/) -- free, no auth needed
- If TCGPlayer access takes time to approve, use Pokemon TCG API for card data and simulate prices based on rarity with realistic variance

**Price pipeline:**

Build a system that keeps card prices current. How often you poll, how you cache, and how you push updates to clients is your design decision. Document your approach and its tradeoffs.

**Key goal:** The portfolio should feel alive. Prices move. Your net worth changes. It creates the urge to check back.

---

### 4. Collection / Portfolio View

The user's card collection with live market data.

- Grid view of all owned cards with images
- Each card shows: image, name, set, rarity, current market value, P&L since acquisition
- Sorting and filtering (you decide which dimensions make sense)
- Total portfolio value updating in real-time
- Portfolio performance over time
- Quick actions per card: list for sale, start auction, view details

**Key goal:** Feel like a premium portfolio tracker. Think Robinhood for Pokemon cards.

---

### 5. Peer-to-Peer Trading Marketplace

Users can list cards for sale and buy from other users.

**What must not break:**

- A listed card cannot be sold to two buyers (no double-selling)
- Transaction must be atomic: money moves AND card moves in one database transaction, or neither happens
- A seller cannot sell a card they've already listed in an active auction
- A buyer cannot buy with funds currently held in an auction bid

**Key goal:** Transactions must be bulletproof. Every edge case around concurrent purchases, insufficient funds, and card state conflicts must be handled.

---

### 6. Live Auction Room

The headline feature. Real-time competitive bidding.

**Auction room (real-time):**

- The card being auctioned with market value for reference
- Current highest bid, updating in real-time for all users in the room
- Bid history: who bid what, when (most recent first)
- Countdown timer (server-authoritative -- client timer is display only)
- Number of active watchers in the room
- 'Place Bid' button with amount input (auto-suggests minimum valid bid)

**Bidding rules:**

Design the bidding mechanics: minimum increments, bid holds on user balance, what happens when outbid, and how auctions close. Document your rules.

**Anti-sniping:**

Sniping (placing a bid in the final moments so no one can respond) ruins auctions. Design and implement an anti-sniping mechanism. There are multiple valid approaches -- pick one and justify it.

**What must not break:**

- Two simultaneous bids: one wins, one gets 'outbid'. State is never inconsistent.
- Timer is server-authoritative. Client countdown is display only.
- WebSocket disconnect mid-auction: user reconnects and sees current state.
- Balance holds are accurate -- no double-bidding with the same funds.
- Server crash: auction state recoverable from database, not just in-memory.

**Key goal:** This must feel live and competitive. Multiple users watching the same countdown, seeing bids pop in, feeling the tension. This is the hardest engineering challenge in the trial.

---

### 7. Platform Economics Dashboard

This is the business thinking test. Build an admin/analytics page showing:

**Revenue streams:**

The platform earns money from pack margins (pack price minus the expected value of cards inside) and fees on trades and auctions. Build a dashboard that shows how each revenue stream is performing.

**Pack profitability analysis:**

For each pack tier, show the expected value (EV) given your rarity weights and current market prices. The platform must have a sustainable margin WITHOUT making it feel like a ripoff. The house needs an edge, but the user needs to win often enough to stay engaged.

How you balance this is the core product economics question. Document your thinking.

**Key goal:** Show us you understand that a product isn't just code -- it's a business.

---

## Tech Stack (Mandated)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14+ (App Router) + TypeScript + Tailwind CSS |
| Backend | Next.js API Routes or Express/Fastify (TypeScript) |
| Database | PostgreSQL (Supabase, Neon, or self-hosted) |
| Cache / Pub-Sub | Redis (Upstash, Railway, or self-hosted) |
| Real-Time | WebSocket (Socket.io or ws) |
| Financial Math | decimal.js (floating point not acceptable for money) |
| Card Data | Pokemon TCG API, TCGPlayer, and [TCG Price Lookup](https://api.tcgpricelookup.com/v1/cards/search) (card search + pricing) |
| Deploy | Vercel, Railway, or similar |

---

## HTTP API reference

Base URL: `{API}/api` (e.g. `http://localhost:4000/api`). JSON bodies; responses wrap payloads in `{ "data": ... }` unless noted.

### Auth

Protected routes expect `Authorization: Bearer <JWT>` from `POST /users/login`.

### Users & wallet

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/users/signup` | No | Create account |
| `POST` | `/users/login` | No | Returns `{ token, user }` |
| `GET` | `/users/:userId` | Yes | Profile (must be self) |
| `POST` | `/users/:userId/wallet/deposit` | Yes | Add funds (self) |
| `GET` | `/users/:userId/cards` | Yes | Collection; optional query `rarity`, `cardSet`, `name`, `collectionListing` (`unlisted` default, `listed`, `all`) |
| `GET` | `/users/:userId/cards/facets` | Yes | Distinct rarities / sets for filters |
| `GET` | `/users/:userId/portfolio/value` | Yes | Live portfolio computation |
| `GET` | `/users/:userId/portfolio/snapshots?range=1d\|1w\|1m\|ytd` | Yes | Historical snapshot points |
| `POST` | `/users/:userId/portfolio/snapshot` | Yes | Record one snapshot row (self) |
| `POST` | `/users/:userId/cards/:userCardId/go-live-auction` | Yes | Create auction listing + set `auction_status` to `in_auction` (self; blocked if `listed`; optional body: `startBidUsd`, `reservePriceUsd`) |
| `POST` | `/users/:userId/cards/:userCardId/list-for-sale` | Yes | Body: `{ "listingPriceUsd": "<string>" }` — set `selling_status` to listed and insert **`marketplace_listings`** (self; blocked if `auction_status` is `in_auction`; price must be strictly positive, up to 2 decimals) |
| `POST` | `/users/:userId/cards/:userCardId/unlist` | Yes | Set `selling_status` back to default (self) |

### Catalog (TCG Price Lookup import)

Upstream search endpoint (same `x-api-key` as other TCG Price Lookup calls; set `TCG_PRICE_LOOKUP_API_KEY` in the backend env):  
`https://api.tcgpricelookup.com/v1/cards/search`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/catalog/tcg-search-import` | No | Body: `{ "searchParams": { "q": "..." } }` — forwards `searchParams` as query string to the upstream search, then upserts one **`card`** catalog row per unique external `card_id` in the response (near-mint market as `market_value_usd`, default `0.00` if absent). Skips only invalid rows and duplicate `card_id` values within the same response. Response: `{ "data": { "created", "skipped", "upstreamResultCount" } }`. |

### Peer marketplace (fixed-price)

The buyer pays the row’s **`marketplace_listings.listing_price_usd`**. Buyer pays from **`balance`** only (not `auction_balance`). Seller is credited the same amount (no platform fee in this build).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/marketplace/listings` | No | All cards with `selling_status = listed` |
| `GET` | `/marketplace/browse` | Yes | Same shape as listings, but **excludes** the signed-in user’s own listings (for the Marketplace UI) |
| `POST` | `/marketplace/purchase` | Yes | Body: `{ "userCardId": "<uuid>" }` — atomic: debit buyer at `marketplace_listings.listing_price_usd`, credit seller, delete seller `user_cards` (CASCADE drops listing), insert buyer `user_cards` (`user_pack_id` null) |

### Auctions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/auctions/listings` | No | List auction listings with slot metadata and card details. |
| `POST` | `/users/:userId/cards/:userCardId/go-live-auction` | Yes | Create an auction listing for an owned card and place it in a slot (uses provided `startBidUsd` / `reservePriceUsd` when present). |

### Earnings analytics (dashboard)

Backed by `company_earnings_ledger` rows generated from:
- marketplace purchase premium
- auction completion premium
- pack purchase margin (`pack price - total card value`)

Common query params supported across analytics endpoints:
- `range=24h|7d|30d|90d|ytd|all` (preset window)
- `from=<ISO datetime>` and/or `to=<ISO datetime>` (explicit window; overrides preset edge if both supplied)
- `eventTypes=marketplace_purchase,auction_completion,pack_purchase` (comma-separated subset)
- `order=asc|desc`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/analytics/earnings/overview` | No | KPI card payload + source breakdown in one call. |
| `GET` | `/analytics/earnings/timeseries` | No | Revenue time series for charts. |
| `GET` | `/analytics/earnings/events` | No | Raw/paginated ledger feed for detailed tables. |

`GET /analytics/earnings/overview` additional params:
- `sortBy=amount|events|average` (sorting source breakdown rows)

Response shape:
- `window` (`fromIso`, `toIso`)
- `summary` (`totalAmountGainedUsd`, `totalEvents`, `averagePerEventUsd`, `largestSingleGainUsd`)
- `sourceBreakdown[]` rows (`eventType`, total/avg/count)

`GET /analytics/earnings/timeseries` additional params:
- `groupBy=hour|day|week|month` (default `day`)

Response shape:
- `window`
- `filters`
- `points[]` with `bucketStart`, `totalAmountGainedUsd`, `totalEvents`

`GET /analytics/earnings/events` additional params:
- `sortBy=occurred_at|amount_gained_usd|event_type|created_at` (default `occurred_at`)
- `limit` (1..200, default 50)
- `offset` (>= 0)

Response shape:
- `window`
- `pagination`
- `sort`
- `events[]` with `eventType`, `transactionId`, `amountGainedUsd`, `occurredAt`, `metadata`

Dashboard use cases supported:
- KPI totals for any period (today, last 7 days, month, quarter, YTD, all-time)
- Source comparison (marketplace vs auction vs pack)
- Sorting source contribution by money, volume, or average per transaction
- Revenue trend charts (hour/day/week/month buckets)
- Drill-down table of individual earning events with pagination and sortable columns
- Focused slices by source type(s), custom date window, and ascending/descending order

---

## Submission

- **Deployed link** -- the app must be running and usable. We will test it.
- **GitHub repo** -- clean code, clear README with setup instructions, architecture overview, and scope cuts.
- **Architecture document** (1-2 pages in the repo) answering: How does the pack drop handle concurrent purchases? How does the auction maintain consistency? What is your caching strategy? What breaks first at 10,000 users? Walk through your pack EV math and parameter choices.
- **Loom walkthrough (max 8 min)**: 4 min demo of the full user flow, 4 min explaining the hardest technical problem you solved.

---

## Evaluation Criteria

| Criteria | Weight | What we look for |
|----------|--------|-----------------|
| Correctness Under Concurrency | 30% | Pack drops don't oversell. Trades are atomic. Auctions handle simultaneous bids. Balances always consistent. |
| Real-Time Experience | 20% | WebSocket updates feel instant. Auction room is live. Portfolio values update. Reconnection handled. |
| System Design & Architecture | 20% | Clean separation. Schema makes sense. API is RESTful. Architecture doc shows tradeoff understanding. Parameter choices are justified. |
| Platform Economics | 15% | Pack EV math is sound. Fee structure reasonable. Dashboard exists. Candidate can explain the business model. |
| Code Quality & Polish | 15% | TypeScript used properly. Error handling exists. UI is usable. README is helpful. |

Note: Visual design, animations, and pixel-perfection are NOT weighted heavily. We are evaluating engineering, not design. A clean, functional UI is sufficient.

---

## What We'll Test During Review

After submission, we schedule a 30-minute review call. Here's what happens:

- **We open your codebase live** and pick files to walk through. You need to understand every line of code. If you used AI tools, you need to understand what they generated.
- **We ask about your parameter choices:** 'Why these pack prices? Walk me through the EV math. Why this anti-snipe duration? What's your fee structure optimizing for?'
- **We ask specific questions:** 'Show me the code that handles two users buying the last pack simultaneously.' 'What happens if the auction WebSocket disconnects mid-bid?' 'Walk me through a trade transaction -- what guarantees atomicity?'
- **We try to break it.** We open the app in two browser tabs and try to buy the same pack, bid on the same auction, and buy the same listed card simultaneously. If things break, that's what we talk about.

---

## Prioritization Guide

**Must work perfectly (P0):**

- Pack purchase with correct concurrent inventory handling
- Card reveal with real market values
- Live auction room with real-time bids, anti-snipe, and correct resolution
- Atomic trading transactions (no double-sell, no phantom inventory)
- Correct balance management (available vs held funds)

**Should work (P1):**

- Price engine with caching and real-time portfolio updates
- Collection view with sorting and filtering
- Platform economics dashboard with pack EV analysis
- Architecture document with parameter justification

**Nice to have (P2):**

- Pack reveal animations
- Offer system on marketplace
- Multiple concurrent auctions
- Historical price charts per card
- Mobile-responsive design

---

## A Note on AI Tools

Use whatever tools you want -- Copilot, Claude, ChatGPT, Cursor, anything. We don't care how you write the code. We care that you understand the code. The review call is where we find out.

The parts of this trial that AI tools will struggle with: the concurrent inventory problem, the auction state machine, the balance hold/release lifecycle, the pack EV economics, the parameter design choices, and the architecture document. These require engineering judgment, not code generation.

---

Good luck. Build something that works correctly before it looks pretty.
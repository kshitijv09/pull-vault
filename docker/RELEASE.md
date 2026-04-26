# Render Release Steps (Docker)

This project uses four runtime components in production:

1. Backend API + WebSocket service
2. Pack purchase worker service
3. Frontend service
4. Redis (cache + queue broker + pub/sub)

Postgres is already hosted on Supabase and is reused directly.

## 1) Provision Redis on Render

Create a **Key Value** service in Render.

Copy the internal Redis URL and use it in:

- `REDIS_URL`
- `REDIS_SHARD_URLS` (single URL is fine)

Redis responsibilities in this app:

- pack reservation counters / tier lists
- queue broker for pack purchases (`PACK_PURCHASE_QUEUE_NAME`)
- pub/sub fanout for:
  - `PACK_TIER_UPDATES_CHANNEL`
  - `CARD_PRICE_BROADCAST_CHANNEL`
  - `AUCTION_BID_BROADCAST_CHANNEL`

## 2) Create Backend Web Service (Docker)

- Service type: **Web Service**
- Environment: **Docker**
- Dockerfile path: `docker/backend.Dockerfile`
- Docker build context: repository root

### Backend required env

- `NODE_ENV=production`
- `PORT=10000`
- `JWT_SECRET=<strong-secret>`
- `CORS_ORIGIN=https://<frontend-domain>`
- `DATABASE_URL=<supabase-postgres-url>?sslmode=require`
- `REDIS_URL=<render-redis-url>`
- `REDIS_SHARD_URLS=<render-redis-url>`
- `PACK_PURCHASE_QUEUE_NAME=pack_purchases`
- `PACK_TIER_UPDATES_CHANNEL=pack_tier_updates`
- `CARD_PRICE_BROADCAST_CHANNEL=pullvault:card_price_updates`
- `AUCTION_BID_BROADCAST_CHANNEL=pullvault:auction_bid_updates`
- `TCG_PRICE_LOOKUP_API_KEY=<optional>`
- `JUSTTCG_API_KEY=<optional>`

## 3) Run DB Migrations (once per release needing schema changes)

Use a one-off Render shell/job against backend image and run:

```bash
npm run db:migrate
```

This targets Supabase through `DATABASE_URL`.

## 4) Create Worker Service (Docker)

- Service type: **Background Worker**
- Environment: **Docker**
- Dockerfile path: `docker/worker.Dockerfile`
- Docker build context: repository root

Use the same env values as backend for DB/Redis/channels/queue.

The worker consumes Redis queue messages and performs transactional fulfillment.

## 5) Create Frontend Web Service (Docker)

- Service type: **Web Service**
- Environment: **Docker**
- Dockerfile path: `docker/frontend.Dockerfile`
- Docker build context: repository root

### Frontend env

- `NODE_ENV=production`
- `NEXT_PUBLIC_API_URL=https://<backend-domain>/api`

## 6) Recommended Release Order

1. Provision Redis
2. Deploy backend
3. Run migrations
4. Deploy worker
5. Deploy frontend
6. Update backend `CORS_ORIGIN` if frontend domain changed

## 7) Smoke Checks

- `GET /api/health` from backend
- signup/login and wallet read
- drop-sale websocket connects (`/ws/pack-availability`)
- auction websocket connects (`/ws/auction`)
- place a pack purchase request and verify worker consumes queue

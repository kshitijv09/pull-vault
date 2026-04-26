# Drop and Pack Purchase Flow

## Logic

Pack buying is implemented as a two-phase flow:

1. Fast reservation path in Redis for high-concurrency drops.
2. Asynchronous fulfillment path in PostgreSQL for wallet debit and ownership writes.

This separation keeps drop-time contention low while preserving transactional correctness.

## Architecture as Implemented

### Phase 0: Data model

- Core tables: `drops`, `packs`, `pack_inventory`, `pack_card`, `card`, `user_packs`, `user_cards`.

### Phase 1: Startup prefetch + Redis seed

- On API boot, available inventory is prefetched and seeded into Redis:
  - `pullvault:pack:{packInventoryId}:remaining`
  - `pullvault:tier:{dropId}:{tierName}:available`
- Tier keys are sharded across `REDIS_SHARD_URLS`.

### Phase 2: Discovery APIs

- `GET /api/drops/packs` for drop/tier availability UX.
- `GET /api/users/:userId/packs` for affordability and phase hints.

### Phase 3: Purchase enqueue (fast path)

- Endpoint: `POST /api/pack-queue/purchases`
- Service atomically reserves from Redis tier list via Lua.
- On successful reserve, enqueue purchase payload to Redis list.
- Returns `202 queued`; wallet is not debited here.
- If enqueue fails post-reserve, reservation is released to keep Redis consistent.

### Phase 4: Async fulfillment (authoritative path)

- Worker consumes queue and executes one DB transaction:
  - lock inventory,
  - lock wallet,
  - debit balance,
  - mark inventory sold,
  - create `user_packs` and `user_cards`,
  - record company earning.
- On processing failure, Redis reservation is restored.

## Important Notes

- Redis is the high-throughput reservation layer; Postgres is final source of truth at commit time.
- The active purchase route is queue-based (`/api/pack-queue/purchases`).
- `POST /api/drops/packs/:dropId/purchase` remains a `501` stub.

# Platform Health Dashboard

Mounted at `GET /api/analytics/health/summary?range=…`. Powers four panels: Fraud, Economic health, Fairness audit, User health.

**Route:** `/analytics/health` (frontend). Backend sub-router: `apiRouter.use("/analytics/health", platformHealthRouter)`, admin-gated.

**Polling:** client polls every 10s; server caches each panel per range preset (see cadences below).

---

## Data sources

| Panel | Primary source(s) | New tables |
|-------|-------------------|------------|
| Fraud | `auction_listings.needs_fraud_review`, `auction_bid_history`, `rate_limit_block_event` | `rate_limit_block_event` |
| Economics | `company_earnings_ledger`, `user_packs`, `user_cards`, `packs`, `card.market_value_usd`, `drops`, `pack_inventory`, `drop_card_pool_snapshot` | — |
| Fairness | `pack_fairness_commit`, `drop_card_pool_snapshot`, `user_cards`, `card`, `pack_fairness_verify_event` | `pack_fairness_verify_event` |
| User health | `app_users`, `user_packs`, `auction_bid_history`, `user_cards`, `marketplace_listings`, `user_portfolio_snapshots` | — |

---

## Fraud metrics

| Widget | Definition | Source |
|--------|------------|--------|
| Rate-limit blocks (1h / 24h) | Count of `dropPurchaseRateLimitMiddleware` rejections grouped by `scope` | `rate_limit_block_event` |
| 429s as share of purchase attempts | `blocks / (blocks + accepted_enqueues)` over rolling window | Above + `company_earnings_ledger event_type='pack_purchase'` |
| Top blocked IPs (24h) | Sorted leaderboard | `rate_limit_block_event` aggregated |
| Auction fraud flag rate | `needs_fraud_review_count / settled_in_window` | `auction_listings` |
| Sealed-phase trigger rate | Share of settled auctions with sealed phase active | `auction_listings` |

### `rate_limit_block_event` table

```sql
CREATE TABLE rate_limit_block_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scope TEXT NOT NULL,
  user_id UUID NULL,
  drop_id UUID NULL,
  client_ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  CHECK (scope IN ('user_global','user_drop','ip_global','ip_drop'))
);
CREATE INDEX rlbe_occurred_at_idx    ON rate_limit_block_event (occurred_at DESC);
CREATE INDEX rlbe_scope_occurred_idx ON rate_limit_block_event (scope, occurred_at DESC);
CREATE INDEX rlbe_client_ip_idx      ON rate_limit_block_event (client_ip, occurred_at DESC);
CREATE INDEX rlbe_user_id_idx        ON rate_limit_block_event (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;
```

Writer: `dropPurchaseRateLimitMiddleware` fires a best-effort insert on every `Allowed=false` path (`setImmediate(() => repo.insert(...).catch(...))`).

### Fraud alerts

| Alert key | Condition | Threshold |
|-----------|-----------|-----------|
| `rate_limit_pressure` | `blocks / total_attempts (1h)` ≥ 0.15 with ≥ 200 total attempts | 15% |
| `single_ip_spike` | One `client_ip` contributes ≥ 40% of blocks in 15 min | 40% |
| `auction_fraud_flag_spike` | `fraudReviewFlagRate (24h)` ≥ 2× trailing 7d baseline AND ≥ 10 raw flags | 2× + N=10 |

---

## Economic health

| Widget | Definition | Source |
|--------|------------|--------|
| Per-tier rolling margin | `1 - (sum(market_value_card) / sum(retail_paid))` grouped by `packs.tier_name` | `user_cards` × `user_packs` × `packs` × `card` |
| Target vs actual margin | `target = 1 - targetPackValueRatio` from `packGenerator.config.ts` | Config + above |
| Win rate per tier | Share of `user_packs` with realised value ≥ retail | `user_packs` aggregate |
| Pack revenue per tier | `SUM(amount_gained_usd)` from `company_earnings_ledger WHERE event_type='pack_purchase'` grouped by `metadata->>'tierName'` | `company_earnings_ledger` |
| Revenue projection | Linear rate × horizon using last-3h / 24h / 7d rolling rates | Same |
| Marketplace + auction take | `event_type IN ('marketplace_purchase','auction_completion')` | `company_earnings_ledger` |
| Pool mark-to-market drift | Median % change of `card.market_value_usd` since `pool_snapshot_created_at` | `drop_card_pool_snapshot` vs `card` |

### `pack_purchase_outcome` view

```sql
CREATE OR REPLACE VIEW pack_purchase_outcome AS
SELECT
  up.id              AS user_pack_id,
  up.user_id,
  up.drop_id,
  up.created_at      AS opened_at,
  p.tier_name,
  p.price            AS retail_price_usd,
  SUM(c.market_value_usd) AS realised_value_usd,
  SUM(c.market_value_usd) - p.price AS margin_to_user_usd
FROM user_packs up
JOIN packs p       ON p.id = up.pack_id
JOIN user_cards uc ON uc.user_pack_id = up.id
JOIN card c        ON c.id = uc.card_id
GROUP BY up.id, up.user_id, up.drop_id, up.created_at, p.tier_name, p.price;
```

Swap to a materialised view refreshed every 60s above ~50k packs/day.

### Economic alerts

| Alert key | Condition | Threshold |
|-----------|-----------|-----------|
| `tier_margin_breach` | `actual_margin_24h` deviates from `target_margin` by ≥ 3pp for ≥ 2 consecutive 15-min buckets | 3pp |
| `tier_win_rate_breach` | `win_rate_24h` outside `[winRateFloor, winRateCeiling]` from config | config-driven |
| `revenue_drop` | Daily pack revenue ≤ 0.5× trailing 7d average | 0.5× |
| `pool_price_drift` | Median price drift of pool cards ≥ 15% since pool snapshot | 15% |

---

## Fairness audit

| Widget | Definition | Source |
|--------|------------|--------|
| Consumed commits | Phase 1 commits with `consumed_at` set | `pack_fairness_commit` |
| Reveals fetched | Phase 3 endpoint hits | `pack_fairness_commit.consumed_at` |
| Distinct packs verified | Phase 4 browser-only replay beacons | `pack_fairness_verify_event` |
| Verifier fails | `result='fail'` rows in window | `pack_fairness_verify_event` |
| Pool snapshot freshness | Latest `pool_snapshot_created_at` per active drop | `drops` |

### `pack_fairness_verify_event` table

```sql
CREATE TABLE pack_fairness_verify_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pack_id UUID NOT NULL REFERENCES user_packs(id) ON DELETE CASCADE,
  verifier_user_id UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
  verifier_ip TEXT NULL,
  result TEXT NOT NULL,
  failing_check TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (result IN ('pass','fail'))
);
CREATE INDEX pfve_user_pack_id_idx ON pack_fairness_verify_event (user_pack_id);
CREATE INDEX pfve_occurred_at_idx  ON pack_fairness_verify_event (occurred_at DESC);
```

Beacon endpoint: `POST /user-packs/:userPackId/fairness-verify-event` (rate-limited, public — any user can verify any past pack).

### Fairness alerts

| Alert key | Condition | Threshold |
|-----------|-----------|-----------|
| `verifier_failures` | `result='fail'` events ≥ 3 in any 1h | 3 |
| `pool_snapshot_stale` | Drop is `live` AND `pool_snapshot_created_at IS NULL` for > 60s after `start_time` | 60s |

---

## User health

| Widget | Definition | Source |
|--------|------------|--------|
| DAU / WAU / MAU | Distinct users with ≥ 1 activity event in window | `user_packs`, `auction_bid_history`, `marketplace_listings` |
| DAU / MAU (stickiness) | `dau / mau` | Above |
| Drop participation rate | `distinct_buyers / distinct_active_users` during drop window | `user_packs` × `drops` |
| Auction participation | Share of settled listings with ≥ 1 bid | `auction_bid_history` × `auction_listings` |
| Pack-to-list conversion (24h) | Cards listed within 24h of pull / cards pulled in same window | `user_cards` × `marketplace_listings` |
| D7 retention | % of cohort with activity in week `w + 1` | `app_users.created_at` + activity sources |

### Health badge

Worst-of four signals:

| Signal | Green | Yellow | Red |
|--------|-------|--------|-----|
| WAU vs trailing 4-week median | ≥ 0.95× | 0.80–0.95× | < 0.80× |
| Drop participation (last 3 drops) | ≥ 0.30 | 0.15–0.30 | < 0.15 |
| Auction participation rate | ≥ 0.40 | 0.20–0.40 | < 0.20 |
| D7 retention (last full cohort) | ≥ 0.25 | 0.15–0.25 | < 0.15 |

---

## Alert delivery

Alerts are written to `health_alert_event` and surfaced via the `GET /api/analytics/health/summary` payload.

```sql
CREATE TABLE health_alert_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  dedup_bucket TEXT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (severity IN ('info','warning','critical'))
);
CREATE INDEX hae_alert_key_fired_idx ON health_alert_event (alert_key, fired_at DESC);
CREATE INDEX hae_unresolved_idx ON health_alert_event (fired_at DESC) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX hae_dedup_uidx ON health_alert_event (alert_key, dedup_bucket) WHERE dedup_bucket IS NOT NULL;
```

`insertAlertIdempotent` uses `ON CONFLICT (alert_key, dedup_bucket) WHERE dedup_bucket IS NOT NULL DO NOTHING` to match the partial index.

---

## Refresh cadence

| Panel | Cadence | Server cache TTL |
|-------|---------|-----------------|
| Fraud | 10s client poll | 10s |
| Economics | 60s client poll | 60s |
| Fairness | 5-min client poll | 5 min |
| User health | 5-min client poll | 5 min |

---

## API surface

| Method + path | Purpose | Auth |
|---------------|---------|------|
| `GET /api/analytics/health/summary?range=…` | Single payload for all four panels | admin |
| `GET /api/analytics/health/fraud/rate-limit-blocks?range=…&groupBy=…` | Rate-limit block drill-down | admin |
| `GET /api/analytics/health/economics/tier-margins?range=…` | Per-tier rolling margin + revenue | admin |
| `GET /api/analytics/health/fairness/aggregate?range=…` | Reveal + verification counts | public |
| `GET /api/analytics/health/users?range=…` | DAU/WAU/MAU, participation, retention, badge | admin |
| `POST /user-packs/:userPackId/fairness-verify-event` | Beacon write from verifier page | public, rate-limited |

---

## Indexing summary

Every index is paired with its query:

- `rate_limit_block_event (occurred_at DESC)` → blocks in last 1h / 24h
- `rate_limit_block_event (scope, occurred_at DESC)` → scope-split rollups
- `rate_limit_block_event (client_ip, occurred_at DESC)` → top-IPs leaderboard
- `pack_fairness_verify_event (user_pack_id)` → per-pack verifier history
- `pack_fairness_verify_event (occurred_at DESC)` → dashboard counters
- `health_alert_event (alert_key, fired_at DESC)` → alert history per key
- `health_alert_event partial (fired_at DESC) WHERE resolved_at IS NULL` → open alerts query
- `health_alert_event partial (alert_key, dedup_bucket) WHERE dedup_bucket IS NOT NULL` → idempotent insert

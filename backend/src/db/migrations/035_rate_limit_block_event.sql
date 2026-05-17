-- B5 platform health dashboard: append-only audit of `dropPurchaseRateLimitMiddleware`
-- 429 rejections. Powers fraud panel rate-limit widgets + alert thresholds.
--
-- Indexes are scoped to the three rollup query shapes the dashboard performs:
--   (a) "blocks in last X" — DESC time scan
--   (b) per-scope split — (scope, occurred_at DESC)
--   (c) top blocked IPs leaderboard — (client_ip, occurred_at DESC)
-- Per-user partial index keeps the small minority of authenticated blocks
-- cheap to look up without bloating the index for the anonymous case.

CREATE TABLE IF NOT EXISTS rate_limit_block_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scope TEXT NOT NULL,
  user_id UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
  drop_id UUID NULL REFERENCES drops(id) ON DELETE SET NULL,
  client_ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  CONSTRAINT rate_limit_block_event_scope_check
    CHECK (scope IN ('user_global', 'user_drop', 'ip_global', 'ip_drop'))
);

CREATE INDEX IF NOT EXISTS rlbe_occurred_at_idx
  ON rate_limit_block_event (occurred_at DESC);
CREATE INDEX IF NOT EXISTS rlbe_scope_occurred_idx
  ON rate_limit_block_event (scope, occurred_at DESC);
CREATE INDEX IF NOT EXISTS rlbe_client_ip_occurred_idx
  ON rate_limit_block_event (client_ip, occurred_at DESC);
CREATE INDEX IF NOT EXISTS rlbe_user_id_occurred_idx
  ON rate_limit_block_event (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

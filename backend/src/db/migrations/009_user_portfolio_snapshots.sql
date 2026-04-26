CREATE TABLE IF NOT EXISTS user_portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  total_portfolio_value_usd NUMERIC(18, 2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_portfolio_snapshots_value_non_negative CHECK (total_portfolio_value_usd >= 0)
);

CREATE INDEX IF NOT EXISTS user_portfolio_snapshots_user_recorded_idx
  ON user_portfolio_snapshots (user_id, recorded_at DESC);

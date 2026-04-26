CREATE TABLE IF NOT EXISTS company_earnings_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount_gained_usd NUMERIC(18, 2) NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_earnings_ledger_event_type_check
    CHECK (event_type IN ('marketplace_purchase', 'auction_completion', 'pack_purchase'))
);

CREATE UNIQUE INDEX IF NOT EXISTS company_earnings_ledger_event_txn_uidx
  ON company_earnings_ledger(event_type, transaction_id);

CREATE INDEX IF NOT EXISTS company_earnings_ledger_occurred_at_idx
  ON company_earnings_ledger(occurred_at DESC);

CREATE INDEX IF NOT EXISTS company_earnings_ledger_event_type_idx
  ON company_earnings_ledger(event_type);

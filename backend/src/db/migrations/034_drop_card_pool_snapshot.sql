-- Phase 3 provably fair pack openings:
--   Per-drop ordered catalog pool snapshot. The snapshot pins each card's
--   market value at the moment the drop's first provably-fair purchase is
--   consumed, so the verifier can reproduce the pool fingerprint and re-run
--   the strategy regardless of later catalog price drift.
--
--   `drops.pool_snapshot_fingerprint_hex` is the SHA-256 of the ordered
--   `(card_id, market_value_usd)` pairs; pinned once and never rewritten.

ALTER TABLE drops
  ADD COLUMN IF NOT EXISTS pool_snapshot_fingerprint_hex CHAR(64),
  ADD COLUMN IF NOT EXISTS pool_snapshot_created_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drops_pool_snapshot_fingerprint_hex_length'
  ) THEN
    ALTER TABLE drops
      ADD CONSTRAINT drops_pool_snapshot_fingerprint_hex_length
      CHECK (pool_snapshot_fingerprint_hex IS NULL OR char_length(pool_snapshot_fingerprint_hex) = 64);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS drop_card_pool_snapshot (
  drop_id UUID NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  pool_index INTEGER NOT NULL,
  card_id UUID NOT NULL REFERENCES card(id),
  market_value_usd_snapshot NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (drop_id, pool_index),
  CONSTRAINT drop_card_pool_snapshot_market_value_non_negative
    CHECK (market_value_usd_snapshot >= 0)
);

CREATE INDEX IF NOT EXISTS drop_card_pool_snapshot_drop_id_idx
  ON drop_card_pool_snapshot (drop_id);

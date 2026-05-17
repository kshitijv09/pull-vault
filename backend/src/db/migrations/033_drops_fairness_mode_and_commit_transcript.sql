-- Phase 2 provably fair pack openings:
--   * `drops.fairness_mode` selects which fulfillment strategy runs at purchase time.
--     New drops default to 'fairness'; existing rows are explicitly downgraded to 'legacy'
--     so historical pack_card-based templates keep working.
--   * `pack_fairness_commit` gains columns to record the derivation transcript at
--     consumption time so Phase 3 reveal can return reproducible inputs.

ALTER TABLE drops
  ADD COLUMN IF NOT EXISTS fairness_mode TEXT,
  ADD COLUMN IF NOT EXISTS fairness_algorithm_version TEXT;

UPDATE drops SET fairness_mode = 'legacy' WHERE fairness_mode IS NULL;
UPDATE drops SET fairness_algorithm_version = 'standard_v1' WHERE fairness_algorithm_version IS NULL;

ALTER TABLE drops ALTER COLUMN fairness_mode SET DEFAULT 'fairness';
ALTER TABLE drops ALTER COLUMN fairness_mode SET NOT NULL;
ALTER TABLE drops ALTER COLUMN fairness_algorithm_version SET DEFAULT 'standard_v1';
ALTER TABLE drops ALTER COLUMN fairness_algorithm_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drops_fairness_mode_check'
  ) THEN
    ALTER TABLE drops
      ADD CONSTRAINT drops_fairness_mode_check
      CHECK (fairness_mode IN ('legacy', 'fairness'));
  END IF;
END $$;

ALTER TABLE pack_fairness_commit
  ADD COLUMN IF NOT EXISTS pool_fingerprint_hex CHAR(64),
  ADD COLUMN IF NOT EXISTS algorithm_version TEXT,
  ADD COLUMN IF NOT EXISTS transcript JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pack_fairness_commit_pool_fingerprint_hex_length'
  ) THEN
    ALTER TABLE pack_fairness_commit
      ADD CONSTRAINT pack_fairness_commit_pool_fingerprint_hex_length
      CHECK (pool_fingerprint_hex IS NULL OR char_length(pool_fingerprint_hex) = 64);
  END IF;
END $$;

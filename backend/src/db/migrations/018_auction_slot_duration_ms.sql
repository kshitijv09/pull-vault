-- Idempotent: legacy `duration_ms` -> `duration` (minutes), then ensure NOT NULL + check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auction_slots'
      AND column_name = 'duration_ms'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auction_slots'
      AND column_name = 'duration'
  ) THEN
    ALTER TABLE auction_slots RENAME COLUMN duration_ms TO duration;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auction_slots_duration_ms_positive_check') THEN
    ALTER TABLE auction_slots RENAME CONSTRAINT auction_slots_duration_ms_positive_check TO auction_slots_duration_positive_check;
  END IF;
END $$;

ALTER TABLE auction_slots
  ADD COLUMN IF NOT EXISTS duration INTEGER;

UPDATE auction_slots
SET duration = 10
WHERE duration IS NULL;

ALTER TABLE auction_slots
  ALTER COLUMN duration SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auction_slots_duration_positive_check'
  ) THEN
    ALTER TABLE auction_slots
      ADD CONSTRAINT auction_slots_duration_positive_check CHECK (duration > 0);
  END IF;
END $$;

-- Legacy installs: column was duration_ms; rename to duration.
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

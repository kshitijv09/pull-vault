ALTER TABLE drops
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

UPDATE drops
SET duration_minutes = 10
WHERE duration_minutes IS NULL OR duration_minutes <= 0;

ALTER TABLE drops
  ALTER COLUMN duration_minutes SET DEFAULT 10,
  ALTER COLUMN duration_minutes SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drops_duration_minutes_positive_check'
  ) THEN
    ALTER TABLE drops
      ADD CONSTRAINT drops_duration_minutes_positive_check CHECK (duration_minutes > 0);
  END IF;
END $$;

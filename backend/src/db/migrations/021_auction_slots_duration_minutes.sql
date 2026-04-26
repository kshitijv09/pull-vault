-- Normalize auction_slots.duration to minutes.
-- Older installs may still hold millisecond values (e.g. 600000).
UPDATE auction_slots
SET duration = GREATEST(1, CEIL(duration / 60000.0)::int)
WHERE duration > 1000;

ALTER TABLE auction_slots
  ALTER COLUMN duration SET DEFAULT 10;

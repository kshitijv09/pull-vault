ALTER TABLE user_cards
  ADD COLUMN IF NOT EXISTS acquisition_price NUMERIC(18, 2);

UPDATE user_cards
SET acquisition_price = 0
WHERE acquisition_price IS NULL;

ALTER TABLE user_cards
  ALTER COLUMN acquisition_price SET NOT NULL,
  ALTER COLUMN acquisition_price SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_cards_acquisition_price_non_negative_check'
  ) THEN
    ALTER TABLE user_cards
      ADD CONSTRAINT user_cards_acquisition_price_non_negative_check
      CHECK (acquisition_price >= 0);
  END IF;
END $$;

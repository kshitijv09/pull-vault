ALTER TABLE user_cards
  ADD COLUMN IF NOT EXISTS listing_price NUMERIC(18, 2) NOT NULL DEFAULT 0;

UPDATE user_cards
SET listing_price = 0
WHERE listing_price IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_cards_listing_price_non_negative_check'
  ) THEN
    ALTER TABLE user_cards
      ADD CONSTRAINT user_cards_listing_price_non_negative_check
      CHECK (listing_price >= 0);
  END IF;
END $$;

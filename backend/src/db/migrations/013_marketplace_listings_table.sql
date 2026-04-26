-- Asking price lives on `marketplace_listings`, not `user_cards`.

UPDATE user_cards
SET selling_status = 'unlisted'
WHERE selling_status = 'listed'
  AND (listing_price IS NULL OR listing_price <= 0);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  user_card_id UUID PRIMARY KEY REFERENCES user_cards (id) ON DELETE CASCADE,
  listing_price_usd NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_listings_price_positive CHECK (listing_price_usd > 0)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_created_at ON marketplace_listings (created_at DESC);

INSERT INTO marketplace_listings (user_card_id, listing_price_usd, created_at)
SELECT uc.id, uc.listing_price, uc.updated_at
FROM user_cards uc
WHERE uc.selling_status = 'listed'
  AND uc.listing_price > 0
ON CONFLICT (user_card_id) DO NOTHING;

ALTER TABLE user_cards DROP CONSTRAINT IF EXISTS user_cards_listing_price_non_negative_check;

ALTER TABLE user_cards DROP COLUMN IF EXISTS listing_price;

ALTER TABLE auction_listings
  ADD COLUMN IF NOT EXISTS sealed_phase_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS auction_listings_sealed_phase_idx
  ON auction_listings (sealed_phase_active)
  WHERE sealed_phase_active = TRUE;

CREATE TABLE IF NOT EXISTS auction_sealed_bid_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  amount_ciphertext TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (auction_listing_id, bidder_id)
);

CREATE INDEX IF NOT EXISTS auction_sealed_bid_records_listing_idx
  ON auction_sealed_bid_records (auction_listing_id);

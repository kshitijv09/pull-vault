CREATE TABLE IF NOT EXISTS auction_bid_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  bid_amount NUMERIC(18, 2) NOT NULL,
  bid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auction_bid_history_bid_amount_positive CHECK (bid_amount > 0)
);

CREATE INDEX IF NOT EXISTS auction_bid_history_listing_bid_at_idx
  ON auction_bid_history(auction_listing_id, bid_at DESC);

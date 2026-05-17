-- Full audit trail of every bid on the listed card (user_cards row) for an auction listing.
-- Written asynchronously from the bid APIs alongside synchronous auction_bid_history for open bids.

CREATE TABLE IF NOT EXISTS auction_card_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
  user_card_id UUID NOT NULL REFERENCES user_cards(id) ON DELETE RESTRICT,
  bidder_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  bid_amount NUMERIC(18, 2) NOT NULL,
  bid_kind TEXT NOT NULL CHECK (bid_kind IN ('open', 'sealed')),
  bid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listing_end_time_after_bid TIMESTAMPTZ,
  anti_sniping_extension_applied BOOLEAN NOT NULL DEFAULT FALSE,
  sealed_phase_started_this_bid BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auction_card_bids_amount_positive CHECK (bid_amount > 0)
);

CREATE INDEX IF NOT EXISTS auction_card_bids_listing_bid_at_idx
  ON auction_card_bids (auction_listing_id, bid_at DESC);

CREATE INDEX IF NOT EXISTS auction_card_bids_card_bid_at_idx
  ON auction_card_bids (user_card_id, bid_at DESC);

CREATE INDEX IF NOT EXISTS auction_card_bids_bidder_bid_at_idx
  ON auction_card_bids (bidder_id, bid_at DESC);

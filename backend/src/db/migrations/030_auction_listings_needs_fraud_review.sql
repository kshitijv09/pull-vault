ALTER TABLE auction_listings
  ADD COLUMN IF NOT EXISTS needs_fraud_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS auction_listings_needs_fraud_review_idx
  ON auction_listings (needs_fraud_review)
  WHERE needs_fraud_review = TRUE;

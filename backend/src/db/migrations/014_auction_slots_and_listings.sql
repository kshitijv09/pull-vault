DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_slot_status') THEN
    CREATE TYPE auction_slot_status AS ENUM ('scheduled', 'active', 'completed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_listing_status') THEN
    CREATE TYPE auction_listing_status AS ENUM ('pending', 'live', 'sold', 'unsold');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auction_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time TIMESTAMPTZ NOT NULL,
  status auction_slot_status NOT NULL DEFAULT 'scheduled',
  capacity INTEGER NOT NULL,
  duration INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auction_slots_capacity_positive_check CHECK (capacity > 0),
  CONSTRAINT auction_slots_duration_positive_check CHECK (duration > 0)
);

DROP TRIGGER IF EXISTS auction_slots_set_updated_at ON auction_slots;
CREATE TRIGGER auction_slots_set_updated_at
BEFORE UPDATE ON auction_slots
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS auction_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES auction_slots(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  start_bid NUMERIC(18, 2) NOT NULL,
  reserve_price NUMERIC(18, 2),
  current_high_bid NUMERIC(18, 2),
  current_high_bidder_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status auction_listing_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auction_listings_card_unique UNIQUE (card_id),
  CONSTRAINT auction_listings_start_bid_positive_check CHECK (start_bid > 0),
  CONSTRAINT auction_listings_reserve_price_positive_check CHECK (reserve_price IS NULL OR reserve_price > 0),
  CONSTRAINT auction_listings_reserve_at_or_above_start_check CHECK (reserve_price IS NULL OR reserve_price >= start_bid),
  CONSTRAINT auction_listings_high_bid_check CHECK (current_high_bid IS NULL OR current_high_bid >= start_bid),
  CONSTRAINT auction_listings_high_bidder_pairing_check CHECK (
    (current_high_bid IS NULL AND current_high_bidder_id IS NULL)
    OR (current_high_bid IS NOT NULL AND current_high_bidder_id IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS auction_listings_set_updated_at ON auction_listings;
CREATE TRIGGER auction_listings_set_updated_at
BEFORE UPDATE ON auction_listings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS auction_slots_status_start_idx
  ON auction_slots(status, start_time ASC);

CREATE INDEX IF NOT EXISTS auction_listings_slot_status_created_idx
  ON auction_listings(slot_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS auction_listings_seller_status_idx
  ON auction_listings(seller_id, status);

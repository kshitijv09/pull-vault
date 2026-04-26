CREATE TABLE IF NOT EXISTS auction_bid_increment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  min_price NUMERIC(18, 2) NOT NULL,
  max_price NUMERIC(18, 2),
  min_increment NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auction_bid_increment_rules_min_price_non_negative CHECK (min_price >= 0),
  CONSTRAINT auction_bid_increment_rules_max_price_check CHECK (max_price IS NULL OR max_price >= min_price),
  CONSTRAINT auction_bid_increment_rules_increment_positive CHECK (min_increment > 0)
);

DROP TRIGGER IF EXISTS auction_bid_increment_rules_set_updated_at ON auction_bid_increment_rules;
CREATE TRIGGER auction_bid_increment_rules_set_updated_at
BEFORE UPDATE ON auction_bid_increment_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Intentionally empty: keep non-user tables unseeded.

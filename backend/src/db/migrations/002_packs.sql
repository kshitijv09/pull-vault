CREATE TABLE IF NOT EXISTS packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_name TEXT NOT NULL,
  price NUMERIC(18, 2) NOT NULL,
  cards_per_pack INTEGER NOT NULL,
  available_count INTEGER NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  rarity_weights JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS packs_set_updated_at ON packs;
CREATE TRIGGER packs_set_updated_at
BEFORE UPDATE ON packs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

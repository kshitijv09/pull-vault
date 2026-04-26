ALTER TABLE packs ADD COLUMN IF NOT EXISTS available_count INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'packs' AND column_name = 'available_inventory'
  ) THEN
    EXECUTE 'UPDATE packs SET available_count = COALESCE(available_count, available_inventory)';
  END IF;
END $$;

UPDATE packs
SET available_count = 0
WHERE available_count IS NULL;

ALTER TABLE packs
  ALTER COLUMN available_count SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'packs' AND column_name = 'available_inventory'
  ) THEN
    EXECUTE 'ALTER TABLE packs DROP COLUMN available_inventory';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'packs' AND column_name = 'total_inventory'
  ) THEN
    EXECUTE 'ALTER TABLE packs DROP COLUMN total_inventory';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'packs_available_count_non_negative_check'
  ) THEN
    ALTER TABLE packs
      ADD CONSTRAINT packs_available_count_non_negative_check CHECK (available_count >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS card (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- External id from TCG APIs (TCGPlayer-aligned card id); used for live price checks.
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  card_set TEXT NOT NULL,
  image_url TEXT NOT NULL,
  rarity TEXT NOT NULL,
  market_value_usd NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT card_market_value_non_negative_check CHECK (market_value_usd >= 0)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'card' AND column_name = 'pack_id'
  ) THEN
    EXECUTE 'ALTER TABLE card DROP COLUMN pack_id';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS card_card_id_unique_idx ON card(card_id);
CREATE INDEX IF NOT EXISTS card_card_id_idx ON card(card_id);

DROP TRIGGER IF EXISTS card_set_updated_at ON card;
CREATE TRIGGER card_set_updated_at
BEFORE UPDATE ON card
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS pack_card (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES card(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pack_card_pack_card_unique UNIQUE (pack_id, card_id)
);

CREATE INDEX IF NOT EXISTS pack_card_pack_id_idx ON pack_card(pack_id);
CREATE INDEX IF NOT EXISTS pack_card_card_id_idx ON pack_card(card_id);

CREATE TABLE IF NOT EXISTS user_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  user_pack_id UUID REFERENCES user_packs(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES card(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_cards_user_id_idx ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS user_cards_user_pack_id_idx ON user_cards(user_pack_id);
CREATE INDEX IF NOT EXISTS user_cards_card_id_idx ON user_cards(card_id);

DROP TRIGGER IF EXISTS user_cards_set_updated_at ON user_cards;
CREATE TRIGGER user_cards_set_updated_at
BEFORE UPDATE ON user_cards
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

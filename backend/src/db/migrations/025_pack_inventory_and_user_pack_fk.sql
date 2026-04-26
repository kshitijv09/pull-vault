-- Introduce individual-pack inventory rows per pack type.
CREATE TABLE IF NOT EXISTS pack_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  drop_id UUID REFERENCES drops(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pack_inventory_status_check CHECK (status IN ('available', 'reserved', 'sold', 'legacy'))
);

CREATE INDEX IF NOT EXISTS pack_inventory_drop_pack_status_idx
  ON pack_inventory (drop_id, pack_id, status);

CREATE INDEX IF NOT EXISTS pack_inventory_pack_status_idx
  ON pack_inventory (pack_id, status);

DROP TRIGGER IF EXISTS pack_inventory_set_updated_at ON pack_inventory;
CREATE TRIGGER pack_inventory_set_updated_at
BEFORE UPDATE ON pack_inventory
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Seed one legacy inventory row using the same UUID as each pack type so existing
-- user_packs.pack_id values remain valid after FK migration.
INSERT INTO pack_inventory (id, pack_id, drop_id, status)
SELECT p.id, p.id, p.drop_id, 'legacy'
FROM packs p
ON CONFLICT (id) DO NOTHING;

-- Seed available individual inventory rows from current available_count.
INSERT INTO pack_inventory (pack_id, drop_id, status)
SELECT p.id, p.drop_id, 'available'
FROM packs p
CROSS JOIN LATERAL generate_series(1, GREATEST(p.available_count, 0))
ON CONFLICT DO NOTHING;

-- Switch user_packs.pack_id FK from pack type to pack inventory row.
ALTER TABLE user_packs
  DROP CONSTRAINT IF EXISTS user_packs_pack_id_fkey;

ALTER TABLE user_packs
  ADD CONSTRAINT user_packs_pack_id_fkey
  FOREIGN KEY (pack_id) REFERENCES pack_inventory(id) ON DELETE RESTRICT;

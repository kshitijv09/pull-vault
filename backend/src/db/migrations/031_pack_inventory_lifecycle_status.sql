-- Lifecycle for each sellable unit in `pack_inventory` (template is `packs`).
-- created → in_drop_sale → reserved → owned (+ legacy for migrated rows)

ALTER TABLE pack_inventory DROP CONSTRAINT IF EXISTS pack_inventory_status_check;

UPDATE pack_inventory SET status = 'in_drop_sale' WHERE status = 'available';
UPDATE pack_inventory SET status = 'owned' WHERE status = 'sold';

-- Units not tied to a drop are "created" (pooling) rather than actively listed.
UPDATE pack_inventory
SET status = 'created'
WHERE drop_id IS NULL
  AND status = 'in_drop_sale';

ALTER TABLE pack_inventory
  ALTER COLUMN status SET DEFAULT 'created';

ALTER TABLE pack_inventory
  ADD CONSTRAINT pack_inventory_status_check
  CHECK (status IN ('created', 'in_drop_sale', 'reserved', 'owned', 'legacy'));

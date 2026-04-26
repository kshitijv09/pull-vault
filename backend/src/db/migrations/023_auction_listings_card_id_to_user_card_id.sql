-- Store `auction_listings.card_id` as `user_cards.id` (owned-card instance),
-- not catalog `card.id`.

-- 1) Remove old FK/unique/checking constraints tied to catalog card IDs.
ALTER TABLE auction_listings
  DROP CONSTRAINT IF EXISTS auction_listings_card_id_fkey;

ALTER TABLE auction_listings
  DROP CONSTRAINT IF EXISTS auction_listings_card_unique;

-- 2) Remap existing rows from catalog-card id -> user-card id using seller ownership.
--    Prefer rows currently marked as listed_for_auction; fallback to any owned card.
WITH ranked AS (
  SELECT
    al.id AS auction_listing_id,
    uc.id AS user_card_id,
    ROW_NUMBER() OVER (
      PARTITION BY al.id
      ORDER BY
        CASE WHEN uc.selling_status = 'listed_for_auction' THEN 0 ELSE 1 END,
        uc.created_at ASC
    ) AS rn
  FROM auction_listings al
  JOIN user_cards uc
    ON uc.user_id = al.seller_id
   AND uc.card_id = al.card_id
)
UPDATE auction_listings al
SET card_id = ranked.user_card_id
FROM ranked
WHERE ranked.auction_listing_id = al.id
  AND ranked.rn = 1;

-- 3) Re-add constraints for new semantics.
ALTER TABLE auction_listings
  ADD CONSTRAINT auction_listings_card_id_fkey
  FOREIGN KEY (card_id) REFERENCES user_cards(id) ON DELETE RESTRICT;

ALTER TABLE auction_listings
  ADD CONSTRAINT auction_listings_card_unique UNIQUE (card_id);

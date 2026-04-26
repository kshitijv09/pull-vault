-- Replace `auction_status` + old `selling_status` values with a single 3-state `selling_status`.
-- New states: `unlisted`, `listed_for_sale`, `listed_for_auction`.

ALTER TABLE user_cards
  DROP CONSTRAINT IF EXISTS user_cards_selling_status_check;

-- Map existing rows:
-- 1) Cards with marketplace listing row -> listed_for_sale
-- 2) Else cards marked in auction -> listed_for_auction
-- 3) Else -> unlisted
UPDATE user_cards uc
SET selling_status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM marketplace_listings ml
    WHERE ml.user_card_id = uc.id
  ) THEN 'listed_for_sale'
  WHEN uc.auction_status = 'in_auction' THEN 'listed_for_auction'
  ELSE 'unlisted'
END;

ALTER TABLE user_cards
  DROP COLUMN IF EXISTS auction_status;

ALTER TABLE user_cards
  ADD CONSTRAINT user_cards_selling_status_check
  CHECK (selling_status IN ('unlisted', 'listed_for_sale', 'listed_for_auction'));

DROP INDEX IF EXISTS user_cards_selling_status_listed_idx;

CREATE INDEX IF NOT EXISTS user_cards_selling_status_sale_idx
  ON user_cards (selling_status)
  WHERE selling_status = 'listed_for_sale';

CREATE INDEX IF NOT EXISTS user_cards_selling_status_auction_idx
  ON user_cards (selling_status)
  WHERE selling_status = 'listed_for_auction';

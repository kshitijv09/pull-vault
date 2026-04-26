-- Per-owned-card marketplace flags (defaults = not listed / not in auction).
ALTER TABLE user_cards
  ADD COLUMN IF NOT EXISTS selling_status TEXT NOT NULL DEFAULT 'unlisted',
  ADD COLUMN IF NOT EXISTS auction_status TEXT NOT NULL DEFAULT 'not_in_auction';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_cards_selling_status_check'
  ) THEN
    ALTER TABLE user_cards
      ADD CONSTRAINT user_cards_selling_status_check
      CHECK (selling_status IN ('unlisted', 'listed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_cards_auction_status_check'
  ) THEN
    ALTER TABLE user_cards
      ADD CONSTRAINT user_cards_auction_status_check
      CHECK (auction_status IN ('not_in_auction', 'in_auction'));
  END IF;
END $$;

-- Funds reserved for bidding / auction use only (separate from general wallet `balance`).
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS auction_balance NUMERIC(18, 2) NOT NULL DEFAULT 0;

UPDATE app_users
SET auction_balance = 0
WHERE auction_balance IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_users_auction_balance_non_negative_check'
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_auction_balance_non_negative_check
      CHECK (auction_balance >= 0);
  END IF;
END $$;

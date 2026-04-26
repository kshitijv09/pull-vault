-- Cards can be bought from marketplace with no user_pack association.
ALTER TABLE user_cards
  ALTER COLUMN user_pack_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS user_cards_selling_status_listed_idx
  ON user_cards (selling_status)
  WHERE selling_status = 'listed';

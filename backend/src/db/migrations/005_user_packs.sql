CREATE TABLE IF NOT EXISTS user_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES packs(id) ON DELETE RESTRICT,
  drop_id UUID REFERENCES drops(id) ON DELETE SET NULL,
  assignment_status TEXT NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  reveal_completed_at TIMESTAMPTZ,
  cards_revealed_count INTEGER NOT NULL DEFAULT 0,
  total_cards INTEGER NOT NULL,
  purchase_price_usd NUMERIC(18, 2) NOT NULL,
  revealed_market_value_usd NUMERIC(18, 2),
  net_result_usd NUMERIC(18, 2),
  queue_message_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_packs_status_check
    CHECK (assignment_status IN ('assigned', 'revealing', 'revealed', 'voided')),
  CONSTRAINT user_packs_total_cards_positive_check
    CHECK (total_cards > 0),
  CONSTRAINT user_packs_cards_revealed_non_negative_check
    CHECK (cards_revealed_count >= 0),
  CONSTRAINT user_packs_cards_revealed_within_total_check
    CHECK (cards_revealed_count <= total_cards),
  CONSTRAINT user_packs_purchase_price_non_negative_check
    CHECK (purchase_price_usd >= 0),
  CONSTRAINT user_packs_revealed_market_value_non_negative_check
    CHECK (revealed_market_value_usd IS NULL OR revealed_market_value_usd >= 0),
  CONSTRAINT user_packs_reveal_order_check
    CHECK (
      (opened_at IS NULL OR opened_at >= assigned_at)
      AND (reveal_completed_at IS NULL OR (opened_at IS NOT NULL AND reveal_completed_at >= opened_at))
    )
);

CREATE INDEX IF NOT EXISTS user_packs_user_id_assigned_at_idx
  ON user_packs(user_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS user_packs_pack_id_idx
  ON user_packs(pack_id);

CREATE INDEX IF NOT EXISTS user_packs_drop_id_idx
  ON user_packs(drop_id);

DROP TRIGGER IF EXISTS user_packs_set_updated_at ON user_packs;
CREATE TRIGGER user_packs_set_updated_at
BEFORE UPDATE ON user_packs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

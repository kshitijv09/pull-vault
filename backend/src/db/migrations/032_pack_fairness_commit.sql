-- Phase 1 provably fair pack openings: commit server entropy + client seed before purchase.
-- `id` is the fairness session nonce returned to the client.

CREATE TABLE IF NOT EXISTS pack_fairness_commit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  drop_id UUID NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  client_seed TEXT NOT NULL,
  client_seed_source TEXT NOT NULL CHECK (client_seed_source IN ('user', 'server')),
  server_secret_hex TEXT NOT NULL,
  server_commitment_hex TEXT NOT NULL,
  consumed_at TIMESTAMPTZ,
  user_pack_id UUID REFERENCES user_packs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pack_fairness_commit_client_seed_length CHECK (
    char_length(client_seed) >= 1 AND char_length(client_seed) <= 512
  ),
  CONSTRAINT pack_fairness_commit_server_secret_hex_length CHECK (char_length(server_secret_hex) = 64),
  CONSTRAINT pack_fairness_commit_server_commitment_hex_length CHECK (char_length(server_commitment_hex) = 64)
);

CREATE INDEX IF NOT EXISTS pack_fairness_commit_user_drop_created_idx
  ON pack_fairness_commit (user_id, drop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pack_fairness_commit_drop_id_idx
  ON pack_fairness_commit (drop_id);

DROP TRIGGER IF EXISTS pack_fairness_commit_set_updated_at ON pack_fairness_commit;
CREATE TRIGGER pack_fairness_commit_set_updated_at
BEFORE UPDATE ON pack_fairness_commit
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

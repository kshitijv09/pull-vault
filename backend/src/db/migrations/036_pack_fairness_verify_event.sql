-- B5 fairness panel: client-side verifier beacon. The browser verifier
-- (`frontend/src/lib/fairness/verifier.ts`) calls
-- `POST /user-packs/:userPackId/fairness-verify-event` after every Phase 4
-- replay so the dashboard can report "how many users used the verification"
-- (REQ §B5 verbatim) and whether any failed.
--
-- Anonymous-OK: REQ §B4 says any user can verify any past pack. We capture
-- `verifier_user_id` only when a Bearer is present; we never require it.

CREATE TABLE IF NOT EXISTS pack_fairness_verify_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_pack_id UUID NOT NULL REFERENCES user_packs(id) ON DELETE CASCADE,
  verifier_user_id UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
  verifier_ip TEXT NULL,
  result TEXT NOT NULL,
  failing_check TEXT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pack_fairness_verify_event_result_check
    CHECK (result IN ('pass', 'fail')),
  CONSTRAINT pack_fairness_verify_event_failing_check_consistency
    CHECK (
      (result = 'fail' AND failing_check IS NOT NULL)
      OR (result = 'pass' AND failing_check IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS pfve_user_pack_id_idx
  ON pack_fairness_verify_event (user_pack_id);
CREATE INDEX IF NOT EXISTS pfve_occurred_at_idx
  ON pack_fairness_verify_event (occurred_at DESC);
CREATE INDEX IF NOT EXISTS pfve_result_occurred_idx
  ON pack_fairness_verify_event (result, occurred_at DESC);

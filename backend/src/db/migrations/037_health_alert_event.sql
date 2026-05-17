-- B5 alert audit log. One row per alert firing; resolve by setting
-- `resolved_at`. The dashboard's "open alerts" widget queries the partial
-- index for unresolved rows; per-key history view queries the composite.
--
-- Dedup is enforced in the service via "alert_key + minute bucket" uniqueness
-- (see platformHealth.service.ts); we don't add a unique constraint here
-- because the bucket lives in the inserter and would change with cadence.

CREATE TABLE IF NOT EXISTS health_alert_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_bucket TEXT NULL,
  CONSTRAINT health_alert_event_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS hae_alert_key_fired_idx
  ON health_alert_event (alert_key, fired_at DESC);
CREATE INDEX IF NOT EXISTS hae_unresolved_idx
  ON health_alert_event (fired_at DESC)
  WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hae_dedup_uidx
  ON health_alert_event (alert_key, dedup_bucket)
  WHERE dedup_bucket IS NOT NULL;

BEGIN;

-- =========================================================================
-- 1. autonomy_level enum
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'autonomy_level') THEN
    CREATE TYPE autonomy_level AS ENUM ('advisory', 'conditional', 'controlled');
  END IF;
END
$$;

-- =========================================================================
-- 2. sir_orchestration_runs additions
-- =========================================================================

ALTER TABLE sir_orchestration_runs
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS autonomy_level autonomy_level,
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS output_schema_version text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS requires_human_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_definition_code text,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sir_orchestration_runs'::regclass
      AND conname = 'sir_orchestration_runs_confidence_range'
  ) THEN
    ALTER TABLE sir_orchestration_runs
      ADD CONSTRAINT sir_orchestration_runs_confidence_range
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sir_orchestration_runs_tenant_idem
  ON sir_orchestration_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sir_orchestration_runs_correlation
  ON sir_orchestration_runs (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- =========================================================================
-- 3. sir_tool_calls additions
-- =========================================================================

ALTER TABLE sir_tool_calls
  ADD COLUMN IF NOT EXISTS autonomy_level autonomy_level,
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_sir_tool_calls_correlation
  ON sir_tool_calls (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMIT;
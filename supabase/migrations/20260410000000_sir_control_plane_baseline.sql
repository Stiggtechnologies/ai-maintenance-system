/*
  # SIR Control Plane — Baseline (PR 2 of consolidation)

  Implements the minimum additive, doctrine-compliant shape on top of
  the canonical control-plane substrate selected in
  docs/CONTROL_PLANE_AUDIT.md (SIR, formerly OpenClaw).

  Changes
  -------
  1. Create the autonomy_level enum (advisory / conditional / controlled).
  2. Add control-plane columns to sir_orchestration_runs:
       correlation_id, idempotency_key, autonomy_level, confidence,
       output_schema_version, prompt_version, requires_human_review,
       workflow_definition_code.
     Plus: confidence range CHECK, partial unique index on
     (tenant_id, idempotency_key), correlation_id index.
  3. Add governance columns to sir_tool_calls:
       autonomy_level, approval_required, approval_request_id,
       correlation_id.
  4. Create sir_approval_requests — the one bridging table needed to
     make Conditional autonomy enforceable. Approved as the single
     exception to the "no new tables" rule (see audit doc).
  5. RLS tightening on sir_orchestration_runs, sir_tool_calls,
     sir_messages, sir_sessions, sir_costs, openclaw_audit_log,
     and sir_approval_requests. Drops the broken openclaw_*_insert /
     openclaw_*_select policies that compared tenant_id to auth.uid()
     (see audit doc § "Cross-cutting facts" and the discovery that
     these have been silently failing since application). Replaces
     them with read-only authenticated policies that join through
     user_profiles.organization_id. No authenticated write policies
     are created — writes to control-plane state are by edge
     functions only, running as service_role (which bypasses RLS).

  Non-goals (deferred)
  --------------------
  - Edge function changes: switching ai-agent-processor from anon to
    service_role, the LLM_BASE_URL seam, structured I/O wiring →  PR 3.
  - UI: AgentErrorBoundary, "Draft Reliability Assessment" button →  PR 3.
  - Playwright golden-path rail + CI →  PR 4.
  - Decommissioning Autonomous / Runbooks / Governance-001 substrates →
    separate per-substrate cleanup PRs.
  - Renaming openclaw_audit_log → sir_audit_log: the rename migration
    20260405500000 missed this table; we leave it alone in this PR
    and only fix its RLS. Separate cleanup PR.
  - Fixing the post-rename re-apply migrations (20260408102253 etc.)
    that re-create openclaw_* tables. Separate cleanup PR.

  Backwards compatibility
  -----------------------
  All column additions use IF NOT EXISTS. The CHECK constraint and
  the FK from sir_tool_calls.approval_request_id are added with
  guarded DO blocks. Edge functions that write to sir_* tables today
  (openclaw-orchestrator, sir-orchestrator, javis-orchestrator) all
  use SUPABASE_SERVICE_ROLE_KEY and so bypass RLS — they are not
  affected by the policy tightening. ai-agent-processor uses
  SUPABASE_ANON_KEY, but its SIR inserts were already failing
  silently under the broken policies (try/catch at index.ts:202-225)
  so dropping those policies has no behavior change. PR 3 fixes the
  ai-agent-processor key to service_role.
*/

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

COMMENT ON TYPE autonomy_level IS
  'Governed Autonomy doctrine levels. advisory = recommend only (no execution). '
  'conditional = prepared but blocked until human approval. '
  'controlled = allowlisted automatic execution within policy bounds. '
  'Enforced at runtime by Edge Functions in the Control Plane, not by DB constraints. '
  'See docs/CONTROL_PLANE_AUDIT.md.';

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
  ADD COLUMN IF NOT EXISTS workflow_definition_code text;

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

COMMENT ON COLUMN sir_orchestration_runs.correlation_id IS
  'Request-level correlation id. Threads together every row produced by '
  'a single logical workflow run: orchestration run, messages, tool calls, '
  'costs, approval requests, audit events. Set by the Control Plane.';

COMMENT ON COLUMN sir_orchestration_runs.idempotency_key IS
  'Caller-supplied idempotency key. Paired with tenant_id by '
  'idx_sir_orchestration_runs_tenant_idem to guarantee at-most-once '
  'orchestration creation for retried workflow invocations. Derive from '
  'something stable at the call site, e.g. work_order_id:task_code:prompt_version.';

COMMENT ON COLUMN sir_orchestration_runs.autonomy_level IS
  'Governed Autonomy level for this run. Enforced at runtime by Edge '
  'Functions in the Control Plane — not by DB constraints.';

COMMENT ON COLUMN sir_orchestration_runs.confidence IS
  'Model-reported confidence in [0, 1]. Enforced by '
  'sir_orchestration_runs_confidence_range CHECK.';

COMMENT ON COLUMN sir_orchestration_runs.requires_human_review IS
  'Set by the Control Plane when autonomy_level is conditional or when '
  'policy requires human gating. Blocks execution until a linked '
  'sir_approval_requests row reaches status = approved.';

COMMENT ON COLUMN sir_orchestration_runs.workflow_definition_code IS
  'Stable code for the workflow this run implements (e.g. '
  'draft_reliability_assessment). Workflow definitions live in code/seed '
  'today; a table will be added only if real usage justifies it.';

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
  ADD COLUMN IF NOT EXISTS approval_request_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

COMMENT ON COLUMN sir_tool_calls.autonomy_level IS
  'Governed Autonomy level for this tool execution. Tool calls are the ONLY '
  'path by which the Intelligence Plane can cause writes to operational '
  'systems, so this column is the doctrine enforcement point for '
  'advisory/conditional/controlled.';

COMMENT ON COLUMN sir_tool_calls.approval_required IS
  'If true, the Control Plane must not execute this tool call until the '
  'linked approval_request_id has status = approved.';

CREATE INDEX IF NOT EXISTS idx_sir_tool_calls_correlation
  ON sir_tool_calls (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- =========================================================================
-- 4. sir_approval_requests (the one bridging table)
-- =========================================================================

CREATE TABLE IF NOT EXISTS sir_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  correlation_id uuid,
  orchestration_run_id uuid REFERENCES sir_orchestration_runs(id) ON DELETE CASCADE,
  tool_call_id uuid REFERENCES sir_tool_calls(id) ON DELETE SET NULL,
  approval_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  requested_role text,
  requested_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  autonomy_level autonomy_level NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sir_approval_requests IS
  'Approval records for conditional-autonomy actions. Single source of '
  'truth for human-in-the-loop gating in the Control Plane. Approved as '
  'the one exception to the "no new tables" rule by the substrate '
  'consolidation decision (docs/CONTROL_PLANE_AUDIT.md). Referenced by '
  'sir_orchestration_runs (via correlation_id) and sir_tool_calls '
  '(via approval_request_id).';

CREATE INDEX IF NOT EXISTS idx_sir_approval_requests_tenant_status
  ON sir_approval_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_sir_approval_requests_correlation
  ON sir_approval_requests (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sir_approval_requests_run
  ON sir_approval_requests (orchestration_run_id);

-- Wire sir_tool_calls.approval_request_id back to the new table now
-- that it exists. Named constraint so future migrations can modify cleanly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sir_tool_calls_approval_request_id_fkey'
  ) THEN
    ALTER TABLE sir_tool_calls
      ADD CONSTRAINT sir_tool_calls_approval_request_id_fkey
      FOREIGN KEY (approval_request_id)
      REFERENCES sir_approval_requests(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- updated_at trigger for sir_approval_requests
CREATE OR REPLACE FUNCTION set_updated_at_sir_approval_requests()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sir_approval_requests_updated_at ON sir_approval_requests;
CREATE TRIGGER trg_sir_approval_requests_updated_at
  BEFORE UPDATE ON sir_approval_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_sir_approval_requests();

-- =========================================================================
-- 5. RLS tightening
-- =========================================================================
--
-- The original openclaw RLS used:
--   USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()))
-- which compared tenant_id (an organization id) against the user's own
-- auth id. Under normal authenticated requests this returns nothing,
-- which is why ai-agent-processor's SIR writes have been silently failing.
--
-- The fix: use user_profiles.organization_id (the real tenant pointer) and
-- only define SELECT for authenticated. No authenticated INSERT/UPDATE/
-- DELETE policies — writes happen via Edge Functions running as
-- service_role, which bypasses RLS, per doctrine.

-- sir_orchestration_runs ----------------------------------------------------
DROP POLICY IF EXISTS "openclaw_orchestration_select" ON sir_orchestration_runs;
DROP POLICY IF EXISTS "openclaw_orchestration_insert" ON sir_orchestration_runs;

CREATE POLICY sir_orchestration_runs_read ON sir_orchestration_runs
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- sir_tool_calls ------------------------------------------------------------
DROP POLICY IF EXISTS "openclaw_tool_calls_select" ON sir_tool_calls;
DROP POLICY IF EXISTS "openclaw_tool_calls_insert" ON sir_tool_calls;

CREATE POLICY sir_tool_calls_read ON sir_tool_calls
  FOR SELECT TO authenticated
  USING (session_id IN (
    SELECT id FROM sir_sessions
    WHERE tenant_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  ));

-- sir_sessions --------------------------------------------------------------
DROP POLICY IF EXISTS "openclaw_sessions_select" ON sir_sessions;
DROP POLICY IF EXISTS "openclaw_sessions_insert" ON sir_sessions;

CREATE POLICY sir_sessions_read ON sir_sessions
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- sir_messages --------------------------------------------------------------
DROP POLICY IF EXISTS "openclaw_messages_select" ON sir_messages;
DROP POLICY IF EXISTS "openclaw_messages_insert" ON sir_messages;

CREATE POLICY sir_messages_read ON sir_messages
  FOR SELECT TO authenticated
  USING (session_id IN (
    SELECT id FROM sir_sessions
    WHERE tenant_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  ));

-- sir_costs -----------------------------------------------------------------
DROP POLICY IF EXISTS "openclaw_costs_select" ON sir_costs;
DROP POLICY IF EXISTS "openclaw_costs_insert" ON sir_costs;

CREATE POLICY sir_costs_read ON sir_costs
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- openclaw_audit_log (note: the rename migration 20260405500000 missed this
-- table; it is still openclaw_* post-rename and will be renamed in a
-- separate cleanup PR per the audit doc) ------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'openclaw_audit_log') THEN
    EXECUTE 'DROP POLICY IF EXISTS "openclaw_audit_select" ON openclaw_audit_log';
    EXECUTE 'DROP POLICY IF EXISTS "openclaw_audit_insert" ON openclaw_audit_log';
    EXECUTE $q$
      CREATE POLICY openclaw_audit_log_read ON openclaw_audit_log
        FOR SELECT TO authenticated
        USING (tenant_id IN (
          SELECT organization_id FROM user_profiles WHERE id = auth.uid()
        ))
    $q$;
  END IF;
END
$$;

-- sir_approval_requests RLS -------------------------------------------------
ALTER TABLE sir_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY sir_approval_requests_read ON sir_approval_requests
  FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Doctrine enforcement note:
-- No INSERT/UPDATE/DELETE policies are defined for the authenticated role
-- on any of the above tables. This is intentional. All writes to
-- control-plane state must go through Edge Functions running with
-- service_role (which bypasses RLS). The frontend can read the state of
-- a workflow but cannot create or mutate it. This is the structural
-- enforcement of doctrine principle: "Chat is interface, not system."

COMMIT;

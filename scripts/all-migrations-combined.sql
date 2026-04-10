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
/*
  # Autonomous Readiness Repair (PR 2.5)

  Repairs the Autonomous substrate so it can serve as the canonical
  Control/Governance Plane per docs/architecture/canonical-plane-ownership.md.

  No feature expansion, no new substrate, no UI work.

  ## Blocker A — Trigger repair
  create_approval_workflow() queries user_profiles.role, which was dropped
  by 20260403044307_008_industrial_platform_merged_v2.sql. Rewritten to
  use user_role_assignments + roles (the repo's real RBAC model).

  ## Blocker B — RLS repair
  "Managers can approve decisions" policy also queries user_profiles.role.
  Replaced with tenant-scoped policy using user_role_assignments + roles.
  All USING(true) SELECT policies replaced with tenant-scoped versions.
  INSERT policies removed for doctrine alignment (service-role writes only).
  UPDATE policies for approval/acknowledge kept and repaired.

  ## Blocker C — Tenant isolation
  tenant_id added to autonomous_decisions, autonomous_actions,
  approval_workflows, asset_health_monitoring, system_alerts.
  Backfilled where deterministic joins exist.
  NOT NULL enforced on asset_health_monitoring (deterministic from assets FK).
  Others left nullable; NOT NULL enforcement deferred to a follow-up
  migration after the golden-path rail validates the backfill.

  ## Blocker D — sir_approval_requests removal
  Drops the sir_approval_requests table created in PR 2 (doctrine
  violation: Autonomous owns approval truth via approval_workflows).
  Verified zero live callers before removal. Also drops the FK column
  sir_tool_calls.approval_request_id and the trigger/function.

  ## Cross-plane linkage
  Adds correlation_id, asset_id, work_order_id, autonomy_level to
  autonomous_decisions. Adds correlation_id to approval_workflows
  and autonomous_actions. These are prerequisites for the PR 3
  cross-plane vertical slice.

  ## Backwards compatibility
  - ApprovalQueue.tsx only uses UPDATE (not INSERT) on autonomous_decisions
    and approval_workflows. The repaired UPDATE policies preserve this path.
  - autonomous-orchestrator uses service_role → bypasses RLS → unaffected.
  - autonomousMonitoring.ts has INSERT calls but is dead code (zero imports).
  - The trigger's external contract (insert decision → get approval_workflow)
    is preserved; only the internal query is changed to use the real RBAC.
*/

BEGIN;

-- =========================================================================
-- 1. Add tenant_id to all Autonomous tables
-- =========================================================================

ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE approval_workflows
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE asset_health_monitoring
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE system_alerts
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- =========================================================================
-- 2. Backfill tenant_id from deterministic joins
-- =========================================================================

-- asset_health_monitoring: deterministic via asset_id → assets.organization_id
UPDATE asset_health_monitoring ahm
SET tenant_id = a.organization_id
FROM assets a
WHERE ahm.asset_id = a.id
  AND ahm.tenant_id IS NULL;

-- autonomous_decisions: best-effort via decision_data->>'asset_id' → assets.organization_id
UPDATE autonomous_decisions ad
SET tenant_id = a.organization_id
FROM assets a
WHERE ad.decision_data->>'asset_id' IS NOT NULL
  AND a.id = (ad.decision_data->>'asset_id')::uuid
  AND ad.tenant_id IS NULL;

-- autonomous_decisions: remaining NULLs get the demo org if one exists
UPDATE autonomous_decisions
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

-- approval_workflows: derive from the linked decision
UPDATE approval_workflows aw
SET tenant_id = ad.tenant_id
FROM autonomous_decisions ad
WHERE aw.decision_id = ad.id
  AND aw.tenant_id IS NULL
  AND ad.tenant_id IS NOT NULL;

-- autonomous_actions: derive from decision via action_data->>'decision_id'
UPDATE autonomous_actions aa
SET tenant_id = ad.tenant_id
FROM autonomous_decisions ad
WHERE aa.action_data->>'decision_id' IS NOT NULL
  AND ad.id = (aa.action_data->>'decision_id')::uuid
  AND aa.tenant_id IS NULL
  AND ad.tenant_id IS NOT NULL;

-- autonomous_actions: remaining NULLs get the demo org
UPDATE autonomous_actions
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

-- system_alerts: no reliable FK; default to demo org for existing rows
UPDATE system_alerts
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

-- =========================================================================
-- 3. NOT NULL enforcement where deterministic
-- =========================================================================

-- asset_health_monitoring: every row has asset_id → assets.organization_id,
-- so the backfill above is deterministic. Safe to enforce NOT NULL now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM asset_health_monitoring WHERE tenant_id IS NULL
  ) THEN
    ALTER TABLE asset_health_monitoring
      ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END
$$;

-- For the other four tables, NOT NULL enforcement is deferred to a
-- follow-up migration after the golden-path rail validates the backfill.
-- Validation query (run manually or in tests to check readiness):
--   SELECT 'autonomous_decisions' AS tbl, COUNT(*) AS null_count
--     FROM autonomous_decisions WHERE tenant_id IS NULL
--   UNION ALL
--   SELECT 'autonomous_actions', COUNT(*)
--     FROM autonomous_actions WHERE tenant_id IS NULL
--   UNION ALL
--   SELECT 'approval_workflows', COUNT(*)
--     FROM approval_workflows WHERE tenant_id IS NULL
--   UNION ALL
--   SELECT 'system_alerts', COUNT(*)
--     FROM system_alerts WHERE tenant_id IS NULL;

-- =========================================================================
-- 4. Indexes on tenant_id
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_tenant_status
  ON autonomous_decisions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_tenant_created
  ON autonomous_decisions (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_tenant
  ON autonomous_actions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_approval_workflows_tenant_status
  ON approval_workflows (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_asset_health_monitoring_tenant
  ON asset_health_monitoring (tenant_id);

CREATE INDEX IF NOT EXISTS idx_system_alerts_tenant
  ON system_alerts (tenant_id);

-- =========================================================================
-- 5. Cross-plane linkage columns (prerequisites for PR 3)
-- =========================================================================

ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS asset_id uuid,
  ADD COLUMN IF NOT EXISTS work_order_id uuid,
  ADD COLUMN IF NOT EXISTS autonomy_level autonomy_level;

ALTER TABLE approval_workflows
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_correlation
  ON autonomous_decisions (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_approval_workflows_correlation
  ON approval_workflows (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_correlation
  ON autonomous_actions (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_asset
  ON autonomous_decisions (tenant_id, asset_id)
  WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_work_order
  ON autonomous_decisions (tenant_id, work_order_id)
  WHERE work_order_id IS NOT NULL;

-- =========================================================================
-- 6. Repair trigger: create_approval_workflow (Blocker A)
-- =========================================================================

-- Replace the trigger function with one that uses the real RBAC model.
-- Role codes confirmed from supabase/seed/001_core_seed_data.sql:
--   maintenance_manager, plant_manager, operations_manager,
--   reliability_engineer, maintenance_planner, maintenance_supervisor
CREATE OR REPLACE FUNCTION create_approval_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  approver_user_id uuid;
BEGIN
  IF NEW.requires_approval = true AND NEW.status = 'pending' THEN
    -- Find an approver via the real RBAC model (user_role_assignments + roles),
    -- scoped to the same tenant as the decision. Falls back gracefully if no
    -- matching role is found (no approval_workflow row is created, but the
    -- decision remains in 'pending' — a human can still find and act on it).
    SELECT ura.user_id INTO approver_user_id
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE r.code IN (
      'maintenance_manager',
      'plant_manager',
      'operations_manager',
      'reliability_engineer'
    )
    AND (
      NEW.tenant_id IS NULL
      OR ura.organization_id = NEW.tenant_id
    )
    ORDER BY random()
    LIMIT 1;

    IF approver_user_id IS NOT NULL THEN
      INSERT INTO approval_workflows (
        decision_id,
        approver_id,
        approval_level,
        tenant_id,
        correlation_id
      )
      VALUES (
        NEW.id,
        approver_user_id,
        1,
        NEW.tenant_id,
        NEW.correlation_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger itself (create_workflow_trigger) already exists from the
-- original migration. We only replaced the function body above.
-- Verify the trigger is still attached:
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'autonomous_decisions'::regclass;

-- =========================================================================
-- 7. RLS repair (Blocker B) + tenant-scoped policies (Blocker C)
-- =========================================================================

-- === autonomous_decisions ===

-- Drop broken / overly permissive policies
DROP POLICY IF EXISTS "Users can view decisions" ON autonomous_decisions;
DROP POLICY IF EXISTS "System can create decisions" ON autonomous_decisions;
DROP POLICY IF EXISTS "Managers can approve decisions" ON autonomous_decisions;

-- Tenant-scoped read
CREATE POLICY "Tenant users can view decisions"
  ON autonomous_decisions FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Manager/approver UPDATE (repaired to use real RBAC, tenant-scoped)
CREATE POLICY "Managers can approve decisions"
  ON autonomous_decisions FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_role_assignments ura
      JOIN roles r ON r.id = ura.role_id
      WHERE ura.user_id = auth.uid()
        AND r.code IN (
          'maintenance_manager', 'plant_manager',
          'operations_manager', 'reliability_engineer', 'admin'
        )
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );

-- No INSERT policy for authenticated. Writes via service_role edge functions only.

-- === autonomous_actions ===

DROP POLICY IF EXISTS "Users can view actions" ON autonomous_actions;
DROP POLICY IF EXISTS "System can log actions" ON autonomous_actions;

CREATE POLICY "Tenant users can view actions"
  ON autonomous_actions FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- No INSERT policy. Writes via service_role only.

-- === approval_workflows ===

DROP POLICY IF EXISTS "Users can view workflows" ON approval_workflows;
DROP POLICY IF EXISTS "System can create workflows" ON approval_workflows;
DROP POLICY IF EXISTS "Approvers can update workflows" ON approval_workflows;

-- Tenant-scoped read (managers + the assigned approver)
CREATE POLICY "Tenant users can view workflows"
  ON approval_workflows FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND (
      approver_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid()
          AND r.code IN (
            'maintenance_manager', 'plant_manager',
            'operations_manager', 'admin'
          )
      )
    )
  );

-- Approver UPDATE (tenant-scoped, approver-only)
CREATE POLICY "Approvers can update workflows"
  ON approval_workflows FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND approver_id = auth.uid()
  )
  WITH CHECK (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND approver_id = auth.uid()
  );

-- No INSERT policy. The trigger creates rows; future explicit creation
-- happens via service_role edge functions.

-- === asset_health_monitoring ===

DROP POLICY IF EXISTS "Users can view health data" ON asset_health_monitoring;
DROP POLICY IF EXISTS "System can insert health data" ON asset_health_monitoring;

CREATE POLICY "Tenant users can view health data"
  ON asset_health_monitoring FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- No INSERT policy. Writes via service_role only.

-- === system_alerts ===

DROP POLICY IF EXISTS "Users can view their alerts" ON system_alerts;
DROP POLICY IF EXISTS "System can create alerts" ON system_alerts;
DROP POLICY IF EXISTS "Users can acknowledge alerts" ON system_alerts;

-- Tenant-scoped read (targeted users or managers)
CREATE POLICY "Tenant users can view alerts"
  ON system_alerts FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND (
      auth.uid() = ANY(target_users)
      OR EXISTS (
        SELECT 1 FROM user_role_assignments ura
        JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = auth.uid()
          AND r.code IN (
            'maintenance_manager', 'plant_manager',
            'operations_manager', 'admin'
          )
      )
    )
  );

-- Acknowledge UPDATE (tenant-scoped, targeted users only)
CREATE POLICY "Users can acknowledge alerts"
  ON system_alerts FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND auth.uid() = ANY(target_users)
  )
  WITH CHECK (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND auth.uid() = ANY(target_users)
  );

-- No INSERT policy. Writes via service_role only.

-- =========================================================================
-- 8. Drop sir_approval_requests (Blocker D — PR 2 correction)
-- =========================================================================
-- Verified zero live callers: only docs + the creating migration + two
-- comments in src/types/sir-contracts.ts reference this table.

-- Drop FK from sir_tool_calls first
ALTER TABLE sir_tool_calls
  DROP CONSTRAINT IF EXISTS sir_tool_calls_approval_request_id_fkey;

-- Drop the column
ALTER TABLE sir_tool_calls
  DROP COLUMN IF EXISTS approval_request_id;

-- Drop trigger, function, indexes, policies, and table
DROP TRIGGER IF EXISTS trg_sir_approval_requests_updated_at ON sir_approval_requests;
DROP FUNCTION IF EXISTS set_updated_at_sir_approval_requests();

-- Policies were created on the table; dropping the table drops them too.
DROP TABLE IF EXISTS sir_approval_requests;

COMMIT;
/*
  # PR 3 — Trigger safety fix

  Addresses adjustment #2 from PR 2.5 review: the create_approval_workflow
  trigger had a NULL tenant_id clause that could match across tenants.

  Before: AND (NEW.tenant_id IS NULL OR ura.organization_id = NEW.tenant_id)
  After:  AND ura.organization_id = NEW.tenant_id

  When tenant_id is NULL, the equality (NULL = anything) returns false in
  Postgres, so no approver is found and no workflow row is created. The
  decision stays in 'pending' — safe fail, no cross-tenant leakage.
*/

CREATE OR REPLACE FUNCTION create_approval_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  approver_user_id uuid;
BEGIN
  IF NEW.requires_approval = true AND NEW.status = 'pending' THEN
    -- Find an approver via the real RBAC model, strictly scoped to the
    -- decision's tenant. If tenant_id is NULL, the equality fails safely
    -- (no cross-tenant leakage) and no approval_workflow is created.
    SELECT ura.user_id INTO approver_user_id
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE r.code IN (
      'maintenance_manager',
      'plant_manager',
      'operations_manager',
      'reliability_engineer'
    )
    AND ura.organization_id = NEW.tenant_id
    ORDER BY random()
    LIMIT 1;

    IF approver_user_id IS NOT NULL THEN
      INSERT INTO approval_workflows (
        decision_id,
        approver_id,
        approval_level,
        tenant_id,
        correlation_id
      )
      VALUES (
        NEW.id,
        approver_user_id,
        1,
        NEW.tenant_id,
        NEW.correlation_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
/*
  # Pre-PR4 hardening: add 'failed' status to autonomous_decisions

  'rejected' means a human declined the recommendation.
  'failed' means a system error prevented the intelligence task
  from completing. These are semantically different and must not
  be conflated.

  Adds 'failed' to the CHECK constraint on autonomous_decisions.status.
*/

-- Drop the old constraint and re-create with the added status.
-- The existing CHECK is unnamed (inline), so we identify it by column.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att ON att.attnum = ANY(con.conkey) AND att.attrelid = con.conrelid
  WHERE con.conrelid = 'autonomous_decisions'::regclass
    AND att.attname = 'status'
    AND con.contype = 'c';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE autonomous_decisions DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE autonomous_decisions
  ADD CONSTRAINT autonomous_decisions_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto_executed', 'expired', 'failed'));
/*
  # Audit chain helper + duration tracking

  1. get_full_audit_chain(correlation_id)
     Returns a single JSON object reconstructing the full cross-plane
     audit trail for one governed workflow invocation. Joins:
       - Autonomous: autonomous_decisions, approval_workflows, autonomous_actions
       - OpenClaw:    sir_orchestration_runs
       - SIR:         sir_sessions, sir_messages, sir_costs
     All linked by correlation_id (soft cross-plane link, no FKs).

  2. Duration columns
     Adds duration_ms to sir_orchestration_runs and autonomous_decisions
     so failures can be correlated with slow model/tool calls.
*/

-- =========================================================================
-- 1. Duration tracking
-- =========================================================================

ALTER TABLE sir_orchestration_runs
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS duration_ms integer;

COMMENT ON COLUMN sir_orchestration_runs.duration_ms IS
  'Wall-clock duration of the intelligence task in milliseconds. '
  'Set by ai-agent-processor on completion or failure.';

COMMENT ON COLUMN autonomous_decisions.duration_ms IS
  'Wall-clock duration from workflow initiation to decision creation, '
  'including intelligence task time. Set by autonomous-orchestrator.';

-- =========================================================================
-- 2. get_full_audit_chain(correlation_id)
-- =========================================================================

CREATE OR REPLACE FUNCTION get_full_audit_chain(p_correlation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'correlation_id', p_correlation_id,

    -- Autonomous (Control/Governance Plane) — canonical audit truth
    'decisions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ad.id,
        'tenant_id', ad.tenant_id,
        'decision_type', ad.decision_type,
        'status', ad.status,
        'confidence_score', ad.confidence_score,
        'requires_approval', ad.requires_approval,
        'autonomy_level', ad.autonomy_level,
        'asset_id', ad.asset_id,
        'work_order_id', ad.work_order_id,
        'approved_by', ad.approved_by,
        'executed_at', ad.executed_at,
        'duration_ms', ad.duration_ms,
        'created_at', ad.created_at
      ) ORDER BY ad.created_at)
      FROM autonomous_decisions ad
      WHERE ad.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    'approvals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', aw.id,
        'decision_id', aw.decision_id,
        'approver_id', aw.approver_id,
        'approval_level', aw.approval_level,
        'status', aw.status,
        'comments', aw.comments,
        'responded_at', aw.responded_at,
        'created_at', aw.created_at
      ) ORDER BY aw.created_at)
      FROM approval_workflows aw
      WHERE aw.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', aa.id,
        'action_type', aa.action_type,
        'target_id', aa.target_id,
        'triggered_by', aa.triggered_by,
        'success', aa.success,
        'error_message', aa.error_message,
        'executed_at', aa.executed_at
      ) ORDER BY aa.executed_at)
      FROM autonomous_actions aa
      WHERE aa.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    -- OpenClaw (Intelligence Plane) — runtime traces (observational)
    'intelligence_runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sor.id,
        'tenant_id', sor.tenant_id,
        'status', sor.status,
        'workflow_definition_code', sor.workflow_definition_code,
        'autonomy_level', sor.autonomy_level,
        'confidence', sor.confidence,
        'requires_human_review', sor.requires_human_review,
        'output_schema_version', sor.output_schema_version,
        'prompt_version', sor.prompt_version,
        'duration_ms', sor.duration_ms,
        'started_at', sor.started_at,
        'finished_at', sor.finished_at
      ) ORDER BY sor.started_at)
      FROM sir_orchestration_runs sor
      WHERE sor.correlation_id = p_correlation_id
    ), '[]'::jsonb),

    -- SIR (Interaction/Logging) — session metadata (observational)
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ss.id,
        'tenant_id', ss.tenant_id,
        'status', ss.status,
        'started_at', ss.started_at,
        'message_count', (
          SELECT count(*) FROM sir_messages sm WHERE sm.session_id = ss.id
        )
      ) ORDER BY ss.started_at)
      FROM sir_sessions ss
      WHERE ss.context->>'correlation_id' = p_correlation_id::text
    ), '[]'::jsonb),

    -- Cost summary (observational)
    'total_cost_usd', COALESCE((
      SELECT sum(sc.cost_usd)
      FROM sir_costs sc
      JOIN sir_sessions ss ON ss.id = sc.session_id
      WHERE ss.context->>'correlation_id' = p_correlation_id::text
    ), 0)
  ) INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_full_audit_chain(uuid) IS
  'Reconstructs the full cross-plane audit trail for a governed workflow. '
  'Returns one JSON object joining Autonomous decisions/approvals/actions '
  '(canonical audit truth), OpenClaw intelligence runs (observational), '
  'and SIR sessions/costs (observational). All linked by correlation_id.';
/*
  # Approve → Execute support

  1. Add decision_id column to autonomous_actions (was in jsonb only)
  2. Backfill existing rows from action_data->>'decision_id'
*/

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL;

-- Backfill from jsonb where possible
UPDATE autonomous_actions aa
SET decision_id = (aa.action_data->>'decision_id')::uuid
WHERE aa.decision_id IS NULL
  AND aa.action_data->>'decision_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_decision
  ON autonomous_actions (decision_id)
  WHERE decision_id IS NOT NULL;
/*
  # Execution hardening

  Makes the approve→execute path production-safe before scaling to
  more capabilities.

  1. Idempotency on autonomous_actions
     - Add idempotency_key (derived from decision_id for approval
       executions) with partial unique index.
     - One successful execution per decision — duplicates are no-ops.

  2. Structured execution_result column
     - Replaces implicit success/error_message with a jsonb column
       containing: status, message, affected_records, timestamp.
     - Required for debugging, auditing, and future complex actions.

  3. executed_at normalization
     - Already exists on autonomous_decisions (set on approval).
     - Add explicit executed_at to autonomous_actions (set on
       execution, not on insert).
     - Ensures consistent timestamps across the audit chain.
*/

-- 1. Idempotency
ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomous_actions_idempotency
  ON autonomous_actions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN autonomous_actions.idempotency_key IS
  'Guarantees at-most-once execution per logical action. For approval '
  'executions, derived from decision_id. Partial unique index enforces '
  'uniqueness only when key is non-null (legacy rows are exempt).';

-- 2. Structured execution_result
ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS execution_result jsonb;

COMMENT ON COLUMN autonomous_actions.execution_result IS
  'Structured execution outcome. Shape: '
  '{ status: "success"|"failed", message: string, '
  'affected_records: string[], timestamp: string }. '
  'Canonical source for what actually happened during execution.';

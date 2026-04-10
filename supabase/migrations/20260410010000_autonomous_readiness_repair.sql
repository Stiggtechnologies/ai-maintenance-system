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

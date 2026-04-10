BEGIN;

-- =========================================================================
-- 5. Autonomous tenant isolation + cross-plane columns
-- =========================================================================

ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS asset_id uuid,
  ADD COLUMN IF NOT EXISTS work_order_id uuid,
  ADD COLUMN IF NOT EXISTS autonomy_level autonomy_level,
  ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS execution_result jsonb;

ALTER TABLE approval_workflows
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE asset_health_monitoring
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE system_alerts
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Backfill tenant_id
UPDATE asset_health_monitoring ahm
SET tenant_id = a.organization_id
FROM assets a
WHERE ahm.asset_id = a.id AND ahm.tenant_id IS NULL;

UPDATE autonomous_decisions ad
SET tenant_id = a.organization_id
FROM assets a
WHERE ad.decision_data->>'asset_id' IS NOT NULL
  AND a.id = (ad.decision_data->>'asset_id')::uuid
  AND ad.tenant_id IS NULL;

UPDATE autonomous_decisions
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

UPDATE approval_workflows aw
SET tenant_id = ad.tenant_id
FROM autonomous_decisions ad
WHERE aw.decision_id = ad.id AND aw.tenant_id IS NULL AND ad.tenant_id IS NOT NULL;

UPDATE autonomous_actions
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

UPDATE system_alerts
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001');

UPDATE autonomous_actions aa
SET decision_id = (aa.action_data->>'decision_id')::uuid
WHERE aa.decision_id IS NULL AND aa.action_data->>'decision_id' IS NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_tenant_status ON autonomous_decisions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_tenant_created ON autonomous_decisions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_tenant ON autonomous_actions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_tenant_status ON approval_workflows (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_health_monitoring_tenant ON asset_health_monitoring (tenant_id);
CREATE INDEX IF NOT EXISTS idx_system_alerts_tenant ON system_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_correlation ON autonomous_decisions (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_workflows_correlation ON approval_workflows (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_correlation ON autonomous_actions (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_asset ON autonomous_decisions (tenant_id, asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_work_order ON autonomous_decisions (tenant_id, work_order_id) WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_decision ON autonomous_actions (decision_id) WHERE decision_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_autonomous_actions_idempotency ON autonomous_actions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMIT;
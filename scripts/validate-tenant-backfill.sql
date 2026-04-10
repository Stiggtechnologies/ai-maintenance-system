-- Tenant Backfill Validation
-- Run after PR 2.5 migration (20260410010000_autonomous_readiness_repair.sql)
-- to verify backfill completeness before enforcing NOT NULL.
--
-- REQUIREMENT: All counts must be 0 before NOT NULL enforcement.
-- If any count > 0, investigate and backfill those rows before
-- applying the NOT NULL migration.

SELECT 'autonomous_decisions' AS tbl, COUNT(*) AS null_tenant_count
  FROM autonomous_decisions WHERE tenant_id IS NULL
UNION ALL
SELECT 'autonomous_actions', COUNT(*)
  FROM autonomous_actions WHERE tenant_id IS NULL
UNION ALL
SELECT 'approval_workflows', COUNT(*)
  FROM approval_workflows WHERE tenant_id IS NULL
UNION ALL
SELECT 'system_alerts', COUNT(*)
  FROM system_alerts WHERE tenant_id IS NULL;

-- If all zeros, safe to run:
-- ALTER TABLE autonomous_decisions  ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE autonomous_actions    ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE approval_workflows    ALTER COLUMN tenant_id SET NOT NULL;
-- ALTER TABLE system_alerts         ALTER COLUMN tenant_id SET NOT NULL;

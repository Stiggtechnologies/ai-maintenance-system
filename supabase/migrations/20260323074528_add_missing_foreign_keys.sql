/*
  # Add Missing Foreign Key Constraints

  1. Purpose
    - Enforce referential integrity
    - Prevent orphaned records
    - Improve data consistency

  2. Foreign Keys Added
    - Performance indexes on foreign key columns
    - Relationships between related tables

  3. Notes
    - Uses ON DELETE CASCADE for dependent data
    - Uses ON DELETE SET NULL for optional references
    - Only adds if not already exists
*/

-- Add performance indexes on foreign key columns
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_approved_by ON autonomous_decisions(approved_by);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_approver_id ON approval_workflows(approver_id);
CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi_id ON kpi_measurements(kpi_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_id ON work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_health_monitoring_asset_id ON asset_health_monitoring(asset_id);
CREATE INDEX IF NOT EXISTS idx_runbook_executions_runbook_id ON runbook_executions(runbook_id);
CREATE INDEX IF NOT EXISTS idx_evidence_references_evidence_id ON evidence_references(evidence_id);

-- Autonomous decisions → user_profiles (approved_by)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_autonomous_decisions_approved_by'
  ) THEN
    ALTER TABLE autonomous_decisions
      ADD CONSTRAINT fk_autonomous_decisions_approved_by
      FOREIGN KEY (approved_by)
      REFERENCES user_profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Approval workflows → user_profiles (approver_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_approval_workflows_approver'
  ) THEN
    ALTER TABLE approval_workflows
      ADD CONSTRAINT fk_approval_workflows_approver
      FOREIGN KEY (approver_id)
      REFERENCES user_profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- KPI measurements → kpis_kois
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kpi_measurements_kpi'
  ) THEN
    ALTER TABLE kpi_measurements
      ADD CONSTRAINT fk_kpi_measurements_kpi
      FOREIGN KEY (kpi_id)
      REFERENCES kpis_kois(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Work orders → assets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_work_orders_asset'
  ) THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT fk_work_orders_asset
      FOREIGN KEY (asset_id)
      REFERENCES assets(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Asset health monitoring → assets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_asset_health_monitoring_asset'
  ) THEN
    ALTER TABLE asset_health_monitoring
      ADD CONSTRAINT fk_asset_health_monitoring_asset
      FOREIGN KEY (asset_id)
      REFERENCES assets(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Runbook executions → runbooks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_runbook_executions_runbook'
  ) THEN
    ALTER TABLE runbook_executions
      ADD CONSTRAINT fk_runbook_executions_runbook
      FOREIGN KEY (runbook_id)
      REFERENCES runbooks(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Evidence references → evidence_repository
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_evidence_references_evidence'
  ) THEN
    ALTER TABLE evidence_references
      ADD CONSTRAINT fk_evidence_references_evidence
      FOREIGN KEY (evidence_id)
      REFERENCES evidence_repository(id)
      ON DELETE CASCADE;
  END IF;
END $$;
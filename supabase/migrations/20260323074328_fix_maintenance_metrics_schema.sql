/*
  # Fix maintenance_metrics Schema for JAVIS Compatibility

  1. Changes
    - Add columns needed by JAVIS orchestrator for metrics querying
    - Maintain backward compatibility with existing columns
    - Add indexes for performance

  2. New Columns
    - `metric_name` - Name of the metric being recorded
    - `metric_value` - Current value of the metric
    - `target_value` - Target/goal value for the metric

  3. Notes
    - Existing columns (total_assets, active_work_orders, etc.) are preserved
    - recorded_at already exists
    - JAVIS functions in javis-orchestrator/index.ts can now query this table
    - Both old and new column patterns are supported
*/

-- Add new columns for JAVIS compatibility
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_metrics' AND column_name = 'metric_name'
  ) THEN
    ALTER TABLE maintenance_metrics ADD COLUMN metric_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_metrics' AND column_name = 'metric_value'
  ) THEN
    ALTER TABLE maintenance_metrics ADD COLUMN metric_value numeric;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_metrics' AND column_name = 'target_value'
  ) THEN
    ALTER TABLE maintenance_metrics ADD COLUMN target_value numeric;
  END IF;
END $$;

-- Add indexes for JAVIS query performance
CREATE INDEX IF NOT EXISTS idx_maintenance_metrics_metric_name
  ON maintenance_metrics(metric_name);

CREATE INDEX IF NOT EXISTS idx_maintenance_metrics_recorded_at
  ON maintenance_metrics(recorded_at DESC);

-- Add helpful comment
COMMENT ON TABLE maintenance_metrics IS 'Stores maintenance KPIs. Supports both structured columns (total_assets, uptime, etc.) and flexible metric_name/metric_value pattern for JAVIS queries';
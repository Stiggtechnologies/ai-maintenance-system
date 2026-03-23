/*
  # Runbook Automation System

  ## Summary
  Creates the runbook system for automated operational workflows including unplanned downtime triage,
  alarm escalation, and PM backlog optimization.

  ## New Tables
  - `runbooks` - Runbook definitions with trigger conditions
  - `runbook_executions` - History of runbook executions
  - `runbook_steps` - Individual steps within runbooks
  - `runbook_triggers` - Event triggers that launch runbooks
  
  ## Features
  - Event-driven automation
  - Step-by-step workflow execution
  - Approval gates
  - Evidence collection
*/

CREATE TABLE IF NOT EXISTS runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_code TEXT NOT NULL UNIQUE,
  runbook_name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'event', 'scheduled', 'threshold')),
  trigger_conditions JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT TRUE,
  requires_approval BOOLEAN DEFAULT FALSE,
  auto_execute_threshold INTEGER DEFAULT 90,
  priority INTEGER DEFAULT 5,
  estimated_duration_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runbook_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('query', 'action', 'decision', 'notification', 'wait', 'approval')),
  step_config JSONB NOT NULL,
  success_criteria JSONB,
  failure_action TEXT,
  timeout_seconds INTEGER DEFAULT 300,
  required BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(runbook_id, step_order)
);

CREATE TABLE IF NOT EXISTS runbook_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_id UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL,
  trigger_data JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  current_step_order INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  execution_log JSONB DEFAULT '[]'::jsonb,
  evidence_collected JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runbook_step_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES runbook_executions(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES runbook_steps(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_step_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view runbooks"
  ON runbooks FOR SELECT
  TO authenticated
  USING (enabled = true);

CREATE POLICY "Admins can manage runbooks"
  ON runbooks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can view runbook steps for enabled runbooks"
  ON runbook_steps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM runbooks
      WHERE runbooks.id = runbook_steps.runbook_id
      AND runbooks.enabled = true
    )
  );

CREATE POLICY "All authenticated users can view executions"
  ON runbook_executions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage executions"
  ON runbook_executions FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can view step results"
  ON runbook_step_results FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can manage step results"
  ON runbook_step_results FOR ALL
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_runbooks_enabled ON runbooks(enabled, priority DESC) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_runbook_steps_order ON runbook_steps(runbook_id, step_order);
CREATE INDEX IF NOT EXISTS idx_runbook_executions_status ON runbook_executions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runbook_step_results_execution ON runbook_step_results(execution_id, step_order);

CREATE TRIGGER trigger_runbooks_updated_at
  BEFORE UPDATE ON runbooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

INSERT INTO runbooks (runbook_code, runbook_name, description, trigger_type, trigger_conditions, auto_execute_threshold, priority, estimated_duration_minutes)
VALUES
(
  'DOWNTIME_TRIAGE',
  'Unplanned Downtime Triage',
  'Immediate response to unplanned equipment downtime. Assesses severity, identifies root cause indicators, and initiates corrective actions.',
  'event',
  '{"event_type": "asset_status_change", "conditions": {"status": "failed", "unplanned": true}}'::jsonb,
  95,
  10,
  15
),
(
  'ALARM_ESCALATION',
  'High-Priority Alarm Escalation',
  'Automated escalation of critical alarms. Notifies stakeholders, creates work orders, and tracks response times.',
  'event',
  '{"event_type": "system_alert", "conditions": {"severity": "critical", "acknowledged": false}}'::jsonb,
  90,
  9,
  10
),
(
  'PM_BACKLOG_OPT',
  'PM Backlog Optimization',
  'Analyzes PM backlog, prioritizes work based on criticality and resource availability, and suggests scheduling optimizations.',
  'scheduled',
  '{"schedule": "daily", "time": "06:00"}'::jsonb,
  85,
  5,
  30
)
ON CONFLICT (runbook_code) DO NOTHING;

INSERT INTO runbook_steps (runbook_id, step_order, step_name, step_type, step_config, required)
SELECT r.id, s.step_order, s.step_name, s.step_type, s.step_config::jsonb, s.required
FROM runbooks r
CROSS JOIN (VALUES
  ('DOWNTIME_TRIAGE', 1, 'Identify Failed Asset', 'query', '{"query_type": "asset_lookup", "filters": {"status": "failed"}}', true),
  ('DOWNTIME_TRIAGE', 2, 'Collect Sensor Data', 'query', '{"query_type": "sensor_history", "timeframe_minutes": 30}', true),
  ('DOWNTIME_TRIAGE', 3, 'Analyze Failure Pattern', 'action', '{"action_type": "ai_analysis", "model_tier": "high", "task": "root_cause"}', true),
  ('DOWNTIME_TRIAGE', 4, 'Create Emergency Work Order', 'action', '{"action_type": "create_work_order", "priority": "critical"}', true),
  ('DOWNTIME_TRIAGE', 5, 'Notify Maintenance Team', 'notification', '{"channels": ["sms", "push"], "roles": ["TECH", "OPS_MGR"]}', true),
  ('DOWNTIME_TRIAGE', 6, 'Log Evidence', 'action', '{"action_type": "store_evidence", "include": ["sensor_data", "ai_analysis", "timeline"]}', true),
  
  ('ALARM_ESCALATION', 1, 'Validate Alert Severity', 'query', '{"query_type": "alert_details"}', true),
  ('ALARM_ESCALATION', 2, 'Check Previous Occurrences', 'query', '{"query_type": "alert_history", "lookback_days": 7}', true),
  ('ALARM_ESCALATION', 3, 'Escalate to Supervisor', 'notification', '{"channels": ["email", "push"], "roles": ["OPS_MGR", "EXEC"]}', true),
  ('ALARM_ESCALATION', 4, 'Create Incident Work Order', 'action', '{"action_type": "create_work_order", "priority": "high"}', true),
  ('ALARM_ESCALATION', 5, 'Start Response Timer', 'action', '{"action_type": "track_response_time", "sla_minutes": 30}', true),
  
  ('PM_BACKLOG_OPT', 1, 'Load PM Schedule', 'query', '{"query_type": "pm_backlog", "status": ["pending", "overdue"]}', true),
  ('PM_BACKLOG_OPT', 2, 'Assess Asset Criticality', 'query', '{"query_type": "asset_criticality_scores"}', true),
  ('PM_BACKLOG_OPT', 3, 'Check Resource Availability', 'query', '{"query_type": "technician_schedule", "days_ahead": 7}', true),
  ('PM_BACKLOG_OPT', 4, 'Generate Optimized Schedule', 'action', '{"action_type": "ai_optimization", "model_tier": "mid", "task": "scheduling"}', true),
  ('PM_BACKLOG_OPT', 5, 'Request Approval', 'approval', '{"approver_roles": ["PLANNER", "OPS_MGR"], "timeout_hours": 4}', false),
  ('PM_BACKLOG_OPT', 6, 'Update Work Order Schedule', 'action', '{"action_type": "bulk_update_work_orders"}', true)
) AS s(runbook_code, step_order, step_name, step_type, step_config, required)
WHERE r.runbook_code = s.runbook_code
ON CONFLICT (runbook_id, step_order) DO NOTHING;

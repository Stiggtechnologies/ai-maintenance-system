/*
  # Autonomous AI Asset Management System - Core Tables

  ## Overview
  Creates the foundation for a fully autonomous AI system with human-in-the-loop capabilities.

  ## 1. New Tables
  
  ### `user_profiles`
  - `id` (uuid, references auth.users)
  - `email` (text)
  - `full_name` (text)
  - `role` (text) - admin, manager, operator, viewer
  - `preferences` (jsonb) - notification settings, approval thresholds
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### `autonomous_decisions`
  - `id` (uuid, primary key)
  - `decision_type` (text) - work_order_creation, asset_shutdown, maintenance_scheduling
  - `decision_data` (jsonb) - full context and reasoning
  - `confidence_score` (numeric) - AI confidence 0-100
  - `status` (text) - pending, approved, rejected, auto_executed
  - `requires_approval` (boolean) - based on criticality
  - `approved_by` (uuid, references user_profiles)
  - `created_at` (timestamptz)
  - `executed_at` (timestamptz)
  - `approval_deadline` (timestamptz)

  ### `asset_health_monitoring`
  - `id` (uuid, primary key)
  - `asset_id` (uuid, references assets)
  - `health_score` (numeric) - 0-100
  - `predicted_failure_date` (timestamptz)
  - `anomaly_detected` (boolean)
  - `sensor_data` (jsonb)
  - `ai_analysis` (text)
  - `recommendations` (jsonb)
  - `recorded_at` (timestamptz)

  ### `autonomous_actions`
  - `id` (uuid, primary key)
  - `action_type` (text) - create_wo, send_alert, schedule_maintenance
  - `target_id` (uuid) - reference to asset, work order, etc.
  - `action_data` (jsonb)
  - `triggered_by` (text) - agent type
  - `success` (boolean)
  - `executed_at` (timestamptz)

  ### `approval_workflows`
  - `id` (uuid, primary key)
  - `decision_id` (uuid, references autonomous_decisions)
  - `approver_id` (uuid, references user_profiles)
  - `approval_level` (integer)
  - `status` (text) - pending, approved, rejected
  - `comments` (text)
  - `responded_at` (timestamptz)

  ### `system_alerts`
  - `id` (uuid, primary key)
  - `severity` (text) - critical, high, medium, low
  - `title` (text)
  - `description` (text)
  - `alert_type` (text)
  - `target_users` (uuid[])
  - `acknowledged` (boolean)
  - `resolved` (boolean)
  - `created_at` (timestamptz)

  ## 2. Security
  - All tables have RLS enabled
  - Users can only access data relevant to their role
  - Autonomous system can execute with elevated privileges
  - Audit trail for all autonomous actions
*/

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  role text DEFAULT 'operator' CHECK (role IN ('admin', 'manager', 'operator', 'viewer')),
  preferences jsonb DEFAULT '{"notifications": true, "auto_approve_threshold": 80}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Autonomous Decisions Table
CREATE TABLE IF NOT EXISTS autonomous_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_type text NOT NULL,
  decision_data jsonb NOT NULL,
  confidence_score numeric(5,2) DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'auto_executed', 'expired')),
  requires_approval boolean DEFAULT true,
  approved_by uuid REFERENCES user_profiles(id),
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz,
  approval_deadline timestamptz
);

-- Asset Health Monitoring Table
CREATE TABLE IF NOT EXISTS asset_health_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid REFERENCES assets(id) ON DELETE CASCADE,
  health_score numeric(5,2) DEFAULT 100,
  predicted_failure_date timestamptz,
  anomaly_detected boolean DEFAULT false,
  sensor_data jsonb,
  ai_analysis text,
  recommendations jsonb,
  recorded_at timestamptz DEFAULT now()
);

-- Autonomous Actions Table
CREATE TABLE IF NOT EXISTS autonomous_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  target_id uuid,
  action_data jsonb,
  triggered_by text,
  success boolean DEFAULT true,
  error_message text,
  executed_at timestamptz DEFAULT now()
);

-- Approval Workflows Table
CREATE TABLE IF NOT EXISTS approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE CASCADE,
  approver_id uuid REFERENCES user_profiles(id),
  approval_level integer DEFAULT 1,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comments text,
  created_at timestamptz DEFAULT now(),
  responded_at timestamptz
);

-- System Alerts Table
CREATE TABLE IF NOT EXISTS system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title text NOT NULL,
  description text,
  alert_type text NOT NULL,
  target_users uuid[],
  acknowledged boolean DEFAULT false,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_health_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

-- User Profiles Policies
CREATE POLICY "Users can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "System can insert profiles"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Autonomous Decisions Policies
CREATE POLICY "Users can view decisions"
  ON autonomous_decisions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can create decisions"
  ON autonomous_decisions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Managers can approve decisions"
  ON autonomous_decisions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- Asset Health Monitoring Policies
CREATE POLICY "Users can view health data"
  ON asset_health_monitoring FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert health data"
  ON asset_health_monitoring FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Autonomous Actions Policies
CREATE POLICY "Users can view actions"
  ON autonomous_actions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can log actions"
  ON autonomous_actions FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Approval Workflows Policies
CREATE POLICY "Users can view workflows"
  ON approval_workflows FOR SELECT
  TO authenticated
  USING (
    approver_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Approvers can update workflows"
  ON approval_workflows FOR UPDATE
  TO authenticated
  USING (approver_id = auth.uid())
  WITH CHECK (approver_id = auth.uid());

CREATE POLICY "System can create workflows"
  ON approval_workflows FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- System Alerts Policies
CREATE POLICY "Users can view their alerts"
  ON system_alerts FOR SELECT
  TO authenticated
  USING (
    auth.uid() = ANY(target_users) OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "System can create alerts"
  ON system_alerts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can acknowledge alerts"
  ON system_alerts FOR UPDATE
  TO authenticated
  USING (auth.uid() = ANY(target_users))
  WITH CHECK (auth.uid() = ANY(target_users));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_status ON autonomous_decisions(status);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_created ON autonomous_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_health_asset_id ON asset_health_monitoring(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_health_recorded ON asset_health_monitoring(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_health_anomaly ON asset_health_monitoring(anomaly_detected);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_type ON autonomous_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_status ON approval_workflows(status);
CREATE INDEX IF NOT EXISTS idx_system_alerts_severity ON system_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_system_alerts_resolved ON system_alerts(resolved);

-- Function to auto-approve low-risk decisions
CREATE OR REPLACE FUNCTION auto_approve_decisions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confidence_score >= 90 AND NEW.requires_approval = false THEN
    NEW.status := 'auto_executed';
    NEW.executed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_approve_trigger
  BEFORE INSERT ON autonomous_decisions
  FOR EACH ROW
  EXECUTE FUNCTION auto_approve_decisions();

-- Function to create approval workflow
CREATE OR REPLACE FUNCTION create_approval_workflow()
RETURNS TRIGGER AS $$
DECLARE
  manager_id uuid;
BEGIN
  IF NEW.requires_approval = true AND NEW.status = 'pending' THEN
    -- Find a manager to approve
    SELECT id INTO manager_id
    FROM user_profiles
    WHERE role IN ('admin', 'manager')
    ORDER BY random()
    LIMIT 1;
    
    IF manager_id IS NOT NULL THEN
      INSERT INTO approval_workflows (decision_id, approver_id, approval_level)
      VALUES (NEW.id, manager_id, 1);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_workflow_trigger
  AFTER INSERT ON autonomous_decisions
  FOR EACH ROW
  EXECUTE FUNCTION create_approval_workflow();
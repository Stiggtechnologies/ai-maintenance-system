/*
  # OpenClaw Phase 2: Skills, Queueing, Resilience, Cost Tracking UI support
*/

-- Skills registry
CREATE TABLE IF NOT EXISTS openclaw_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  version text,
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_skill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid REFERENCES openclaw_skills(id) ON DELETE SET NULL,
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE SET NULL,
  status text DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb DEFAULT '{}'::jsonb,
  error_message text,
  duration_ms integer,
  created_at timestamptz DEFAULT now()
);

-- Queue + rate limiting
CREATE TABLE IF NOT EXISTS openclaw_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  queue_name text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  attempts integer DEFAULT 0,
  next_run_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer DEFAULT 0,
  limit_value integer DEFAULT 100,
  created_at timestamptz DEFAULT now()
);

-- Error logging
CREATE TABLE IF NOT EXISTS openclaw_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE SET NULL,
  source text,
  message text,
  stack text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_openclaw_skills_name ON openclaw_skills(name);
CREATE INDEX IF NOT EXISTS idx_openclaw_skill_runs_status ON openclaw_skill_runs(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_queue_status ON openclaw_queue(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_queue_next ON openclaw_queue(next_run_at);
CREATE INDEX IF NOT EXISTS idx_openclaw_rate_key ON openclaw_rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_openclaw_errors_created ON openclaw_errors(created_at DESC);

-- RLS
ALTER TABLE openclaw_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_skill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "openclaw_skills_select" ON openclaw_skills FOR SELECT TO authenticated USING (true);
CREATE POLICY "openclaw_skills_insert" ON openclaw_skills FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "openclaw_skill_runs_select" ON openclaw_skill_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "openclaw_skill_runs_insert" ON openclaw_skill_runs FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "openclaw_queue_select" ON openclaw_queue FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "openclaw_queue_insert" ON openclaw_queue FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "openclaw_rate_select" ON openclaw_rate_limits FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "openclaw_rate_insert" ON openclaw_rate_limits FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "openclaw_errors_select" ON openclaw_errors FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));
CREATE POLICY "openclaw_errors_insert" ON openclaw_errors FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

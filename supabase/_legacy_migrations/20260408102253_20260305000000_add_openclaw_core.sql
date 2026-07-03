/*
  # OpenClaw Core System Tables

  Adds the foundational data model for:
  - Multi-agent orchestration
  - Memory (semantic search)
  - Tool calling
  - Sessions & context persistence
  - Event-driven automation (cron + heartbeats)
  - Notifications, health checks, cost tracking
*/

-- Agents
CREATE TABLE IF NOT EXISTS openclaw_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  agent_type text NOT NULL,
  persona jsonb DEFAULT '{}'::jsonb,
  config jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Sessions
CREATE TABLE IF NOT EXISTS openclaw_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid REFERENCES openclaw_agents(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  context jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  started_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now()
);

-- Messages
CREATE TABLE IF NOT EXISTS openclaw_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Memory (semantic)
CREATE TABLE IF NOT EXISTS openclaw_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid REFERENCES openclaw_agents(id) ON DELETE SET NULL,
  memory_type text DEFAULT 'semantic' CHECK (memory_type IN ('semantic', 'episodic', 'procedural')),
  content text NOT NULL,
  embedding vector(1536),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Tool registry
CREATE TABLE IF NOT EXISTS openclaw_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  schema jsonb DEFAULT '{}'::jsonb,
  handler text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Tool calls
CREATE TABLE IF NOT EXISTS openclaw_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE SET NULL,
  tool_id uuid REFERENCES openclaw_tools(id) ON DELETE SET NULL,
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error')),
  duration_ms integer,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Orchestration runs
CREATE TABLE IF NOT EXISTS openclaw_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_run_id uuid REFERENCES openclaw_orchestration_runs(id) ON DELETE SET NULL,
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES openclaw_agents(id) ON DELETE SET NULL,
  status text DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz
);

-- Event scheduling (cron + heartbeat)
CREATE TABLE IF NOT EXISTS openclaw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('cron', 'heartbeat', 'manual')),
  schedule text,
  payload jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  last_run_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_event_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES openclaw_events(id) ON DELETE CASCADE,
  status text DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  output jsonb DEFAULT '{}'::jsonb,
  duration_ms integer,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz
);

-- Notifications
CREATE TABLE IF NOT EXISTS openclaw_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  channel text NOT NULL,
  target text NOT NULL,
  message text NOT NULL,
  status text DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_at timestamptz DEFAULT now()
);

-- Health checks
CREATE TABLE IF NOT EXISTS openclaw_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text DEFAULT 'ok' CHECK (status IN ('ok', 'warn', 'error')),
  details jsonb DEFAULT '{}'::jsonb,
  checked_at timestamptz DEFAULT now()
);

-- Cost tracking
CREATE TABLE IF NOT EXISTS openclaw_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid REFERENCES openclaw_sessions(id) ON DELETE SET NULL,
  model text,
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  cost_usd numeric(10,4) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_openclaw_sessions_tenant ON openclaw_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_messages_session ON openclaw_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_memory_tenant ON openclaw_memory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_tools_name ON openclaw_tools(name);
CREATE INDEX IF NOT EXISTS idx_openclaw_tool_calls_session ON openclaw_tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_orchestration_status ON openclaw_orchestration_runs(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_events_active ON openclaw_events(is_active);
CREATE INDEX IF NOT EXISTS idx_openclaw_notifications_status ON openclaw_notifications(status);

-- RLS
ALTER TABLE openclaw_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_orchestration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_event_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_costs ENABLE ROW LEVEL SECURITY;

-- Policies wrapped in DO blocks
DO $$ BEGIN
  CREATE POLICY "openclaw_agents_select" ON openclaw_agents FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_agents_insert" ON openclaw_agents FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_sessions_select" ON openclaw_sessions FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_sessions_insert" ON openclaw_sessions FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_messages_select" ON openclaw_messages FOR SELECT TO authenticated
    USING (session_id IN (SELECT id FROM openclaw_sessions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_messages_insert" ON openclaw_messages FOR INSERT TO authenticated
    WITH CHECK (session_id IN (SELECT id FROM openclaw_sessions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_memory_select" ON openclaw_memory FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_memory_insert" ON openclaw_memory FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_tools_select" ON openclaw_tools FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_tools_insert" ON openclaw_tools FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_tool_calls_select" ON openclaw_tool_calls FOR SELECT TO authenticated
    USING (session_id IN (SELECT id FROM openclaw_sessions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_tool_calls_insert" ON openclaw_tool_calls FOR INSERT TO authenticated
    WITH CHECK (session_id IN (SELECT id FROM openclaw_sessions WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_orchestration_select" ON openclaw_orchestration_runs FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_orchestration_insert" ON openclaw_orchestration_runs FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_events_select" ON openclaw_events FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_events_insert" ON openclaw_events FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_event_runs_select" ON openclaw_event_runs FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM openclaw_events WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_event_runs_insert" ON openclaw_event_runs FOR INSERT TO authenticated
    WITH CHECK (event_id IN (SELECT id FROM openclaw_events WHERE tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_notifications_select" ON openclaw_notifications FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_notifications_insert" ON openclaw_notifications FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_health_checks_select" ON openclaw_health_checks FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_health_checks_insert" ON openclaw_health_checks FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_costs_select" ON openclaw_costs FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "openclaw_costs_insert" ON openclaw_costs FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Memory search function
CREATE OR REPLACE FUNCTION search_openclaw_memory(
  query_embedding vector(1536),
  target_tenant_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10,
  target_agent_id uuid DEFAULT NULL
)
RETURNS TABLE (
  memory_id uuid,
  content text,
  similarity float,
  memory_type text,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id AS memory_id,
    m.content,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.memory_type,
    m.metadata
  FROM openclaw_memory m
  WHERE
    m.tenant_id = target_tenant_id
    AND (target_agent_id IS NULL OR m.agent_id = target_agent_id)
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
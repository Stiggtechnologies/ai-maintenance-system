/*
  # J.A.V.I.S (Just-in-time Asset & Value Intelligence System)

  1. New Tables
    - `user_preferences` - Voice/notification preferences per user
    - `roles_raci` - Role-based RACI matrix and communication styles
    - `user_role_map` - Maps users to roles with site context
    - `event_subscriptions` - User event subscriptions with filters
    - `javis_messages` - Delivered message log for audit
    - `javis_conversations` - Conversation sessions
    - `javis_context_cache` - Cache for briefing context

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users (own data only)
    - Add policies for admins to manage RACI

  3. Functions
    - `get_user_brief_context` - Gather context for morning brief
    - `log_javis_interaction` - Audit logging helper

  4. Indexes
    - Performance indexes for common queries
*/

-- User Preferences Table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  prefers_voice BOOLEAN DEFAULT FALSE,
  voice_locale TEXT DEFAULT 'en-CA',
  voice_gender TEXT DEFAULT 'neutral',
  voice_speed NUMERIC DEFAULT 1.0 CHECK (voice_speed BETWEEN 0.5 AND 2.0),
  morning_brief_time TIME DEFAULT '07:30',
  notify_channels JSONB DEFAULT '{"in_app":true,"email":false,"sms":false,"push":true}'::jsonb,
  javis_enabled BOOLEAN DEFAULT TRUE,
  timezone TEXT DEFAULT 'America/Toronto',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Roles RACI Matrix
CREATE TABLE IF NOT EXISTS roles_raci (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  role_name TEXT NOT NULL,
  raci JSONB NOT NULL DEFAULT '{}'::jsonb,
  comm_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_filters JSONB DEFAULT '{}'::jsonb,
  priority_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, role_code)
);

-- User Role Mapping
CREATE TABLE IF NOT EXISTS user_role_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  site_id UUID,
  is_primary BOOLEAN DEFAULT FALSE,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, role_code, site_id)
);

-- Event Subscriptions
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_types TEXT[] NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  severity_threshold TEXT DEFAULT 'medium',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- J.A.V.I.S Messages Log
CREATE TABLE IF NOT EXISTS javis_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email', 'sms', 'voice', 'websocket')),
  message_type TEXT NOT NULL CHECK (message_type IN ('greeting', 'brief', 'update', 'response', 'alert')),
  message TEXT NOT NULL,
  citations JSONB DEFAULT '[]'::jsonb,
  event_meta JSONB,
  audio_url TEXT,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- J.A.V.I.S Conversations
CREATE TABLE IF NOT EXISTS javis_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role_code TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  feedback TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- J.A.V.I.S Context Cache (for performance)
CREATE TABLE IF NOT EXISTS javis_context_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL CHECK (context_type IN ('morning_brief', 'kpi_summary', 'risk_summary', 'workorder_summary')),
  context_data JSONB NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, context_type)
);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles_raci ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_context_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies: user_preferences
CREATE POLICY "Users can view own preferences"
  ON user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: roles_raci
CREATE POLICY "Users can view RACI roles in tenant"
  ON roles_raci FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage RACI roles"
  ON roles_raci FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND tenant_id = roles_raci.tenant_id
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: user_role_map
CREATE POLICY "Users can view own role mappings"
  ON user_role_map FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage role mappings"
  ON user_role_map FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND tenant_id = user_role_map.tenant_id
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: event_subscriptions
CREATE POLICY "Users can manage own subscriptions"
  ON event_subscriptions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_messages
CREATE POLICY "Users can view own messages"
  ON javis_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert messages"
  ON javis_messages FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own message read status"
  ON javis_messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_conversations
CREATE POLICY "Users can view own conversations"
  ON javis_conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own conversations"
  ON javis_conversations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_context_cache
CREATE POLICY "Users can view own context cache"
  ON javis_context_cache FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage context cache"
  ON javis_context_cache FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_raci_tenant_code ON roles_raci(tenant_id, role_code);
CREATE INDEX IF NOT EXISTS idx_user_role_map_user ON user_role_map(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_role_map_role ON user_role_map(role_code, tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_user ON event_subscriptions(user_id, tenant_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_javis_messages_user_created ON javis_messages(user_id, tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_javis_messages_unread ON javis_messages(user_id, tenant_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_javis_conversations_user ON javis_conversations(user_id, tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_javis_context_cache_user ON javis_context_cache(user_id, tenant_id, context_type);

-- Function: Get User Brief Context
CREATE OR REPLACE FUNCTION get_user_brief_context(
  target_user_id UUID,
  target_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  user_roles TEXT[];
  user_sites UUID[];
BEGIN
  -- Get user roles
  SELECT ARRAY_AGG(DISTINCT role_code)
  INTO user_roles
  FROM user_role_map
  WHERE user_id = target_user_id
    AND tenant_id = target_tenant_id
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE);

  -- Get user sites
  SELECT ARRAY_AGG(DISTINCT site_id)
  INTO user_sites
  FROM user_role_map
  WHERE user_id = target_user_id
    AND tenant_id = target_tenant_id
    AND site_id IS NOT NULL
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE);

  -- Build context
  result := jsonb_build_object(
    'user_id', target_user_id,
    'tenant_id', target_tenant_id,
    'roles', user_roles,
    'sites', user_sites,
    'timestamp', now()
  );

  RETURN result;
END;
$$;

-- Function: Log J.A.V.I.S Interaction (for RAI audit)
CREATE OR REPLACE FUNCTION log_javis_interaction(
  p_tenant_id UUID,
  p_user_id UUID,
  p_conversation_id UUID,
  p_interaction_type TEXT,
  p_input TEXT,
  p_output TEXT,
  p_citations JSONB DEFAULT '[]'::jsonb,
  p_tools_used JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO rai_audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    created_at
  ) VALUES (
    p_tenant_id,
    p_user_id,
    'javis_interaction',
    'conversation',
    p_conversation_id,
    jsonb_build_object(
      'interaction_type', p_interaction_type,
      'input', p_input,
      'output', p_output,
      'citations', p_citations,
      'tools_used', p_tools_used
    ),
    now()
  )
  RETURNING id INTO audit_id;

  RETURN audit_id;
END;
$$;

-- Seed Default RACI Roles
INSERT INTO roles_raci (tenant_id, role_code, role_name, raci, comm_style, content_filters, priority_order)
SELECT
  t.id,
  role.role_code,
  role.role_name,
  role.raci::jsonb,
  role.comm_style::jsonb,
  role.content_filters::jsonb,
  role.priority_order
FROM tenants t
CROSS JOIN (
  VALUES
    (
      'EXEC',
      'Executive',
      '{"A":["Availability","Budget","Risk","Compliance"],"I":["Incidents","Audits"]}',
      '{"tone":"concise","bullets":true,"max_items":5,"focus":"strategic","show_financial":true}',
      '{"min_severity":"high","categories":["strategic","financial","risk"]}',
      1
    ),
    (
      'OPS_MGR',
      'Operations Manager',
      '{"A":["Operations","Resources"],"R":["Scheduling","Backlog"],"C":["Budget"],"I":["Safety"]}',
      '{"tone":"operational","bullets":true,"max_items":7,"focus":"tactical","show_trends":true}',
      '{"min_severity":"medium","categories":["operations","scheduling","resources"]}',
      2
    ),
    (
      'REL_ENG',
      'Reliability Engineer',
      '{"R":["RCA","PdM","Analysis"],"C":["Schedule","Design"],"I":["Budget","Operations"]}',
      '{"tone":"technical","bullets":true,"max_items":8,"focus":"analysis","show_metrics":true}',
      '{"min_severity":"low","categories":["reliability","failure-analysis","predictive"]}',
      3
    ),
    (
      'PLANNER',
      'Maintenance Planner',
      '{"R":["Planning","Scheduling","Materials"],"C":["Execution"],"I":["Budget","Resources"]}',
      '{"tone":"operational","bullets":false,"max_items":10,"focus":"tasks","show_constraints":true}',
      '{"min_severity":"medium","categories":["planning","scheduling","materials","constraints"]}',
      4
    ),
    (
      'TECH',
      'Maintenance Technician',
      '{"R":["Execution","Documentation"],"I":["Safety","Quality"]}',
      '{"tone":"practical","bullets":false,"max_items":5,"focus":"action","show_procedures":true}',
      '{"min_severity":"medium","categories":["work-orders","safety","procedures","tools"]}',
      5
    ),
    (
      'HSE',
      'Health Safety Environment',
      '{"A":["Safety","Compliance"],"R":["Inspections","Incidents"],"C":["Operations"]}',
      '{"tone":"formal","bullets":true,"max_items":6,"focus":"compliance","show_overdue":true}',
      '{"min_severity":"low","categories":["safety","incidents","inspections","compliance"]}',
      6
    ),
    (
      'PROC',
      'Procurement/Inventory',
      '{"R":["Procurement","Inventory"],"C":["Planning"],"I":["Budget"]}',
      '{"tone":"operational","bullets":true,"max_items":7,"focus":"supply","show_lead_times":true}',
      '{"min_severity":"medium","categories":["procurement","inventory","stockouts","vendors"]}',
      7
    ),
    (
      'ASSET_MGR',
      'Asset Manager',
      '{"A":["Asset Strategy","Lifecycle"],"R":["Portfolio"],"C":["Operations","Reliability"],"I":["Budget"]}',
      '{"tone":"strategic","bullets":true,"max_items":6,"focus":"lifecycle","show_roi":true}',
      '{"min_severity":"medium","categories":["asset-strategy","lifecycle","investment","performance"]}',
      8
    )
) AS role(role_code, role_name, raci, comm_style, content_filters, priority_order)
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_raci_updated_at
  BEFORE UPDATE ON roles_raci
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_event_subscriptions_updated_at
  BEFORE UPDATE ON event_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

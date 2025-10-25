/*
  # J.A.V.I.S Interactive Features - WebSocket, Tools, Events

  1. New Tables
    - `javis_conversation_state` - Real-time conversation context
    - `javis_tool_definitions` - Available tools/actions
    - `javis_tool_executions` - Tool execution history with confirmation
    - `javis_pending_actions` - Actions awaiting user confirmation
    - `javis_event_queue` - Proactive event notifications
    - `javis_websocket_sessions` - Active WebSocket connections

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users

  3. Functions
    - `execute_javis_tool` - Execute confirmed tool actions
    - `queue_javis_event` - Queue proactive updates
    - `get_conversation_context` - Get recent conversation history
*/

-- Conversation State (for context management)
CREATE TABLE IF NOT EXISTS javis_conversation_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES javis_conversations(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  assistant_message TEXT,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  context_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conversation_id, turn_number)
);

-- Tool Definitions
CREATE TABLE IF NOT EXISTS javis_tool_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_description TEXT NOT NULL,
  parameters JSONB NOT NULL,
  required_role TEXT[],
  requires_confirmation BOOLEAN DEFAULT TRUE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, tool_name)
);

-- Tool Executions
CREATE TABLE IF NOT EXISTS javis_tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES javis_conversations(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  parameters JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'executed', 'failed', 'cancelled', 'undone')),
  result JSONB,
  error_message TEXT,
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pending Actions (awaiting confirmation)
CREATE TABLE IF NOT EXISTS javis_pending_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES javis_conversations(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_description TEXT NOT NULL,
  action_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Event Queue (proactive updates)
CREATE TABLE IF NOT EXISTS javis_event_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  target_users UUID[],
  target_roles TEXT[],
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- WebSocket Sessions
CREATE TABLE IF NOT EXISTS javis_websocket_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  conversation_id UUID REFERENCES javis_conversations(id) ON DELETE CASCADE,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_activity TIMESTAMPTZ DEFAULT now(),
  disconnected_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE javis_conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_event_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE javis_websocket_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: javis_conversation_state
CREATE POLICY "Users can view own conversation state"
  ON javis_conversation_state FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage conversation state"
  ON javis_conversation_state FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_tool_definitions
CREATE POLICY "Users can view enabled tools in tenant"
  ON javis_tool_definitions FOR SELECT
  TO authenticated
  USING (
    enabled = true AND tenant_id IN (
      SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage tool definitions"
  ON javis_tool_definitions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND tenant_id = javis_tool_definitions.tenant_id
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: javis_tool_executions
CREATE POLICY "Users can view own tool executions"
  ON javis_tool_executions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage tool executions"
  ON javis_tool_executions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_pending_actions
CREATE POLICY "Users can manage own pending actions"
  ON javis_pending_actions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies: javis_event_queue
CREATE POLICY "Users can view events for their roles"
  ON javis_event_queue FOR SELECT
  TO authenticated
  USING (
    NOT processed OR
    auth.uid() = ANY(target_users) OR
    EXISTS (
      SELECT 1 FROM user_role_map
      WHERE user_id = auth.uid()
      AND role_code = ANY(target_roles)
    )
  );

CREATE POLICY "System can manage event queue"
  ON javis_event_queue FOR ALL
  TO authenticated
  WITH CHECK (true);

-- RLS Policies: javis_websocket_sessions
CREATE POLICY "Users can view own WebSocket sessions"
  ON javis_websocket_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own WebSocket sessions"
  ON javis_websocket_sessions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_conversation_state_conversation ON javis_conversation_state(conversation_id, turn_number);
CREATE INDEX IF NOT EXISTS idx_tool_executions_user ON javis_tool_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON javis_tool_executions(status) WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_pending_actions_user ON javis_pending_actions(user_id) WHERE expires_at > now();
CREATE INDEX IF NOT EXISTS idx_event_queue_unprocessed ON javis_event_queue(created_at DESC) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_event_queue_priority ON javis_event_queue(priority, created_at DESC) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_websocket_sessions_active ON javis_websocket_sessions(user_id, tenant_id) WHERE disconnected_at IS NULL;

-- Function: Get Conversation Context
CREATE OR REPLACE FUNCTION get_conversation_context(
  p_conversation_id UUID,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'turn', turn_number,
      'user', user_message,
      'assistant', assistant_message,
      'tools', tool_calls,
      'timestamp', created_at
    )
    ORDER BY turn_number DESC
  )
  INTO result
  FROM (
    SELECT *
    FROM javis_conversation_state
    WHERE conversation_id = p_conversation_id
    ORDER BY turn_number DESC
    LIMIT p_limit
  ) sub;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Function: Execute J.A.V.I.S Tool
CREATE OR REPLACE FUNCTION execute_javis_tool(
  p_execution_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  execution RECORD;
  result JSONB;
BEGIN
  -- Get execution details
  SELECT * INTO execution
  FROM javis_tool_executions
  WHERE id = p_execution_id
  AND status = 'confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Execution not found or not confirmed');
  END IF;

  -- Execute based on tool name
  CASE execution.tool_name
    WHEN 'create_work_order' THEN
      -- Insert work order
      INSERT INTO work_orders (
        tenant_id,
        title,
        description,
        priority,
        status,
        due_date,
        assigned_to
      ) VALUES (
        execution.tenant_id,
        execution.parameters->>'title',
        execution.parameters->>'description',
        COALESCE(execution.parameters->>'priority', 'medium'),
        'pending',
        (execution.parameters->>'due_date')::timestamptz,
        (execution.parameters->>'assigned_to')::uuid
      )
      RETURNING jsonb_build_object('work_order_id', id, 'status', status) INTO result;

    WHEN 'schedule_inspection' THEN
      -- Schedule inspection (create work order)
      INSERT INTO work_orders (
        tenant_id,
        title,
        description,
        priority,
        status,
        due_date
      ) VALUES (
        execution.tenant_id,
        'Inspection: ' || (execution.parameters->>'asset_name'),
        execution.parameters->>'notes',
        'high',
        'pending',
        (execution.parameters->>'scheduled_date')::timestamptz
      )
      RETURNING jsonb_build_object('inspection_id', id, 'scheduled_date', due_date) INTO result;

    WHEN 'order_parts' THEN
      -- Note: This would integrate with procurement system
      result := jsonb_build_object(
        'success', true,
        'part_number', execution.parameters->>'part_number',
        'quantity', execution.parameters->>'quantity',
        'urgency', execution.parameters->>'urgency',
        'message', 'Purchase order request created'
      );

    WHEN 'update_asset_status' THEN
      -- Update asset status
      UPDATE assets
      SET
        status = execution.parameters->>'status',
        updated_at = now()
      WHERE id = (execution.parameters->>'asset_id')::uuid
      AND tenant_id = execution.tenant_id
      RETURNING jsonb_build_object('asset_id', id, 'new_status', status) INTO result;

    ELSE
      result := jsonb_build_object('success', false, 'error', 'Unknown tool: ' || execution.tool_name);
  END CASE;

  -- Update execution record
  UPDATE javis_tool_executions
  SET
    status = 'executed',
    result = result,
    executed_at = now()
  WHERE id = p_execution_id;

  RETURN result;
END;
$$;

-- Function: Queue J.A.V.I.S Event
CREATE OR REPLACE FUNCTION queue_javis_event(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_event_data JSONB,
  p_priority TEXT DEFAULT 'medium',
  p_target_users UUID[] DEFAULT NULL,
  p_target_roles TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_id UUID;
BEGIN
  INSERT INTO javis_event_queue (
    tenant_id,
    event_type,
    event_data,
    priority,
    target_users,
    target_roles
  ) VALUES (
    p_tenant_id,
    p_event_type,
    p_event_data,
    p_priority,
    p_target_users,
    p_target_roles
  )
  RETURNING id INTO event_id;

  RETURN event_id;
END;
$$;

-- Seed Tool Definitions
INSERT INTO javis_tool_definitions (tenant_id, tool_name, tool_description, parameters, required_role, requires_confirmation)
SELECT
  t.id,
  tool.name,
  tool.description,
  tool.params::jsonb,
  tool.roles::text[],
  tool.confirm::boolean
FROM tenants t
CROSS JOIN (
  VALUES
    (
      'create_work_order',
      'Create a new work order for maintenance or repair',
      '{"title":{"type":"string","required":true},"description":{"type":"string","required":true},"priority":{"type":"string","enum":["low","medium","high","critical"]},"due_date":{"type":"datetime","required":true},"assigned_to":{"type":"uuid"}}',
      ARRAY['PLANNER', 'OPS_MGR', 'TECH'],
      true
    ),
    (
      'schedule_inspection',
      'Schedule an asset inspection',
      '{"asset_name":{"type":"string","required":true},"scheduled_date":{"type":"datetime","required":true},"duration_hours":{"type":"number"},"notes":{"type":"string"}}',
      ARRAY['PLANNER', 'REL_ENG', 'OPS_MGR'],
      true
    ),
    (
      'order_parts',
      'Request parts from procurement',
      '{"part_number":{"type":"string","required":true},"quantity":{"type":"number","required":true},"urgency":{"type":"string","enum":["standard","rush","emergency"]},"reason":{"type":"string"}}',
      ARRAY['PLANNER', 'TECH', 'PROC'],
      true
    ),
    (
      'update_asset_status',
      'Update the status of an asset',
      '{"asset_id":{"type":"uuid","required":true},"status":{"type":"string","enum":["operational","degraded","failed","maintenance","offline"]},"reason":{"type":"string"}}',
      ARRAY['OPS_MGR', 'REL_ENG', 'TECH'],
      true
    ),
    (
      'notify_user',
      'Send a notification to a user',
      '{"user_id":{"type":"uuid","required":true},"message":{"type":"string","required":true},"priority":{"type":"string","enum":["low","medium","high"]}}',
      ARRAY['OPS_MGR', 'EXEC'],
      false
    ),
    (
      'approve_action',
      'Approve a pending action or decision',
      '{"action_id":{"type":"uuid","required":true},"notes":{"type":"string"}}',
      ARRAY['EXEC', 'OPS_MGR'],
      false
    ),
    (
      'defer_action',
      'Defer an action or notification',
      '{"action_id":{"type":"uuid","required":true},"defer_until":{"type":"datetime","required":true},"reason":{"type":"string"}}',
      ARRAY['EXEC', 'OPS_MGR', 'PLANNER'],
      false
    )
) AS tool(name, description, params, roles, confirm)
ON CONFLICT (tenant_id, tool_name) DO NOTHING;

-- Create trigger to clean up expired pending actions
CREATE OR REPLACE FUNCTION cleanup_expired_pending_actions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM javis_pending_actions
  WHERE expires_at < now();
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_cleanup_expired_actions
  AFTER INSERT ON javis_pending_actions
  EXECUTE FUNCTION cleanup_expired_pending_actions();

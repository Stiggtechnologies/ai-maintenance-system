/*
  # Policy Engine and Model Routing

  ## Summary
  Adds policy-based model selection, routing logic, and runtime configuration for SyncAI v2.

  ## New Tables
  
  ### Policy Management
  - `model_policies` - Model access policies per user/role
  - `routing_rules` - Dynamic routing rules based on task complexity
  - `model_registry` - Available models with capabilities and costs
  
  ## Security
  - Enable RLS on all tables
  - Admin-only access to policy management
  
  ## Features
  - Policy-based model selection
  - Cost optimization
  - Complexity-based routing
  - Data sensitivity handling
*/

-- Model Registry
CREATE TABLE IF NOT EXISTS model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL UNIQUE,
  model_provider TEXT NOT NULL CHECK (model_provider IN ('openai', 'anthropic', 'local', 'azure')),
  model_tier TEXT NOT NULL CHECK (model_tier IN ('low', 'mid', 'high', 'reasoning')),
  capabilities JSONB DEFAULT '{}'::jsonb,
  max_context_tokens INTEGER DEFAULT 8000,
  cost_per_1k_input NUMERIC(10, 6) DEFAULT 0,
  cost_per_1k_output NUMERIC(10, 6) DEFAULT 0,
  avg_latency_ms INTEGER,
  supports_function_calling BOOLEAN DEFAULT FALSE,
  supports_vision BOOLEAN DEFAULT FALSE,
  data_residency TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Model Policies
CREATE TABLE IF NOT EXISTS model_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role_code TEXT,
  allowed_models TEXT[],
  blocked_models TEXT[],
  max_cost_per_request NUMERIC(10, 6),
  require_local_only BOOLEAN DEFAULT FALSE,
  require_private_only BOOLEAN DEFAULT FALSE,
  data_classification_rules JSONB DEFAULT '{}'::jsonb,
  priority INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Routing Rules
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT NOT NULL,
  condition_type TEXT NOT NULL CHECK (condition_type IN ('task_complexity', 'data_sensitivity', 'latency_requirement', 'cost_limit', 'custom')),
  condition_expression JSONB NOT NULL,
  target_model_tier TEXT CHECK (target_model_tier IN ('low', 'mid', 'high', 'reasoning')),
  target_model_name TEXT,
  fallback_model_name TEXT,
  priority INTEGER DEFAULT 5,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Runtime Sessions (for tracking model usage)
CREATE TABLE IF NOT EXISTS runtime_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  selection_reason TEXT,
  task_complexity TEXT,
  data_sensitivity TEXT,
  total_tokens INTEGER DEFAULT 0,
  total_cost NUMERIC(10, 6) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: model_registry
CREATE POLICY "All authenticated users can view model registry"
  ON model_registry FOR SELECT
  TO authenticated
  USING (enabled = true);

CREATE POLICY "Admins can manage model registry"
  ON model_registry FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: model_policies
CREATE POLICY "Users can view their own policies"
  ON model_policies FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can manage all policies"
  ON model_policies FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: routing_rules
CREATE POLICY "All authenticated users can view routing rules"
  ON routing_rules FOR SELECT
  TO authenticated
  USING (enabled = true);

CREATE POLICY "Admins can manage routing rules"
  ON routing_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

-- RLS Policies: runtime_sessions
CREATE POLICY "Users can view their own runtime sessions"
  ON runtime_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage runtime sessions"
  ON runtime_sessions FOR ALL
  TO authenticated
  USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(model_tier) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_model_policies_user ON model_policies(user_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_model_policies_role ON model_policies(role_code) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_routing_rules_priority ON routing_rules(priority DESC) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_runtime_sessions_user ON runtime_sessions(user_id, started_at DESC);

-- Function: Select Model Based on Policy
CREATE OR REPLACE FUNCTION select_model_for_task(
  p_user_id UUID,
  p_task_complexity TEXT,
  p_data_sensitivity TEXT,
  p_max_cost NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  model_name TEXT,
  model_provider TEXT,
  selection_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
  v_policy RECORD;
  v_rule RECORD;
  v_selected_model TEXT;
  v_reason TEXT;
BEGIN
  SELECT role INTO v_user_role
  FROM user_profiles
  WHERE id = p_user_id;

  SELECT * INTO v_policy
  FROM model_policies
  WHERE (user_id = p_user_id OR role_code = v_user_role)
  AND active = true
  ORDER BY priority DESC
  LIMIT 1;

  IF p_data_sensitivity = 'regulated' AND v_policy.require_local_only THEN
    SELECT mr.model_name INTO v_selected_model
    FROM model_registry mr
    WHERE mr.data_residency = 'local'
    AND mr.enabled = true
    ORDER BY mr.cost_per_1k_input
    LIMIT 1;
    
    v_reason := 'Local model required for regulated data';
  ELSIF p_task_complexity = 'high' OR p_task_complexity = 'reasoning' THEN
    SELECT mr.model_name INTO v_selected_model
    FROM model_registry mr
    WHERE mr.model_tier IN ('high', 'reasoning')
    AND mr.enabled = true
    AND (v_policy.allowed_models IS NULL OR mr.model_name = ANY(v_policy.allowed_models))
    AND (v_policy.blocked_models IS NULL OR NOT (mr.model_name = ANY(v_policy.blocked_models)))
    ORDER BY mr.model_tier DESC, mr.cost_per_1k_input
    LIMIT 1;
    
    v_reason := 'High-tier model for complex task';
  ELSIF p_task_complexity = 'low' THEN
    SELECT mr.model_name INTO v_selected_model
    FROM model_registry mr
    WHERE mr.model_tier = 'low'
    AND mr.enabled = true
    AND (v_policy.allowed_models IS NULL OR mr.model_name = ANY(v_policy.allowed_models))
    ORDER BY mr.cost_per_1k_input
    LIMIT 1;
    
    v_reason := 'Low-cost model for simple task';
  ELSE
    SELECT mr.model_name INTO v_selected_model
    FROM model_registry mr
    WHERE mr.model_tier = 'mid'
    AND mr.enabled = true
    AND (v_policy.allowed_models IS NULL OR mr.model_name = ANY(v_policy.allowed_models))
    ORDER BY mr.cost_per_1k_input
    LIMIT 1;
    
    v_reason := 'Mid-tier model for standard task';
  END IF;

  IF v_selected_model IS NULL THEN
    SELECT mr.model_name INTO v_selected_model
    FROM model_registry mr
    WHERE mr.enabled = true
    ORDER BY mr.model_tier
    LIMIT 1;
    
    v_reason := 'Fallback model selection';
  END IF;

  RETURN QUERY
  SELECT
    v_selected_model,
    mr.model_provider,
    v_reason
  FROM model_registry mr
  WHERE mr.model_name = v_selected_model;
END;
$$;

-- Seed Model Registry
INSERT INTO model_registry (model_name, model_provider, model_tier, max_context_tokens, cost_per_1k_input, cost_per_1k_output, supports_function_calling)
VALUES
  ('gpt-4o', 'openai', 'high', 128000, 0.005, 0.015, true),
  ('gpt-4o-mini', 'openai', 'mid', 128000, 0.00015, 0.0006, true),
  ('gpt-3.5-turbo', 'openai', 'low', 16000, 0.0005, 0.0015, true),
  ('o1', 'openai', 'reasoning', 128000, 0.015, 0.06, false),
  ('o1-mini', 'openai', 'reasoning', 128000, 0.003, 0.012, false),
  ('claude-3-5-sonnet', 'anthropic', 'high', 200000, 0.003, 0.015, true),
  ('claude-3-5-haiku', 'anthropic', 'mid', 200000, 0.0008, 0.004, true)
ON CONFLICT (model_name) DO NOTHING;

-- Seed Default Routing Rules
INSERT INTO routing_rules (rule_name, condition_type, condition_expression, target_model_tier, priority)
VALUES
  ('High complexity tasks', 'task_complexity', '{"complexity": "high"}', 'high', 10),
  ('Reasoning tasks', 'task_complexity', '{"complexity": "reasoning"}', 'reasoning', 10),
  ('Simple classification', 'task_complexity', '{"complexity": "low"}', 'low', 5),
  ('Standard tasks', 'task_complexity', '{"complexity": "medium"}', 'mid', 5),
  ('Regulated data', 'data_sensitivity', '{"sensitivity": "regulated"}', NULL, 15)
ON CONFLICT DO NOTHING;

-- Trigger: Auto-update updated_at
CREATE TRIGGER trigger_model_registry_updated_at
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_model_policies_updated_at
  BEFORE UPDATE ON model_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

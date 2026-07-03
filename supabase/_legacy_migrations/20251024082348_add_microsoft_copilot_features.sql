/*
  # Microsoft Copilot-Style Features
  
  Add connector framework, hybrid search, GraphRAG, tool-calling,
  safety controls, canary deployments, and cost governance
*/

-- Data Sources (Connector Framework)
CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'sharepoint', 'onedrive', 'blob_storage', 
    'sap', 'maximo', 'cmms',
    'pi_historian', 'scada', 
    'email', 'manual_upload'
  )),
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  documents_synced INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sync Jobs
CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('full', 'delta')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'failed'
  )),
  new_items INTEGER DEFAULT 0,
  updated_items INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- GraphRAG: Entities
CREATE TABLE IF NOT EXISTS graph_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  source_chunk_ids UUID[],
  properties JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),
  mention_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, entity_type, entity_name)
);

-- GraphRAG: Relationships
CREATE TABLE IF NOT EXISTS graph_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  to_entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence_score FLOAT CHECK (confidence_score BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tool Definitions
CREATE TABLE IF NOT EXISTS tool_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  tool_name TEXT NOT NULL UNIQUE,
  tool_type TEXT NOT NULL CHECK (tool_type IN (
    'read', 'write', 'search', 'compute', 'external_api'
  )),
  description TEXT NOT NULL,
  parameters_schema JSONB NOT NULL,
  risk_level TEXT DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  requires_approval BOOLEAN DEFAULT false,
  handler_function TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tool Executions
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  tool_id UUID NOT NULL REFERENCES tool_definitions(id),
  user_id UUID REFERENCES auth.users(id),
  input_params JSONB NOT NULL,
  output_result JSONB,
  status TEXT NOT NULL CHECK (status IN (
    'pending_approval', 'executed', 'failed'
  )),
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Safety Checks
CREATE TABLE IF NOT EXISTS safety_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id UUID REFERENCES agent_conversations(id),
  check_type TEXT NOT NULL CHECK (check_type IN (
    'pii_detection', 'toxicity', 'hallucination', 'confidence'
  )),
  passed BOOLEAN NOT NULL,
  confidence_score FLOAT,
  findings JSONB DEFAULT '{}'::jsonb,
  action TEXT CHECK (action IN ('allow', 'redact', 'block')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Model Deployments (Canary)
CREATE TABLE IF NOT EXISTS model_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  model_id UUID REFERENCES ft_models(id),
  deployment_type TEXT NOT NULL CHECK (deployment_type IN (
    'baseline', 'canary', 'production'
  )),
  traffic_percentage INTEGER CHECK (traffic_percentage BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'rolled_back', 'completed'
  )),
  total_requests INTEGER DEFAULT 0,
  avg_rating FLOAT,
  rolled_back BOOLEAN DEFAULT false,
  rollback_reason TEXT,
  deployed_at TIMESTAMPTZ DEFAULT now()
);

-- Cost Budgets
CREATE TABLE IF NOT EXISTS cost_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  max_total_tokens BIGINT,
  max_cost_usd DECIMAL(10,2),
  used_total_tokens BIGINT DEFAULT 0,
  used_cost_usd DECIMAL(10,2) DEFAULT 0.00,
  enforce_hard_limit BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enhance chunks for BM25
ALTER TABLE knowledge_base_chunks 
ADD COLUMN IF NOT EXISTS tsv tsvector 
GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_tsv 
ON knowledge_base_chunks USING gin(tsv);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sources_tenant ON data_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_entities_tenant ON graph_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_execs_tenant ON tool_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant ON model_deployments(tenant_id);

-- Enable RLS
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_budgets ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins manage sources" ON data_sources FOR ALL TO authenticated
USING (tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'tenant_admin')));

CREATE POLICY "Users view tools" ON tool_definitions FOR SELECT TO authenticated
USING (tenant_id IS NULL OR tenant_id IN (SELECT id FROM user_profiles WHERE id = auth.uid()));

CREATE POLICY "Users own executions" ON tool_executions FOR ALL TO authenticated
USING (user_id = auth.uid());

-- Hybrid Search Function
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text TEXT,
  query_embedding vector(1536),
  target_tenant_id UUID,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  hybrid_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.content,
    (
      (1 - (e.embedding <=> query_embedding)) * 0.7 +
      ts_rank(c.tsv, plainto_tsquery('english', query_text)) * 0.3
    ) AS score
  FROM knowledge_base_chunks c
  JOIN embeddings e ON e.chunk_id = c.id
  WHERE c.tenant_id = target_tenant_id
  ORDER BY score DESC
  LIMIT match_count;
END;
$$;

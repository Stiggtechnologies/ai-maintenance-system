/*
  # RAG Training & Fine-Tuning System (Microsoft-style)

  1. Extensions
    - Enable `vector` extension for embeddings (pgvector)
    - Enable `pg_trgm` for fuzzy text search

  2. New Tables
    - `knowledge_base_documents` - Source documents for RAG
    - `knowledge_base_chunks` - Document chunks with embeddings
    - `agent_conversations` - Conversation history for fine-tuning
    - `agent_feedback` - User feedback on agent responses
    - `fine_tuning_datasets` - Curated training datasets
    - `model_evaluations` - Model performance metrics
    - `rag_search_logs` - Track retrieval performance

  3. Features
    - Vector similarity search (cosine distance)
    - Automatic chunking metadata
    - Feedback loop for continuous improvement
    - A/B testing support
    - Performance analytics

  4. Security
    - RLS enabled on all tables
    - Tenant isolation
    - Role-based access control
*/

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Knowledge Base Documents (source material)
CREATE TABLE IF NOT EXISTS knowledge_base_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN (
    'manual', 'procedure', 'policy', 'standard', 
    'technical_spec', 'training_material', 'faq',
    'incident_report', 'best_practice'
  )),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  file_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Categorization
  category TEXT,
  tags TEXT[],
  iso_55000_category TEXT,
  
  -- Versioning
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  
  -- Processing status
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN (
    'pending', 'chunking', 'embedding', 'completed', 'failed'
  )),
  chunk_count INTEGER DEFAULT 0,
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Document Chunks with Embeddings
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  
  -- Chunk data
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  
  -- Embeddings (1536 dimensions for OpenAI ada-002)
  embedding vector(1536),
  
  -- Context
  chunk_metadata JSONB DEFAULT '{}'::jsonb,
  previous_chunk_id UUID REFERENCES knowledge_base_chunks(id),
  next_chunk_id UUID REFERENCES knowledge_base_chunks(id),
  
  -- Usage tracking
  retrieval_count INTEGER DEFAULT 0,
  last_retrieved_at TIMESTAMPTZ,
  avg_relevance_score FLOAT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent Conversations (for fine-tuning)
CREATE TABLE IF NOT EXISTS agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  session_id UUID NOT NULL,
  
  -- Conversation data
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- Context
  agent_type TEXT NOT NULL CHECK (agent_type IN (
    'executive', 'strategic', 'tactical', 'operational', 'general'
  )),
  intent_detected TEXT,
  entities_extracted JSONB DEFAULT '[]'::jsonb,
  
  -- RAG context used
  retrieved_chunks UUID[],
  retrieval_scores FLOAT[],
  
  -- Model info
  model_used TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  
  -- Response quality
  response_time_ms INTEGER,
  confidence_score FLOAT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent Feedback (RLHF - Reinforcement Learning from Human Feedback)
CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  
  -- Feedback type
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'thumbs_up', 'thumbs_down', 'rating', 'correction', 'flag'
  )),
  
  -- Rating (1-5 stars)
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  
  -- Detailed feedback
  feedback_text TEXT,
  corrected_response TEXT,
  
  -- Issue categorization
  issue_category TEXT CHECK (issue_category IN (
    'accuracy', 'relevance', 'tone', 'completeness', 
    'hallucination', 'safety', 'other'
  )),
  
  -- Impact
  was_helpful BOOLEAN,
  resolved_issue BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fine-Tuning Datasets (curated training data)
CREATE TABLE IF NOT EXISTS fine_tuning_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Dataset info
  dataset_name TEXT NOT NULL,
  dataset_type TEXT NOT NULL CHECK (dataset_type IN (
    'conversation', 'instruction', 'classification', 'summarization'
  )),
  
  -- Training data
  system_prompt TEXT,
  user_message TEXT NOT NULL,
  assistant_message TEXT NOT NULL,
  
  -- Metadata
  source TEXT CHECK (source IN ('manual', 'conversation', 'synthetic', 'expert')),
  quality_score FLOAT CHECK (quality_score BETWEEN 0 AND 1),
  verified_by UUID REFERENCES auth.users(id),
  
  -- Usage
  used_in_training BOOLEAN DEFAULT false,
  training_run_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Model Evaluations (track performance)
CREATE TABLE IF NOT EXISTS model_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Evaluation info
  evaluation_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN (
    'accuracy', 'relevance', 'safety', 'speed', 'cost', 'user_satisfaction'
  )),
  
  -- Metrics
  metric_name TEXT NOT NULL,
  metric_value FLOAT NOT NULL,
  baseline_value FLOAT,
  improvement_pct FLOAT,
  
  -- Test data
  test_set_size INTEGER,
  test_set_description TEXT,
  
  -- Results
  passed BOOLEAN,
  notes TEXT,
  
  evaluated_at TIMESTAMPTZ DEFAULT now(),
  evaluated_by UUID REFERENCES auth.users(id)
);

-- RAG Search Logs (retrieval performance)
CREATE TABLE IF NOT EXISTS rag_search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  
  -- Query info
  query_text TEXT NOT NULL,
  query_embedding vector(1536),
  
  -- Retrieval results
  retrieved_chunk_ids UUID[],
  similarity_scores FLOAT[],
  retrieval_method TEXT CHECK (retrieval_method IN (
    'cosine', 'euclidean', 'hybrid', 'keyword'
  )),
  
  -- Performance
  retrieval_time_ms INTEGER,
  num_results INTEGER,
  
  -- Quality metrics
  user_clicked_result BOOLEAN,
  clicked_rank INTEGER,
  result_was_helpful BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance

-- Vector similarity search (HNSW for fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding 
ON knowledge_base_chunks 
USING hnsw (embedding vector_cosine_ops);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm 
ON knowledge_base_chunks 
USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_documents_content_trgm 
ON knowledge_base_documents 
USING gin (content gin_trgm_ops);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_chunks_document 
ON knowledge_base_chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_chunks_tenant 
ON knowledge_base_chunks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversations_session 
ON agent_conversations(session_id);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant 
ON agent_conversations(tenant_id);

CREATE INDEX IF NOT EXISTS idx_feedback_conversation 
ON agent_feedback(conversation_id);

CREATE INDEX IF NOT EXISTS idx_datasets_tenant 
ON fine_tuning_datasets(tenant_id);

CREATE INDEX IF NOT EXISTS idx_search_logs_tenant 
ON rag_search_logs(tenant_id);

-- GIN indexes for JSONB
CREATE INDEX IF NOT EXISTS idx_documents_metadata 
ON knowledge_base_documents USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_chunks_metadata 
ON knowledge_base_chunks USING gin (chunk_metadata);

-- Enable Row Level Security
ALTER TABLE knowledge_base_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE fine_tuning_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_search_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Documents: Users can view documents in their tenant
CREATE POLICY "Users can view tenant documents"
  ON knowledge_base_documents FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage documents"
  ON knowledge_base_documents FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'tenant_admin')
    )
  );

-- Chunks: Same as documents
CREATE POLICY "Users can view tenant chunks"
  ON knowledge_base_chunks FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles WHERE id = auth.uid()
    )
  );

-- Conversations: Users see their own conversations
CREATE POLICY "Users can view own conversations"
  ON agent_conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create conversations"
  ON agent_conversations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Feedback: Users can give feedback on their conversations
CREATE POLICY "Users can create feedback"
  ON agent_feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own feedback"
  ON agent_feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Datasets: Admins only
CREATE POLICY "Admins can manage datasets"
  ON fine_tuning_datasets FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'tenant_admin')
    )
  );

-- Evaluations: Admins can view
CREATE POLICY "Admins can view evaluations"
  ON model_evaluations FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'tenant_admin')
    )
  );

-- Search logs: Users see their own
CREATE POLICY "Users can view own search logs"
  ON rag_search_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Helper Functions

-- Function: Semantic search with hybrid scoring
CREATE OR REPLACE FUNCTION search_knowledge_base(
  query_embedding vector(1536),
  query_text TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10,
  target_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT,
  document_title TEXT,
  document_type TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS chunk_id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity,
    d.title AS document_title,
    d.document_type
  FROM knowledge_base_chunks c
  JOIN knowledge_base_documents d ON d.id = c.document_id
  WHERE 
    (target_tenant_id IS NULL OR c.tenant_id = target_tenant_id)
    AND d.is_active = true
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function: Update chunk retrieval stats
CREATE OR REPLACE FUNCTION update_chunk_retrieval_stats(
  chunk_id UUID,
  relevance_score FLOAT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE knowledge_base_chunks
  SET 
    retrieval_count = retrieval_count + 1,
    last_retrieved_at = now(),
    avg_relevance_score = COALESCE(
      (avg_relevance_score * retrieval_count + relevance_score) / (retrieval_count + 1),
      relevance_score
    )
  WHERE id = chunk_id;
END;
$$;

-- Function: Get conversation context for fine-tuning
CREATE OR REPLACE FUNCTION get_fine_tuning_pairs(
  min_rating INTEGER DEFAULT 4,
  limit_count INTEGER DEFAULT 1000
)
RETURNS TABLE (
  system_prompt TEXT,
  user_message TEXT,
  assistant_message TEXT,
  quality_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    'You are an AI assistant for asset management following ISO 55000 standards.' AS system_prompt,
    c_user.content AS user_message,
    c_assistant.content AS assistant_message,
    (f.rating::FLOAT / 5.0) AS quality_score
  FROM agent_conversations c_user
  JOIN agent_conversations c_assistant 
    ON c_assistant.session_id = c_user.session_id
    AND c_assistant.created_at > c_user.created_at
    AND c_assistant.role = 'assistant'
  JOIN agent_feedback f 
    ON f.conversation_id = c_assistant.id
  WHERE 
    c_user.role = 'user'
    AND f.rating >= min_rating
    AND f.feedback_type = 'rating'
  ORDER BY f.created_at DESC
  LIMIT limit_count;
END;
$$;

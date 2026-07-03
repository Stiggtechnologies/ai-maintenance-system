/*
  # Fine-Tuning Models Table
  
  Tracks fine-tuned model artifacts and deployment status
*/

CREATE TABLE IF NOT EXISTS ft_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  
  -- Model info
  model_name TEXT NOT NULL,
  model_ref TEXT NOT NULL,  -- Provider model ID or URI
  base_model TEXT,
  fine_tuning_method TEXT CHECK (fine_tuning_method IN ('lora', 'rft', 'instruction', 'full')),
  
  -- Training info
  dataset_id UUID REFERENCES fine_tuning_datasets(id),
  training_examples_count INTEGER,
  training_completed_at TIMESTAMPTZ,
  
  -- Evaluation
  eval_summary JSONB DEFAULT '{}'::jsonb,
  
  -- Deployment
  deployed BOOLEAN DEFAULT FALSE,
  canary_pct INTEGER DEFAULT 0 CHECK (canary_pct BETWEEN 0 AND 100),
  
  -- Metadata
  notes TEXT,
  tags TEXT[],
  
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ft_models_tenant ON ft_models(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ft_models_deployed ON ft_models(deployed);

ALTER TABLE ft_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ft models"
  ON ft_models FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT id FROM user_profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'tenant_admin')
    )
  );

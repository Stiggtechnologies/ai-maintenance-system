/*
  # Evidence Tracking and Approval Escalation

  1. New Tables
    - `evidence_repository` - Evidence storage for RCA and decisions
    - `evidence_references` - Links between decisions/artifacts and evidence
    - `approval_escalation_chains` - Escalation paths for approvals
    - `approval_escalation_history` - Track escalation events

  2. Security
    - Enable RLS on all tables
    - Users can view evidence for their decisions

  3. Features
    - Evidence linking to decisions
    - Citation tracking
    - Approval escalation with timeout
*/

CREATE TABLE IF NOT EXISTS evidence_repository (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_type text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  title text NOT NULL,
  description text,
  evidence_data jsonb NOT NULL,
  file_urls text[],
  tags text[],
  reliability_score integer DEFAULT 100,
  collected_at timestamptz DEFAULT now(),
  collected_by uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS evidence_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES evidence_repository(id) ON DELETE CASCADE,
  referenced_by_type text NOT NULL,
  referenced_by_id uuid NOT NULL,
  reference_context text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_escalation_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_name text NOT NULL,
  approval_type text NOT NULL,
  escalation_levels jsonb NOT NULL,
  timeout_minutes integer DEFAULT 240,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_escalation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_workflow_id uuid REFERENCES approval_workflows(id) ON DELETE CASCADE,
  escalation_chain_id uuid REFERENCES approval_escalation_chains(id),
  from_level integer,
  to_level integer,
  escalation_reason text NOT NULL,
  escalated_at timestamptz DEFAULT now(),
  escalated_by uuid REFERENCES auth.users(id),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_evidence_repo_type ON evidence_repository(evidence_type);
CREATE INDEX IF NOT EXISTS idx_evidence_repo_source ON evidence_repository(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_evidence_repo_collected ON evidence_repository(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_refs_evidence ON evidence_references(evidence_id);
CREATE INDEX IF NOT EXISTS idx_evidence_refs_reference ON evidence_references(referenced_by_type, referenced_by_id);
CREATE INDEX IF NOT EXISTS idx_escalation_chains_type ON approval_escalation_chains(approval_type) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_escalation_history_workflow ON approval_escalation_history(approval_workflow_id);

ALTER TABLE evidence_repository ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_escalation_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_escalation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view evidence"
  ON evidence_repository FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create evidence"
  ON evidence_repository FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = collected_by);

CREATE POLICY "Users can view evidence references"
  ON evidence_references FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can create evidence references"
  ON evidence_references FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can manage escalation chains"
  ON approval_escalation_chains FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can view escalation chains"
  ON approval_escalation_chains FOR SELECT
  TO authenticated
  USING (enabled = true);

CREATE POLICY "Users can view escalation history"
  ON approval_escalation_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can log escalations"
  ON approval_escalation_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION link_evidence_to_decision(
  p_evidence_id uuid,
  p_decision_id uuid,
  p_context text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reference_id uuid;
BEGIN
  INSERT INTO evidence_references (
    evidence_id,
    referenced_by_type,
    referenced_by_id,
    reference_context
  ) VALUES (
    p_evidence_id,
    'autonomous_decision',
    p_decision_id,
    p_context
  )
  RETURNING id INTO v_reference_id;

  RETURN v_reference_id;
END;
$$;

CREATE OR REPLACE FUNCTION escalate_approval(
  p_approval_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_workflow record;
  v_chain record;
  v_next_level integer;
  v_next_approvers uuid[];
BEGIN
  SELECT * INTO v_workflow
  FROM approval_workflows
  WHERE id = p_approval_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Approval workflow not found');
  END IF;

  SELECT * INTO v_chain
  FROM approval_escalation_chains
  WHERE approval_type = v_workflow.approval_type
  AND enabled = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No escalation chain configured');
  END IF;

  v_next_level := COALESCE(
    (SELECT MAX((value->>'level')::integer) + 1
     FROM jsonb_array_elements(v_chain.escalation_levels)),
    1
  );

  INSERT INTO approval_escalation_history (
    approval_workflow_id,
    escalation_chain_id,
    from_level,
    to_level,
    escalation_reason,
    escalated_by
  ) VALUES (
    p_approval_id,
    v_chain.id,
    0,
    v_next_level,
    p_reason,
    auth.uid()
  );

  UPDATE approval_workflows
  SET
    escalated = true,
    escalation_level = v_next_level
  WHERE id = p_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'escalated_to_level', v_next_level,
    'chain_name', v_chain.chain_name
  );
END;
$$;

INSERT INTO approval_escalation_chains (chain_name, approval_type, escalation_levels, timeout_minutes)
VALUES
(
  'Standard Escalation',
  'autonomous_action',
  '[
    {"level": 1, "roles": ["manager"], "timeout_minutes": 60},
    {"level": 2, "roles": ["admin", "site_admin"], "timeout_minutes": 120},
    {"level": 3, "roles": ["super_admin"], "timeout_minutes": 240}
  ]'::jsonb,
  240
),
(
  'Critical Incident Escalation',
  'critical_action',
  '[
    {"level": 1, "roles": ["ops_manager"], "timeout_minutes": 15},
    {"level": 2, "roles": ["site_admin", "admin"], "timeout_minutes": 30},
    {"level": 3, "roles": ["super_admin"], "timeout_minutes": 60}
  ]'::jsonb,
  60
)
ON CONFLICT DO NOTHING;
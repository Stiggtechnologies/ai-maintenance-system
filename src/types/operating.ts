/**
 * Row types for the SyncAI operating-loop tables (see
 * supabase/migrations/00000000000001_operating_loop_baseline.sql).
 * These mirror the database columns and back the typed service layer.
 */

export interface AssetRow {
  id: string;
  organization_id: string;
  site_id: string | null;
  tag: string | null;
  name: string;
  asset_class: string | null;
  criticality: string;
  status: string;
  health_score: number;
  risk_score: number;
  area: string | null;
  system: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installed_date: string | null;
  created_at: string;
}

export interface AgentRow {
  id: string;
  organization_id: string;
  key: string | null;
  name: string;
  category: string | null;
  status: string;
  autonomy_mode: string;
  current_task: string | null;
  recommendations_generated: number;
  actions_executed: number;
  approvals_pending: number;
  confidence: number;
  supervisor: string | null;
  last_action: string | null;
  last_action_at: string | null;
  created_at: string;
}

export interface RecommendationRow {
  id: string;
  organization_id: string;
  asset_id: string | null;
  agent_id: string | null;
  title: string;
  issue: string | null;
  action: string | null;
  impact: string | null;
  confidence: number;
  urgency: string;
  status: string;
  approval_required: string | null;
  accountable: string | null;
  responsible: string | null;
  consulted: string | null;
  informed: string | null;
  financial_impact: string | null;
  risk_impact: string;
  rationale: string | null;
  created_at: string;
  updated_at: string;
  // joined
  asset?: Pick<AssetRow, "id" | "name" | "tag" | "criticality"> | null;
  agent?: Pick<AgentRow, "id" | "name"> | null;
}

export interface EvidenceItemRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  asset_id: string | null;
  source_system: string | null;
  evidence_type: string | null;
  description: string | null;
  confidence_contribution: number;
  data_quality: string;
  related_asset: string | null;
  ts: string;
  created_at: string;
}

export interface ScenarioRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  asset_id: string | null;
  key: string;
  label: string;
  cost: number;
  downtime_impact: string | null;
  production_impact: string | null;
  safety_risk: string | null;
  environmental_risk: string | null;
  financial_exposure: string | null;
  mission_readiness_impact: string | null;
  recommended: boolean;
  created_at: string;
}

export interface WorkOrderRow {
  id: string;
  organization_id: string;
  asset_id: string | null;
  recommendation_id: string | null;
  wo_number: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  type: string;
  assignee: string | null;
  scheduled_date: string | null;
  estimated_hours: number;
  parts_ready: boolean;
  risk_score: number;
  financial_exposure: string | null;
  production_impact: string;
  safety_flag: boolean;
  approval_required: boolean;
  created_at: string;
  asset?: Pick<AssetRow, "id" | "name" | "area"> | null;
}

export interface ApprovalRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  work_order_id: string | null;
  status: string;
  owner_role: string | null;
  approver: string | null;
  reason: string | null;
  consequence_of_wrong: string | null;
  required_validation: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface DecisionRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  agent_id: string | null;
  asset_id: string | null;
  decision_type: string | null;
  action_taken: string | null;
  approval_status: string;
  autonomy_mode: string;
  confidence_score: number;
  human_actor: string | null;
  rationale: string | null;
  outcome_status: string;
  created_at: string;
  asset?: Pick<AssetRow, "id" | "name"> | null;
  agent?: Pick<AgentRow, "id" | "name"> | null;
}

export interface ValueMetricRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  asset_id: string | null;
  metric_type: string;
  label: string | null;
  value: number;
  unit: string | null;
  status: string;
  period: string | null;
  created_at: string;
}

export interface LearningEventRow {
  id: string;
  organization_id: string;
  recommendation_id: string | null;
  asset_id: string | null;
  event_type: string;
  title: string | null;
  detail: string | null;
  expected_value: number | null;
  verified_value: number | null;
  model_confidence: number | null;
  created_at: string;
}

export interface CoworkWorkspaceRow {
  id: string;
  organization_id: string;
  asset_id: string | null;
  title: string;
  objective: string | null;
  status: string;
  agents: string[];
  progress: number;
  artifacts: number;
  next_action: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoworkMessageRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  agent: string | null;
  role: string;
  message: string | null;
  confidence: number | null;
  created_at: string;
}

export interface ArtifactRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  recommendation_id: string | null;
  asset_id: string | null;
  type: string | null;
  title: string | null;
  content: string | null;
  created_at: string;
}

export interface IntegrationRow {
  id: string;
  organization_id: string;
  name: string;
  category: string | null;
  status: string;
  last_sync: string | null;
  records_synced: number;
  created_at: string;
}

export type AppRole =
  | "executive"
  | "maintenance_manager"
  | "reliability_engineer"
  | "planner"
  | "technician"
  | "ai_admin";

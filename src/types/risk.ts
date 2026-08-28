import type {
  AnalysisLevel,
  RiskDecision,
  RiskKind,
  RiskLevel,
  TreatmentStrategy,
} from "../lib/risk-operating-system";

export interface RiskEvidence {
  id: string;
  source: string | null;
  type: string | null;
  description: string | null;
  quality: string | null;
  observed_at: string | null;
}

export interface RiskControl {
  id: string;
  name: string;
  type: string;
  owner: string | null;
  effectiveness: "unknown" | "effective" | "partial" | "weak" | "ineffective";
  score: number | null;
  trend: "unknown" | "improving" | "stable" | "declining";
  next_test_due: string | null;
}

export interface RiskIndicator {
  id: string;
  name: string;
  source: string;
  unit: string | null;
  value: number | null;
  state: "unknown" | "normal" | "warning" | "critical";
  observed_at: string | null;
  thresholds: Record<string, unknown>;
}

export interface RiskStakeholderView {
  id: string;
  stakeholder: string;
  role: string | null;
  kind: string;
  likelihood: number | null;
  consequence: number | null;
  concern: string | null;
  rationale: string;
  status: string;
}

export interface RiskTreatment {
  id: string;
  label: string;
  strategy: TreatmentStrategy;
  cost: number;
  downtime: string | null;
  residual_risk: number | null;
  introduced_risks: Array<string | Record<string, unknown>>;
  net_risk_change: number | null;
  confidence: number | null;
  asset_life_impact: string | null;
  objective_tradeoffs: Record<string, string>;
  executable: boolean;
  readiness_gaps: string[];
  selected: boolean;
}

export interface PendingRiskDecision {
  id: string;
  action: RiskDecision;
  rationale: string;
  created_at: string;
  approval_id: string;
  required_role: string;
  status: string;
}

export interface RiskLink {
  id: string;
  direction: "inbound" | "outbound";
  related_risk_id: string;
  relationship: string;
  dependency_key: string | null;
  strength: number | null;
  rationale: string;
}

export interface RiskAcceptance {
  id: string;
  level: RiskLevel;
  accepted_role: string;
  expires_at: string;
  review_at: string | null;
  reassessment_trigger: string;
}

export interface RiskRecord {
  id: string;
  title: string;
  kind: RiskKind;
  objective: string | null;
  risk_source: string | null;
  event: string | null;
  causes: string[];
  consequences: Record<string, unknown>;
  likelihood: number | null;
  analysis_level: AnalysisLevel | null;
  analysis_method: string | null;
  control_effectiveness: number | null;
  uncertainty: number | null;
  confidence: number | null;
  complexity: number | null;
  connectivity: number | null;
  exposure: number | null;
  capacity_load: number | null;
  velocity: number | null;
  time_to_unacceptable: string | null;
  inherent_risk_score: number | null;
  current_risk_score: number | null;
  residual_risk_score: number | null;
  target_risk_score: number | null;
  opportunity_score: number | null;
  value_at_risk: number | null;
  value_currency: string;
  current_risk_level: RiskLevel | null;
  residual_risk_level: RiskLevel | null;
  target_risk_level: RiskLevel | null;
  decision_action: RiskDecision | null;
  status: string;
  review_date: string | null;
  escalation_threshold: string | null;
  data_quality: string | null;
  assumptions: string[];
  biases: string[];
  bias_review_complete: boolean;
  method_limitations: string[];
  value_of_information: Record<string, unknown>;
  reporting_profile: {
    audiences?: string[];
    frequency?: string;
    method?: string;
    timeliness?: string;
    cost_limit?: number;
  };
  context: { id: string; name: string; kind: string } | null;
  site: { id: string; name: string } | null;
  asset: { id: string; name: string; tag: string | null } | null;
  risk_owner: { id: string; name: string | null; role: string | null } | null;
  decision_owner: {
    id: string;
    name: string | null;
    role: string | null;
  } | null;
  evidence: RiskEvidence[];
  controls: RiskControl[];
  indicators: RiskIndicator[];
  stakeholder_views: RiskStakeholderView[];
  treatments: RiskTreatment[];
  acceptance: RiskAcceptance | null;
  pending_decisions: PendingRiskDecision[];
  links: RiskLink[];
}

export interface RiskContextNode {
  id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  mission: string | null;
  objectives: string[];
  stakeholders: string[];
  regulations: string[];
  financial_constraints: string[];
  safety_requirements: string[];
  environmental_obligations: string[];
  operating_limits: string[];
  policies: string[];
  dependencies: string[];
  authority: Record<string, unknown>;
  status: string;
  review_date: string | null;
}

export interface RiskImplementationRoadmapStep {
  phase: string;
  status: "ready" | "draft" | "blocked";
  output: string;
}

export interface RiskImplementationState {
  context_id: string;
  context_name: string;
  status: string;
  discovery: {
    industry_code?: string;
    industry_label?: string;
    industry_pack_readiness?: string;
    industry_pack_validation?: string;
    industry_focus_source?: string;
    [key: string]: unknown;
  };
  gap_assessment: {
    status: "preliminary";
    evidence_basis: string;
    maturity_score: null;
    gaps: Array<{
      area: string;
      status:
        | "gap"
        | "unassessed"
        | "unverified"
        | "validation_required"
        | "execution_gap";
      finding: string;
    }>;
    human_review_required: true;
  };
  roadmap: RiskImplementationRoadmapStep[];
  created_at: string;
  updated_at: string;
}

export interface RiskPortfolioBreakdown {
  value_at_risk_by_currency: Array<{
    currency: string;
    value_at_risk: number;
  }>;
  risk_reduction_achieved: number;
  accepted_risks: number;
  by_site: Array<{ site: string; risks: number; exposure: number }>;
  by_objective: Array<{
    objective: string | null;
    risks: number;
    exposure: number;
  }>;
}

export interface RiskAuthorityProfile {
  id: string;
  role: string;
  tier: string;
  max_risk_level: RiskLevel | null;
  max_exposure: number | null;
  risk_kinds: RiskKind[];
  required_competencies: string[];
  escalates_to_role: string | null;
  status: string;
  version: number;
  basis: string;
}

export interface RiskCriteriaProfile {
  id: string;
  context_id: string | null;
  name: string;
  industry_code: string | null;
  jurisdiction: string | null;
  version: number;
  status: "draft" | "adopted" | "superseded";
  dimensions: Array<Record<string, unknown> | string>;
  likelihood_scale: Array<Record<string, unknown> | number>;
  thresholds: Record<string, number>;
  decision_thresholds: Record<string, unknown>;
  capacity: Record<string, unknown>;
  basis: string;
  review_date: string | null;
}

export interface RiskMaturity {
  id: string;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  principles: Record<string, number>;
  framework: Record<string, number>;
  process: Record<string, number>;
  gaps: string[];
  roadmap: Array<Record<string, unknown> | string>;
  evidence_summary: string;
  assessed_at: string;
  next_review: string | null;
}

export interface RiskFrameworkReview {
  id: string;
  trigger_type: string;
  detail: string;
  material: boolean;
  criteria_review_required: boolean;
  framework_suitable: boolean | null;
  framework_effective: boolean | null;
  findings: string[];
  actions: string[];
  status: string;
  due_date: string | null;
}

export interface AggregateExposure {
  individual_exposure: number;
  combined_exposure: number;
  open_risks: number;
  connections: number;
  common_dependencies: Array<{ dependency_key: string; risks: number }>;
  capacity_limit: number;
  committed_capacity: number;
  capacity_remaining: number;
  within_capacity: boolean;
  basis: string;
}

export interface RiskEffectiveness {
  effectiveness_index: number | null;
  risks_realized_despite_controls: number;
  overdue_treatments: number;
  repeated_control_failures: number;
  overdue_risk_reviews: number;
  decisions_overturned_or_treatments_failed: number;
  accepted_risks_above_acceptance: number;
  treatments_verified: number;
  treatments_verified_effective: number;
  treatment_effectiveness_rate: number | null;
  significant_decisions_total: number;
  significant_decisions_with_risk_assessment: number;
  emerging_risks_detected: number;
  average_decision_cycle_hours: number | null;
  average_risk_to_action_cycle_hours: number | null;
  basis: string;
}

export interface RiskCockpit {
  generated_at: string;
  risks: RiskRecord[];
  contexts: RiskContextNode[];
  criteria: RiskCriteriaProfile[];
  maturity: RiskMaturity | null;
  framework_reviews: RiskFrameworkReview[];
  aggregate: AggregateExposure;
  effectiveness: RiskEffectiveness;
  portfolio_breakdown: RiskPortfolioBreakdown;
  authority_profiles: RiskAuthorityProfile[];
  positioning: string;
}

export interface RiskParticipant {
  id: string;
  full_name: string | null;
  role: string | null;
}

export interface RiskAssessmentDraft {
  title: string;
  kind: RiskKind;
  context_id: string;
  criteria_profile_id: string;
  site_id?: string;
  asset_id?: string;
  /** Spec §2 (D11.16): a risk always links to an ADOPTED objective. */
  objective_id: string;
  objective_at_risk: string;
  risk_source: string;
  event_description: string;
  causes: string[];
  consequences: Record<string, number>;
  likelihood: number;
  existing_controls_summary: string;
  analysis_level: AnalysisLevel;
  analysis_method: string;
  analysis_model_reference?: string;
  control_effectiveness: number;
  uncertainty: number;
  confidence: number;
  complexity: number;
  connectivity: number;
  exposure: number;
  capacity_load: number;
  risk_velocity: number;
  risk_owner_id: string;
  decision_owner_id: string;
  stakeholders: string[];
  scope_decision: string;
  scope_expected_outcome: string;
  scope_inclusions: string[];
  scope_exclusions: string[];
  time_horizon: string;
  location_scope: string;
  resource_scope: string[];
  responsibility_scope: string[];
  relationship_scope: string[];
  assumptions: string[];
  biases: string[];
  bias_review_complete: boolean;
  method_limitations: string[];
  data_quality: string;
  value_at_risk?: number;
  value_currency: string;
  reporting_profile: {
    audiences: string[];
    frequency: string;
    method: string;
    timeliness: string;
    cost_limit: number;
  };
  information_sensitivity:
    "public" | "internal" | "confidential" | "restricted";
  status: "draft" | "identified";
}

export interface RiskObjectiveRecord {
  id: string;
  supersedes_id: string | null;
  parent_id: string | null;
  context_id: string | null;
  owner_id: string | null;
  objective_level: string;
  description: string;
  target: string;
  measurement: string;
  timeframe: string;
  tolerance: string;
  status: string;
  version: number;
  review_date: string | null;
  /** Spec §2 typed target fields (D11.15) — null renders "not stated". */
  target_value?: number | null;
  unit?: string | null;
  target_date?: string | null;
}

export interface RiskObligationRecord {
  id: string;
  supersedes_id: string | null;
  context_id: string | null;
  source_type: string;
  source_reference: string;
  jurisdiction: string | null;
  applicable_scope: string;
  responsible_role: string;
  requirement: string;
  effective_date: string | null;
  expiry_date: string | null;
  status: string;
  version: number;
}

export interface RiskAssumptionRecord {
  id: string;
  risk_id: string;
  statement: string;
  owner_id: string;
  confidence: number;
  valid_until: string | null;
  trigger_for_review: string;
  status: string;
}

export interface EnterpriseRiskArchitecture {
  objectives: RiskObjectiveRecord[];
  stakeholders: Array<Record<string, unknown> & { id: string; name: string }>;
  obligations: RiskObligationRecord[];
  assumptions: RiskAssumptionRecord[];
  sources: Array<Record<string, unknown> & { id: string; risk_id: string }>;
  consequences: Array<
    Record<string, unknown> & { id: string; risk_id: string }
  >;
  likelihood_estimates: Array<
    Record<string, unknown> & { id: string; risk_id: string; method: string }
  >;
  event_scenarios: Array<
    Record<string, unknown> & { id: string; name: string; status: string }
  >;
  stress_tests: Array<
    Record<string, unknown> & {
      id: string;
      name: string;
      mode: string;
      combined_exposure: number;
      threshold_breached: boolean;
    }
  >;
  treatment_dependencies: Array<Record<string, unknown> & { id: string }>;
  challenges: Array<
    Record<string, unknown> & {
      id: string;
      risk_id: string;
      challenged_field: string;
      status: string;
    }
  >;
  assurance_reviews: Array<
    Record<string, unknown> & {
      id: string;
      assurance_level: string;
      status: string;
    }
  >;
  communications: Array<Record<string, unknown> & { id: string }>;
  learning_transfers: Array<
    Record<string, unknown> & { id: string; status: string }
  >;
  reassessment_queue: Array<{
    risk_id: string;
    title: string;
    reason: string;
    status: string;
  }>;
  expiring_controls: Array<{
    control_id: string;
    name: string;
    lifecycle_kind: string;
    expires_on: string;
    sunset_action: string;
  }>;
  learning_events?: Array<
    Record<string, unknown> & { id: string; title: string | null }
  >;
  integrations?: Array<
    Record<string, unknown> & { id: string; name: string; status: string }
  >;
  agents?: Array<Record<string, unknown> & { id: string; name: string }>;
}

export interface RiskDecisionOperations {
  my_decisions: Array<
    Record<string, unknown> & {
      decision_id: string;
      risk_id: string;
      risk_title: string;
      action: string;
      approval_status: string;
    }
  >;
  treatment_portfolio: Array<
    Record<string, unknown> & {
      recommendation_id: string;
      risk_id: string;
      risk_title: string;
      action: string;
      status: string;
    }
  >;
  emerging_risks: Array<
    Record<string, unknown> & {
      risk_id: string;
      title: string;
      score: number | null;
      velocity: number | null;
    }
  >;
  decision_history: Array<
    Record<string, unknown> & {
      decision_id: string;
      risk_id: string;
      risk_title: string;
      status: string;
    }
  >;
  board_evidence_pack: Record<string, number>;
  culture_signals: Array<{
    key: string;
    rate: number | null;
    count: number;
    evidence_only: boolean;
  }>;
}

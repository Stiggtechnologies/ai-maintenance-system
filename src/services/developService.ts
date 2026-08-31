/**
 * Sync Develop service — Slice 1 (D1.04/D1.05, D3.24/D3.06, D3.25).
 *
 * Every write goes through an org-scoped SECURITY DEFINER RPC; this module
 * never writes a table directly. Reads ride RLS (development_cases,
 * project_frameworks are SELECT-only to authenticated) or the
 * get_development_case aggregate. RPC results carry {error} on refusal —
 * unwrapped here into thrown Errors so pages surface the SERVER's refusal
 * text, never a client guess.
 */
import { supabase } from "../lib/supabase";
import type {
  CaseWorkspace,
  GateReadinessResult,
  OperationalReadinessResult,
} from "../lib/develop";
import type { CaseChains } from "../lib/develop/chains";
import type {
  CalculationRun,
  CaseControls,
  CostReconciliation,
  ScopeGrowth,
} from "../lib/develop/controls";
import type {
  CaseEarnedValue,
  CasePerformance,
  CasePerformanceTrend,
  CaseProgressIntegrity,
  EstimateConfidence,
  ForecastConfidence,
} from "../lib/develop/performance";
import {
  DEFAULT_SIMULATION_ITERATIONS,
  type CaseRiskScheduleChain,
  type CaseScheduleQuality,
  type DurationRangeStatement,
  type SimulationInputs,
} from "../lib/develop/schedule";
import { simulateIntegratedRisk } from "../lib/modelling/integrated-risk";

export interface DevelopmentCaseSummary {
  id: string;
  title: string;
  status: string;
  lifecycle_type: string;
  current_stage_key: string | null;
  framework_id: string | null;
  estimated_capex: number | null;
  expected_value: number | null;
  problem_statement: string;
  created_at: string;
}

export interface FrameworkOption {
  id: string;
  name: string;
  version: number;
  source_authority: string;
  status: string;
}

export interface OrgMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

export interface CreateDevelopmentCaseInput {
  title: string;
  problemStatement: string;
  lifecycleType: string;
  opportunityStatement?: string | null;
  frameworkId?: string | null;
  businessUnit?: string | null;
  estimatedCapex?: number | null;
  expectedValue?: number | null;
}

export interface GateFindingInput {
  criterion_id?: number | null;
  criterion_text: string;
  status: "met" | "not_met" | "not_assessed";
  evidence?: string | null;
}

export interface GateConditionInput {
  description: string;
  owner_id: string;
  due_date: string;
  evidence_requirement: string;
  consequence_if_missed: string;
}

type RpcPayload = Record<string, unknown> | null;

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload;
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return data as T;
}

export async function listDevelopmentCases(): Promise<
  DevelopmentCaseSummary[]
> {
  const { data, error } = await supabase
    .from("development_cases")
    .select(
      "id, title, status, lifecycle_type, current_stage_key, framework_id, estimated_capex, expected_value, problem_statement, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DevelopmentCaseSummary[];
}

export async function listAdoptedFrameworks(): Promise<FrameworkOption[]> {
  const { data, error } = await supabase
    .from("project_frameworks")
    .select("id, name, version, source_authority, status")
    .eq("status", "adopted")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as FrameworkOption[];
}

export async function listOrgMembers(): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email")
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as OrgMember[];
}

export async function createDevelopmentCase(
  input: CreateDevelopmentCaseInput,
): Promise<{ case_id: string; current_stage_key: string }> {
  const { data, error } = await supabase.rpc("create_development_case", {
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_lifecycle_type: input.lifecycleType,
    p_opportunity_statement: input.opportunityStatement ?? null,
    p_framework_id: input.frameworkId ?? null,
    p_site_id: null,
    p_business_unit: input.businessUnit ?? null,
    p_estimated_capex: input.estimatedCapex ?? null,
    p_expected_value: input.expectedValue ?? null,
    p_objective_id: null,
    p_sponsor_id: null,
  });
  return unwrap(data, error);
}

export async function getDevelopmentCase(
  caseId: string,
): Promise<CaseWorkspace | null> {
  const { data, error } = await supabase.rpc("get_development_case", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  return (data as CaseWorkspace | null) ?? null;
}

export async function recordCaseGateReview(input: {
  caseId: string;
  gateId: number;
  outcome: string;
  note: string;
  findings: GateFindingInput[];
  conditions: GateConditionInput[];
  /** D3.07: the zero-based funding answer (spec I.5) — required by the DB
   *  for passing outcomes at sanction-type gates. */
  fundingAnswer?: string | null;
}): Promise<{
  review_id: number;
  outcome: string;
  waived_mandatory?: string[];
}> {
  const { data, error } = await supabase.rpc("record_case_gate_review", {
    p_case_id: input.caseId,
    p_gate_id: input.gateId,
    p_outcome: input.outcome,
    p_note: input.note,
    p_findings: input.findings,
    p_conditions: input.conditions,
    p_funding_answer: input.fundingAnswer ?? null,
  });
  return unwrap(data, error);
}

// ---------------------------------------------------------------------------
// Slice 3B: condition lifecycle (D3.18) + gate-requirement waivers (D3.19).
// Same discipline — writes are definer RPCs, refusals surface verbatim.
// ---------------------------------------------------------------------------

export async function closeGateCondition(input: {
  conditionId: number;
  evidenceId: string;
  note?: string | null;
}): Promise<{ condition_id: number; status: string; closed_late: boolean }> {
  const { data, error } = await supabase.rpc("close_gate_condition", {
    p_condition_id: input.conditionId,
    p_evidence_id: input.evidenceId,
    p_note: input.note ?? null,
  });
  return unwrap(data, error);
}

export async function requestGateRequirementWaiver(input: {
  caseId: string;
  requirementId: number;
  justification: string;
  compensatingControls: string;
  riskId: string;
  expiresAt: string;
}): Promise<{ waiver_id: string; status: string; expires_at: string }> {
  const { data, error } = await supabase.rpc(
    "request_gate_requirement_waiver",
    {
      p_case_id: input.caseId,
      p_requirement_id: input.requirementId,
      p_justification: input.justification,
      p_compensating_controls: input.compensatingControls,
      p_risk_id: input.riskId,
      p_expires_at: input.expiresAt,
    },
  );
  return unwrap(data, error);
}

export async function decideGateRequirementWaiver(input: {
  waiverId: string;
  approve: boolean;
  note: string;
}): Promise<{ waiver_id: string; status: string; expires_at: string }> {
  const { data, error } = await supabase.rpc("decide_gate_requirement_waiver", {
    p_waiver_id: input.waiverId,
    p_approve: input.approve,
    p_note: input.note,
  });
  return unwrap(data, error);
}

/**
 * D3.17/D3.34: an independent assurance review of the CASE, through the ONE
 * assurance RPC (record_risk_assurance_review — no parallel assurance
 * store). The DB refuses the case sponsor/creator as independent reviewer.
 */
export async function recordCaseAssuranceReview(input: {
  caseId: string;
  scope: string;
  conclusion:
    | "acceptable"
    | "acceptable_with_actions"
    | "not_acceptable"
    | "inconclusive";
  evidenceItemIds: string[];
}): Promise<{ review_id: string; status: string }> {
  const { data, error } = await supabase.rpc("record_risk_assurance_review", {
    p_review: {
      subject_type: "development_case",
      subject_id: input.caseId,
      assurance_level: "independent",
      scope: input.scope,
      status: "completed",
      conclusion: input.conclusion,
      evidence_item_ids: input.evidenceItemIds,
    },
  });
  return unwrap(data, error);
}

export async function advanceCaseStage(input: {
  caseId: string;
  toStageKey: string;
  reason?: string | null;
}): Promise<{ case_id: string; current_stage_key: string }> {
  const { data, error } = await supabase.rpc("advance_development_case_stage", {
    p_case_id: input.caseId,
    p_to_stage_key: input.toStageKey,
    p_reason: input.reason ?? null,
  });
  return unwrap(data, error);
}

export async function sanctionDevelopmentCase(input: {
  caseId: string;
  note: string;
  sanctionedValue?: number | null;
}): Promise<{ case_id: string; status: string; sanctioned_value: number }> {
  const { data, error } = await supabase.rpc("sanction_development_case", {
    p_case_id: input.caseId,
    p_note: input.note,
    p_sanctioned_value: input.sanctionedValue ?? null,
  });
  return unwrap(data, error);
}

// ---------------------------------------------------------------------------
// Slice 1 rows 4–8: deliverables, evidence, risks, decisions, actions.
// Same discipline as above — writes are definer RPCs, reads ride RLS, server
// refusals surface verbatim.
// ---------------------------------------------------------------------------

export interface IntakeDocumentOption {
  id: string;
  title: string;
  document_class: string;
  chunk_count: number;
  uploaded_at: string;
}

/** Documents already on the C2.15 KB intake rail — the ONE document door. */
export async function listIntakeDocuments(): Promise<IntakeDocumentOption[]> {
  const { data, error } = await supabase
    .from("kb_intake_documents")
    .select("id, title, document_class, chunk_count, uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as IntakeDocumentOption[];
}

export async function createCaseDeliverable(input: {
  caseId: string;
  title: string;
  type: string;
  ownerId: string;
  requirementId?: number | null;
  requiredDate?: string | null;
  sourceSystem?: string | null;
}): Promise<{ deliverable_id: string; status: string }> {
  const { data, error } = await supabase.rpc("create_case_deliverable", {
    p_case_id: input.caseId,
    p_title: input.title,
    p_type: input.type,
    p_owner_id: input.ownerId,
    p_requirement_id: input.requirementId ?? null,
    p_required_date: input.requiredDate ?? null,
    p_source_system: input.sourceSystem ?? null,
  });
  return unwrap(data, error);
}

export async function submitDeliverable(input: {
  deliverableId: string;
  documentId: string;
  revision?: string | null;
}): Promise<{ deliverable_id: string; status: string }> {
  const { data, error } = await supabase.rpc("submit_deliverable", {
    p_deliverable_id: input.deliverableId,
    p_document_id: input.documentId,
    p_revision: input.revision ?? null,
    p_source_system: null,
  });
  return unwrap(data, error);
}

export async function acceptDeliverable(input: {
  deliverableId: string;
  decision: "accepted" | "rejected";
  note?: string | null;
}): Promise<{ deliverable_id: string; status: string }> {
  const { data, error } = await supabase.rpc("accept_deliverable", {
    p_deliverable_id: input.deliverableId,
    p_decision: input.decision,
    p_note: input.note ?? null,
  });
  return unwrap(data, error);
}

export async function recordCaseEvidence(input: {
  caseId: string;
  evidenceClass: string;
  description: string;
  sourceSystem: string;
  sourceReference?: string | null;
  documentId?: string | null;
  revision?: string | null;
  applicability?: string | null;
  dataQuality?: string | null;
}): Promise<{ evidence_id: string; verification_status: string }> {
  const { data, error } = await supabase.rpc("record_case_evidence", {
    p_case_id: input.caseId,
    p_evidence: {
      evidence_class: input.evidenceClass,
      description: input.description,
      source_system: input.sourceSystem,
      source_reference: input.sourceReference ?? null,
      document_id: input.documentId ?? null,
      revision: input.revision ?? null,
      applicability: input.applicability ?? null,
      data_quality: input.dataQuality ?? null,
    },
  });
  return unwrap(data, error);
}

export async function verifyEvidenceItem(input: {
  evidenceId: string;
  method: string;
  outcome: "verified" | "rejected";
  note?: string | null;
}): Promise<{ evidence_id: string; verification_status: string }> {
  const { data, error } = await supabase.rpc("verify_evidence_item", {
    p_evidence_id: input.evidenceId,
    p_method: input.method,
    p_outcome: input.outcome,
    p_note: input.note ?? null,
  });
  return unwrap(data, error);
}

export interface BindableRisk {
  id: string;
  title: string;
  current_risk_level: string | null;
  status: string;
}

/** Org risks not yet bound to any case — candidates for attachment. */
export async function listBindableRisks(): Promise<BindableRisk[]> {
  const { data, error } = await supabase
    .from("risks")
    .select("id, title, current_risk_level, status")
    .is("development_case_id", null)
    .not("status", "in", "(closed,archived)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as BindableRisk[];
}

export async function bindRiskToCase(input: {
  riskId: string;
  caseId: string | null;
  reason?: string | null;
}): Promise<{ risk_id: string }> {
  const { data, error } = await supabase.rpc("bind_risk_to_development_case", {
    p_risk_id: input.riskId,
    p_case_id: input.caseId,
    p_reason: input.reason ?? null,
  });
  return unwrap(data, error);
}

export async function createCaseDecision(input: {
  caseId: string;
  question: string;
  requiredDate?: string | null;
  approvalLevel?: string | null;
}): Promise<{ decision_id: string }> {
  const { data, error } = await supabase.rpc("create_case_decision", {
    p_case_id: input.caseId,
    p_question: input.question,
    p_required_date: input.requiredDate ?? null,
    p_objective_id: null,
    p_owner_id: null,
    p_approval_level: input.approvalLevel ?? null,
  });
  return unwrap(data, error);
}

export interface DecisionOptionInput {
  label: string;
  description?: string | null;
  capex?: number | null;
  opex?: number | null;
  lifecycleCost?: number | null;
  scheduleEffect?: string | null;
  riskEffect?: string | null;
  reliabilityEffect?: string | null;
  environmentalEffect?: string | null;
  expectedValue?: number | null;
}

export async function addDecisionOption(
  decisionId: string,
  option: DecisionOptionInput,
): Promise<{ option_id: string }> {
  const { data, error } = await supabase.rpc("add_decision_option", {
    p_decision_id: decisionId,
    p_label: option.label,
    p_description: option.description ?? null,
    p_capex: option.capex ?? null,
    p_opex: option.opex ?? null,
    p_lifecycle_cost: option.lifecycleCost ?? null,
    p_schedule_effect: option.scheduleEffect ?? null,
    p_risk_effect: option.riskEffect ?? null,
    p_reliability_effect: option.reliabilityEffect ?? null,
    p_environmental_effect: option.environmentalEffect ?? null,
    p_expected_value: option.expectedValue ?? null,
  });
  return unwrap(data, error);
}

export async function selectDecisionOption(input: {
  decisionId: string;
  optionId: string;
  rationale: string;
  evidenceItemIds?: string[];
  assumptionIds?: string[];
}): Promise<{ decision_id: string; selected_option_id: string }> {
  const { data, error } = await supabase.rpc("select_decision_option", {
    p_decision_id: input.decisionId,
    p_option_id: input.optionId,
    p_rationale: input.rationale,
    p_evidence_item_ids: input.evidenceItemIds ?? [],
    p_assumption_ids: input.assumptionIds ?? [],
    p_approval_level: null,
  });
  return unwrap(data, error);
}

export interface BindableAction {
  id: string;
  title: string;
  status: string;
  urgency: string | null;
}

/** Canonical recommendations not yet bound to any case. */
export async function listBindableActions(): Promise<BindableAction[]> {
  const { data, error } = await supabase
    .from("recommendations")
    .select("id, title, status, urgency")
    .is("development_case_id", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as BindableAction[];
}

export async function bindActionToCase(input: {
  recommendationId: string;
  caseId: string | null;
  reason?: string | null;
}): Promise<{ recommendation_id: string }> {
  const { data, error } = await supabase.rpc("bind_recommendation_to_case", {
    p_recommendation_id: input.recommendationId,
    p_case_id: input.caseId,
    p_reason: input.reason ?? null,
  });
  return unwrap(data, error);
}

// ---------------------------------------------------------------------------
// Slice 1 rows 9–12: baselines, gate readiness, operational readiness,
// evidence agent. Same contract as everything above: definer RPCs, server
// refusals surfaced verbatim, no client-side writes.
// ---------------------------------------------------------------------------

export async function createCaseBaseline(input: {
  caseId: string;
  baselineType: string;
  description: string;
  content?: Record<string, unknown>;
  documentId?: string | null;
}): Promise<{ baseline_id: string; version: number }> {
  const { data, error } = await supabase.rpc("create_case_baseline", {
    p_case_id: input.caseId,
    p_type: input.baselineType,
    p_description: input.description,
    p_content: input.content ?? {},
    p_document_id: input.documentId ?? null,
  });
  return unwrap(data, error);
}

export async function approveCaseBaseline(input: {
  baselineId: string;
  note: string;
}): Promise<{ baseline_id: string; version: number; status: string }> {
  const { data, error } = await supabase.rpc("approve_case_baseline", {
    p_baseline_id: input.baselineId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

/**
 * The §80 readiness read: the RPC returns the same rows the enforcement
 * consults, and the panel renders them without recomputation.
 */
export async function getGateReadiness(
  caseId: string,
  gateId: number,
): Promise<GateReadinessResult> {
  const { data, error } = await supabase.rpc("get_gate_readiness", {
    p_case_id: caseId,
    p_gate_id: gateId,
  });
  return unwrap<GateReadinessResult>(data, error);
}

/** The §81 operations view read (get_golive_readiness family, case scope). */
export async function getCaseOperationalReadiness(
  caseId: string,
): Promise<OperationalReadinessResult> {
  const { data, error } = await supabase.rpc("get_case_operational_readiness", {
    p_case_id: caseId,
  });
  return unwrap<OperationalReadinessResult>(data, error);
}

export interface BindableAsset {
  id: string;
  name: string;
  tag: string | null;
}

export async function listBindableAssets(): Promise<BindableAsset[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, tag")
    .order("name")
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as BindableAsset[];
}

export async function bindAssetToCase(input: {
  assetId: string;
  caseId: string;
  reason?: string | null;
  unbind?: boolean;
}): Promise<{ asset_id: string }> {
  const { data, error } = await supabase.rpc("bind_asset_to_development_case", {
    p_asset_id: input.assetId,
    p_case_id: input.caseId,
    p_reason: input.reason ?? null,
    p_unbind: input.unbind ?? false,
  });
  return unwrap(data, error);
}

// The evidence/gap agent (D12.07). Advisory only — the response carries its
// own §70 disclaimer and the panel renders refusals and provider notes
// verbatim. `record` opts into the one permitted write: an evidence_items
// row born AI_INFERENCE through the governed record_case_evidence RPC.
export interface EvidenceAgentMatch {
  evidence: {
    id: string;
    evidenceClass: string | null;
    verificationStatus: string;
    description: string | null;
    sourceSystem: string | null;
  };
  matchedTerms: string[];
  score: number;
}

export interface EvidenceAgentResult {
  advisory: true;
  criterionId: number;
  criterion: string;
  analysis: {
    verdict: string;
    statement: string;
    matches: EvidenceAgentMatch[];
    verifiedMatches: number;
    acceptedDeliverables: number;
    totalCaseEvidence: number;
  };
  kbCitations: { chunkId: string; title: string; label: string }[];
  narrative: string | null;
  model: string | null;
  providerNote: string | null;
  disclaimer: string;
  recordedEvidenceId: string | null;
  recordNote: string | null;
}

export async function runEvidenceAgent(input: {
  caseId: string;
  criterionId: number;
  record?: boolean;
}): Promise<EvidenceAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-evidence-agent",
    {
      body: {
        case_id: input.caseId,
        criterion_id: input.criterionId,
        record: input.record ?? false,
      },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as EvidenceAgentResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as EvidenceAgentResult;
}

// ---------------------------------------------------------------------------
// Slice 2 — the value spine. Every write is a definer RPC; refusals are the
// SERVER's words, thrown verbatim.
// ---------------------------------------------------------------------------

import type {
  CaseFinanceModel,
  CaseValueTrajectory,
  CollapseVerdict,
  SinceSanctionDelta,
} from "../lib/develop";

function unwrapRpc<T>(
  data: unknown,
  error: { message: string } | null,
  fallback: string,
): T {
  if (error) throw new Error(`${fallback}: ${error.message}`);
  const record = (data ?? {}) as Record<string, unknown>;
  if (typeof record.error === "string") throw new Error(record.error);
  return record as T;
}

export async function draftSuccessContract(
  caseId: string,
): Promise<{ contract_id: string; version?: number }> {
  const { data, error } = await supabase.rpc("draft_success_contract", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not draft the success contract");
}

export interface SuccessOutcomeInput {
  contractId: string;
  dimension: string;
  statement: string;
  basis: string;
  ownerId: string;
  targetValue?: number | null;
  unit?: string | null;
  ramTargetId?: number | null;
}

export async function setSuccessOutcome(
  input: SuccessOutcomeInput,
): Promise<{ outcome_id: string }> {
  const { data, error } = await supabase.rpc("set_success_outcome", {
    p_contract_id: input.contractId,
    p_dimension: input.dimension,
    p_outcome_statement: input.statement,
    p_basis: input.basis,
    p_owner_id: input.ownerId,
    p_target_value: input.targetValue ?? null,
    p_unit: input.unit ?? null,
    p_ram_target_id: input.ramTargetId ?? null,
  });
  return unwrapRpc(data, error, "Could not state the outcome");
}

export async function recordSuccessContract(input: {
  contractId: string;
  note: string;
}): Promise<{ contract_id: string; outcomes: number }> {
  const { data, error } = await supabase.rpc("record_success_contract", {
    p_contract_id: input.contractId,
    p_note: input.note,
  });
  return unwrapRpc(data, error, "Could not record the success contract");
}

export interface CaseRamTargetOption {
  id: number;
  system_label: string;
  target_availability: number;
}

/** RAM targets of the case's capital project — the canonical records a
 *  reliability/availability/maintainability outcome REFERENCES. */
export async function listCaseRamTargets(
  caseId: string,
): Promise<CaseRamTargetOption[]> {
  const { data: caseRow, error: caseError } = await supabase
    .from("development_cases")
    .select("capital_project_id")
    .eq("id", caseId)
    .maybeSingle()
    .returns<{ capital_project_id: number | null }>();
  if (caseError || caseRow?.capital_project_id == null) return [];
  const { data, error } = await supabase
    .from("ram_targets")
    .select("id, system_label, target_availability")
    .eq("project_id", caseRow.capital_project_id)
    .order("system_label")
    .returns<CaseRamTargetOption[]>();
  if (error) return [];
  return data ?? [];
}

export async function createCaseBusinessCase(input: {
  caseId: string;
  caseRef: string;
  title: string;
  driver: string;
  discountRate: number;
  discountRateSource: string;
  currency?: string;
}): Promise<{ business_case_id: number }> {
  const { data, error } = await supabase.rpc("create_case_business_case", {
    p_case_id: input.caseId,
    p_case_ref: input.caseRef,
    p_title: input.title,
    p_driver: input.driver,
    p_discount_rate: input.discountRate,
    p_discount_rate_source: input.discountRateSource,
    p_currency: input.currency ?? "USD",
  });
  return unwrapRpc(data, error, "Could not record the business case");
}

export async function recordValueHypothesis(input: {
  businessCaseId: number;
  spend: number;
  effect: string;
  effectQuantity?: number | null;
  effectUnit?: string | null;
  valuePerYear: number;
  basis: string;
}): Promise<{ business_case_id: number }> {
  const { data, error } = await supabase.rpc("record_value_hypothesis", {
    p_business_case_id: input.businessCaseId,
    p_spend: input.spend,
    p_effect: input.effect,
    p_effect_quantity: input.effectQuantity ?? null,
    p_effect_unit: input.effectUnit ?? null,
    p_value_per_year: input.valuePerYear,
    p_basis: input.basis,
  });
  return unwrapRpc(data, error, "Could not record the value hypothesis");
}

export async function setCaseViabilityFloor(input: {
  businessCaseId: number;
  floor: number;
  basis: string;
}): Promise<{ business_case_id: number; viability_floor: number }> {
  const { data, error } = await supabase.rpc("set_case_viability_floor", {
    p_business_case_id: input.businessCaseId,
    p_floor: input.floor,
    p_basis: input.basis,
  });
  return unwrapRpc(data, error, "Could not set the viability floor");
}

export async function addBusinessCaseOption(input: {
  businessCaseId: number;
  label: string;
  lifePeriods: number;
  cashFlows: { period: number; amount: number }[];
  benefitProbability?: number | null;
  isDoNothing?: boolean;
  notes?: string | null;
  contingency?: number | null;
  contingencyBasis?: string | null;
}): Promise<{ option_id: number; flows_recorded: number }> {
  const { data, error } = await supabase.rpc("add_business_case_option", {
    p_business_case_id: input.businessCaseId,
    p_label: input.label,
    p_life_periods: input.lifePeriods,
    p_cash_flows: input.cashFlows,
    p_benefit_probability: input.benefitProbability ?? null,
    p_is_do_nothing: input.isDoNothing ?? false,
    p_notes: input.notes ?? null,
    p_contingency: input.contingency ?? null,
    p_contingency_basis: input.contingencyBasis ?? null,
  });
  return unwrapRpc(data, error, "Could not add the option");
}

export async function upsertFinancialAssumption(input: {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
  source: string;
  kind?: string;
  effectiveFrom?: string | null;
  reviewDue?: string | null;
}): Promise<{
  version_id: number;
  threshold_observations: number;
  threshold_violations: unknown[];
}> {
  const { data, error } = await supabase.rpc("upsert_financial_assumption", {
    p_key: input.key,
    p_label: input.label,
    p_value: input.value,
    p_unit: input.unit ?? null,
    p_source: input.source,
    p_kind: input.kind ?? "general",
    p_effective_from: input.effectiveFrom ?? null,
    p_review_due: input.reviewDue ?? null,
  });
  return unwrapRpc(data, error, "Could not record the financial assumption");
}

export async function recordCaseAssumption(input: {
  caseId: string;
  statement: string;
  triggerForReview: string;
  ownerId: string;
  confidence?: number;
  businessCaseId?: number | null;
  thresholdParameter?: string | null;
  thresholdComparator?: string | null;
  thresholdValue?: number | null;
  thresholdUnit?: string | null;
}): Promise<{ assumption_id: string; monitored: boolean }> {
  const { data, error } = await supabase.rpc("record_case_assumption", {
    p_case_id: input.caseId,
    p_assumption: {
      statement: input.statement,
      trigger_for_review: input.triggerForReview,
      owner_id: input.ownerId,
      confidence: input.confidence ?? 0,
      business_case_id: input.businessCaseId ?? null,
      threshold_parameter: input.thresholdParameter ?? null,
      threshold_comparator: input.thresholdComparator ?? null,
      threshold_value: input.thresholdValue ?? null,
      threshold_unit: input.thresholdUnit ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not record the assumption");
}

export async function recordCaseValueEvaluation(input: {
  caseId: string;
  optionId: number;
  expectedValue: number;
  valueBasis: string;
  uncertaintyLevel: "low" | "moderate" | "high";
  uncertaintyReasons?: string[];
  computed?: Record<string, unknown>;
  engineVersion?: string;
}): Promise<{ evaluation_id: string; collapse?: CollapseVerdict }> {
  const { data, error } = await supabase.rpc("record_case_value_evaluation", {
    p_case_id: input.caseId,
    p_option_id: input.optionId,
    p_expected_value: input.expectedValue,
    p_value_basis: input.valueBasis,
    p_uncertainty_level: input.uncertaintyLevel,
    p_uncertainty_reasons: input.uncertaintyReasons ?? [],
    p_computed: input.computed ?? {},
    p_engine_version: input.engineVersion ?? "develop-value/1",
  });
  return unwrapRpc(data, error, "Could not record the value evaluation");
}

export async function getCaseFinanceModel(
  caseId: string,
): Promise<CaseFinanceModel> {
  const { data, error } = await supabase.rpc("get_case_finance_model", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the finance model");
}

export async function getCaseValueTrajectory(
  caseId: string,
): Promise<CaseValueTrajectory> {
  const { data, error } = await supabase.rpc("get_case_value_trajectory", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the value trajectory");
}

export async function getSinceSanctionDelta(
  caseId: string,
): Promise<SinceSanctionDelta> {
  const { data, error } = await supabase.rpc("get_since_sanction_delta", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the since-sanction delta");
}

export async function recordCaseBenefit(input: {
  caseId: string;
  label: string;
  expectedValue: number;
  unit: string;
  expectedDate: string;
  ownerId: string;
  basis: string;
  objectiveId?: string | null;
}): Promise<{ benefit_id: string }> {
  const { data, error } = await supabase.rpc("record_case_benefit", {
    p_case_id: input.caseId,
    p_label: input.label,
    p_expected_value: input.expectedValue,
    p_unit: input.unit,
    p_expected_date: input.expectedDate,
    p_owner_id: input.ownerId,
    p_basis: input.basis,
    p_objective_id: input.objectiveId ?? null,
  });
  return unwrapRpc(data, error, "Could not record the benefit");
}

// ---------------------------------------------------------------------------
// D13.07 — the governed Decision Workspace reads. The record IS decisions +
// scenarios (overlap-map ruling 15); these are plain RLS reads.
// ---------------------------------------------------------------------------

export interface GovernedDecisionRow {
  id: string;
  decision_question: string | null;
  development_case_id: string;
  decision_required_date: string | null;
  approval_level: string | null;
  selected_option_id: string | null;
  selected_at: string | null;
  selection_rationale: string | null;
  created_at: string;
}

export interface GovernedDecisionOptionRow {
  id: string;
  label: string;
  description: string | null;
  capex: number | null;
  opex: number | null;
  lifecycle_cost: number | null;
  schedule_effect: string | null;
  risk_effect: string | null;
  reliability_effect: string | null;
  environmental_effect: string | null;
  expected_value: number | null;
  sequence_no: number | null;
}

export async function listGovernedDecisions(): Promise<
  (GovernedDecisionRow & { caseTitle: string | null })[]
> {
  const { data, error } = await supabase
    .from("decisions")
    .select(
      "id, decision_question, development_case_id, decision_required_date, approval_level, selected_option_id, selected_at, selection_rationale, created_at",
    )
    .not("development_case_id", "is", null)
    .order("created_at", { ascending: false })
    .returns<GovernedDecisionRow[]>();
  if (error) throw new Error(`Could not list decisions: ${error.message}`);
  const rows = data ?? [];
  const caseIds = [...new Set(rows.map((r) => r.development_case_id))];
  if (caseIds.length === 0) return [];
  const { data: cases } = await supabase
    .from("development_cases")
    .select("id, title")
    .in("id", caseIds)
    .returns<{ id: string; title: string }[]>();
  const titles = new Map((cases ?? []).map((c) => [c.id, c.title]));
  return rows.map((r) => ({
    ...r,
    caseTitle: titles.get(r.development_case_id) ?? null,
  }));
}

export async function getGovernedDecision(decisionId: string): Promise<{
  decision: (GovernedDecisionRow & { caseTitle: string | null }) | null;
  options: GovernedDecisionOptionRow[];
}> {
  const { data, error } = await supabase
    .from("decisions")
    .select(
      "id, decision_question, development_case_id, decision_required_date, approval_level, selected_option_id, selected_at, selection_rationale, created_at",
    )
    .eq("id", decisionId)
    .maybeSingle()
    .returns<GovernedDecisionRow | null>();
  if (error) throw new Error(`Could not load the decision: ${error.message}`);
  if (data == null || data.development_case_id == null) {
    return { decision: null, options: [] };
  }
  const [{ data: options }, { data: caseRow }] = await Promise.all([
    supabase
      .from("scenarios")
      .select(
        "id, label, description, capex, opex, lifecycle_cost, schedule_effect, risk_effect, reliability_effect, environmental_effect, expected_value, sequence_no",
      )
      .eq("decision_id", decisionId)
      .order("sequence_no", { ascending: true, nullsFirst: false })
      .returns<GovernedDecisionOptionRow[]>(),
    supabase
      .from("development_cases")
      .select("id, title")
      .eq("id", data.development_case_id)
      .maybeSingle()
      .returns<{ id: string; title: string } | null>(),
  ]);
  return {
    decision: { ...data, caseTitle: caseRow?.title ?? null },
    options: options ?? [],
  };
}

// ---------------------------------------------------------------------------
// D3.03/D3.04/D3.05/D11.14 — case governance: the six-factor intensity
// determination, the tailoring selection it persists, and the org-tree
// inheritance read. All writes are definer RPCs; refusals surface verbatim.
// ---------------------------------------------------------------------------

export interface CaseGovernanceBinding {
  intensityLevel: string;
  version: number;
  status?: string;
  independentAssuranceRequired: boolean;
  evidenceLinkedDeliverablesRequired: boolean;
  assuranceLevel: string;
  reviewCadenceDays: number | null;
  basis?: string;
}

export interface CaseGovernanceDetermination {
  id: string;
  intensityLevel: string;
  computedLevel: string;
  factorInputs: Record<string, unknown>;
  factorLevels: Record<string, number>;
  drivers: string[];
  basis: string;
  determinedAt: string;
  determinedBy: string | null;
  rule: {
    id: number;
    priority: number;
    description: string;
    frameworkName: string;
    intensityFloor: string | null;
  };
  ruleSet: { id: string; name: string; version: number };
  framework: { id: string; name: string; version: number };
  binding: CaseGovernanceBinding | null;
}

export interface CaseGovernanceOrgNode {
  nodeId: string;
  name: string;
  orgLevel: string;
  depth: number;
  carriesProfile: boolean;
}

export interface CaseGovernanceBindingUnmet {
  intensity_level: string | null;
  binding_level: string | null;
  binding_version: number | null;
  unlinked_mandatory: string[];
  non_independent_gates: string[];
  /** D3.20: mandatory requirements whose latest gate pass leaned on a waiver
   *  that has since lapsed — the pass no longer stands. */
  waiver_reverted?: string[];
  /** Mandatory requirements without a met finding on the latest passing
   *  review where NO waiver ever stood — named as what they are, so the
   *  remedy is re-satisfy/re-record (or a governed waiver), not "renew a
   *  waiver" the case never held. */
  criteria_unmet?: string[];
  /** D3.34/D11.28: composite authority rules demanding an independent
   *  assurance review not yet recorded. */
  composite_unmet?: string[];
}

export interface CaseGovernance {
  caseId: string;
  caseValueUsd: number | null;
  caseValueSource: "sanctioned_value" | "estimated_capex" | null;
  /** What the resolved adopted binding demands of the current stage's gates
   *  right now (null = nothing armed or everything met) — the same predicate
   *  the gate trigger, advance and sanction consume. */
  bindingUnmet: CaseGovernanceBindingUnmet | null;
  draftRuleSets: Array<{ id: string; name: string; version: number }>;
  draftBindings: Array<{
    id: string;
    intensityLevel: string;
    version: number;
    independentAssuranceRequired: boolean;
    evidenceLinkedDeliverablesRequired: boolean;
    assuranceLevel: string;
    reviewCadenceDays: number | null;
  }>;
  lifecycleType: string;
  framework: {
    id: string;
    name: string;
    version: number;
    status: string;
  } | null;
  determination: CaseGovernanceDetermination | null;
  orgChain: CaseGovernanceOrgNode[];
  inheritedProfile: {
    frameworkId: string;
    name: string;
    version: number;
    sourceAuthority: string;
    sourceNode: { nodeId: string; name: string; orgLevel: string } | null;
    depth: number;
    operableHere: boolean;
  } | null;
  adoptedRuleSet: {
    id: string;
    name: string;
    version: number;
    status: string;
    valueThresholds: Record<string, number>;
    rules: Array<{
      id: number;
      priority: number;
      description: string;
      lifecycleTypes: string[];
      minValueUsd: number | null;
      maxValueUsd: number | null;
      minIntensity: string | null;
      maxIntensity: string | null;
      frameworkName: string;
      intensityFloor: string | null;
    }>;
    compositeRules: Array<{
      id: number;
      priority: number;
      description: string;
      minValueLevel: number | null;
      minRiskRating: string | null;
      minIntensity: string | null;
      minNovelty: string | null;
      consequence: string;
    }>;
  } | null;
  adoptedBindings: CaseGovernanceBinding[];
}

export async function addCompositeAuthorityRule(input: {
  ruleSetId: string;
  priority: number;
  description: string;
  consequence: "independent_assurance_required";
  minValueLevel?: number | null;
  minRiskRating?: string | null;
  minIntensity?: string | null;
  minNovelty?: string | null;
}): Promise<{ rule_id: number; priority: number; consequence: string }> {
  const { data, error } = await supabase.rpc("add_composite_authority_rule", {
    p_rule_set_id: input.ruleSetId,
    p_priority: input.priority,
    p_description: input.description,
    p_consequence: input.consequence,
    p_min_value_level: input.minValueLevel ?? null,
    p_min_risk_rating: input.minRiskRating ?? null,
    p_min_intensity: input.minIntensity ?? null,
    p_min_novelty: input.minNovelty ?? null,
  });
  return unwrap(data, error);
}

export async function getCaseGovernance(
  caseId: string,
): Promise<CaseGovernance> {
  const { data, error } = await supabase.rpc("get_case_governance", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the case's governance");
}

export interface ApplyCaseGovernanceInput {
  caseId: string;
  risk: string;
  complexity: string;
  novelty: string;
  regulatoryExposure: string;
  interfaces: string;
  basis: string;
}

export interface ApplyCaseGovernanceResult {
  determination_id: string;
  intensity_level: string;
  computed_level: string;
  drivers: string[];
  factor_levels: Record<string, number>;
  rule: { id: number; priority: number; description: string };
  framework: { id: string; name: string; version: number };
  binding: Record<string, unknown> | null;
  binding_note: string | null;
  binding_unmet: CaseGovernanceBindingUnmet | null;
}

export async function applyCaseGovernance(
  input: ApplyCaseGovernanceInput,
): Promise<ApplyCaseGovernanceResult> {
  const { data, error } = await supabase.rpc("apply_case_governance", {
    p_case_id: input.caseId,
    p_risk: input.risk || null,
    p_complexity: input.complexity || null,
    p_novelty: input.novelty || null,
    p_regulatory_exposure: input.regulatoryExposure || null,
    p_interfaces: input.interfaces || null,
    p_basis: input.basis,
  });
  return unwrapRpc(data, error, "Could not determine the governance regime");
}

export async function seedGovernanceLibrary(): Promise<{
  profiles_added: number;
  tailoring_defaults_added?: number;
  note?: string;
}> {
  const { data, error } = await supabase.rpc(
    "seed_governance_framework_library",
  );
  return unwrapRpc(data, error, "Could not seed the framework library");
}

export async function adoptGovernanceRuleSet(
  ruleSetId: string,
  note: string,
): Promise<{ rule_set_id: string; version: number; status: string }> {
  const { data, error } = await supabase.rpc("adopt_governance_rule_set", {
    p_rule_set_id: ruleSetId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not adopt the tailoring rule set");
}

export async function createGovernanceRuleSetVersion(
  ruleSetId: string,
): Promise<{
  rule_set_id: string;
  name: string;
  version: number;
  status: string;
  rules_cloned: number;
}> {
  const { data, error } = await supabase.rpc(
    "create_governance_rule_set_version",
    { p_rule_set_id: ruleSetId },
  );
  return unwrapRpc(data, error, "Could not draft a new rule-set version");
}

export async function adoptIntensityBinding(
  bindingId: string,
  note: string,
): Promise<{ binding_id: string; intensity_level: string; status: string }> {
  const { data, error } = await supabase.rpc("adopt_intensity_binding", {
    p_binding_id: bindingId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not adopt the intensity binding");
}

/* ─────────────────────────── Slice 3C — the chains ────────────────────────
 * D3.08/D3.09 stakeholder commitments and coverage, D3.10/D3.11 the
 * regulatory approval chain and its propagation, D3.16 case assurance,
 * D11.22 evidence confidence. Every write is a definer RPC; the one read is
 * get_case_chains, which composes the SAME coverage and confidence functions
 * the gate blocker and the §46 calculation use (no second implementation).
 */

export async function getCaseChains(caseId: string): Promise<CaseChains> {
  const { data, error } = await supabase.rpc("get_case_chains", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the case chains");
}

export interface CaseRequirementInput {
  requirementRef: string;
  category: string;
  requirement: string;
  source?: string;
  verificationMethod?: string | null;
}

export async function recordCaseRequirement(
  caseId: string,
  input: CaseRequirementInput,
): Promise<{ requirement_id: number; requirement_ref: string }> {
  const { data, error } = await supabase.rpc("record_case_requirement", {
    p_case_id: caseId,
    p_requirement: {
      requirement_ref: input.requirementRef,
      category: input.category,
      requirement: input.requirement,
      source: input.source ?? "engineering",
      verification_method: input.verificationMethod ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not record the project requirement");
}

export interface StakeholderCommitmentInput {
  stakeholderId: string;
  commitmentRef: string;
  concern: string;
  commitment: string;
  ownerId: string;
  dueDate: string;
  commitmentKind?: string;
  requirementId?: number | null;
}

export async function recordStakeholderCommitment(
  caseId: string,
  input: StakeholderCommitmentInput,
): Promise<{
  commitment_id: number;
  commitment_ref: string;
  covered: boolean;
}> {
  const { data, error } = await supabase.rpc("record_stakeholder_commitment", {
    p_case_id: caseId,
    p_commitment: {
      stakeholder_id: input.stakeholderId,
      commitment_ref: input.commitmentRef,
      concern: input.concern,
      commitment: input.commitment,
      owner_id: input.ownerId,
      due_date: input.dueDate,
      commitment_kind: input.commitmentKind ?? "community",
      requirement_id: input.requirementId ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not record the stakeholder commitment");
}

export async function linkCommitmentToRequirement(
  commitmentId: number,
  requirementId: number,
): Promise<{ commitment_id: number; requirement_ref: string }> {
  const { data, error } = await supabase.rpc("link_commitment_to_requirement", {
    p_commitment_id: commitmentId,
    p_requirement_id: requirementId,
  });
  return unwrapRpc(
    data,
    error,
    "Could not link the commitment to a requirement",
  );
}

export async function closeStakeholderCommitment(input: {
  commitmentId: number;
  evidenceId: string;
  note?: string | null;
}): Promise<{ commitment_id: number; status: string; closed_late: boolean }> {
  const { data, error } = await supabase.rpc("close_stakeholder_commitment", {
    p_commitment_id: input.commitmentId,
    p_evidence_id: input.evidenceId,
    p_note: input.note ?? null,
  });
  return unwrapRpc(data, error, "Could not discharge the commitment");
}

export interface RegulatoryRequirementInput {
  requirementRef: string;
  regulator: string;
  jurisdiction: string;
  instrument: string;
  permitType: string;
  description: string;
  triggerCondition: string;
  expectedLeadTimeDays: number;
  sourceAuthority?: string;
  requiredByDate?: string | null;
}

export async function recordRegulatoryRequirement(
  caseId: string,
  input: RegulatoryRequirementInput,
): Promise<{ requirement_id: number; requirement_ref: string }> {
  const { data, error } = await supabase.rpc("record_regulatory_requirement", {
    p_case_id: caseId,
    p_requirement: {
      requirement_ref: input.requirementRef,
      regulator: input.regulator,
      jurisdiction: input.jurisdiction,
      instrument: input.instrument,
      permit_type: input.permitType,
      description: input.description,
      trigger_condition: input.triggerCondition,
      expected_lead_time_days: input.expectedLeadTimeDays,
      source_authority: input.sourceAuthority ?? "REGULATION",
      required_by_date: input.requiredByDate ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not record the regulatory requirement");
}

export async function submitRegulatoryApplication(input: {
  requirementId: number;
  applicationRef: string;
  scopeDescription: string;
}): Promise<{
  application_id: number;
  application_ref: string;
  expected_decision_by: string;
}> {
  const { data, error } = await supabase.rpc("submit_regulatory_application", {
    p_requirement_id: input.requirementId,
    p_application: {
      application_ref: input.applicationRef,
      scope_description: input.scopeDescription,
    },
  });
  return unwrapRpc(data, error, "Could not submit the regulatory application");
}

export async function recordRegulatoryInformationRequest(input: {
  applicationId: number;
  requestRef: string;
  requestDetail: string;
  ownerId: string;
  responseDue: string;
  requestedAt?: string | null;
}): Promise<{ request_id: number; request_ref: string }> {
  const { data, error } = await supabase.rpc(
    "record_regulatory_information_request",
    {
      p_application_id: input.applicationId,
      p_request: {
        request_ref: input.requestRef,
        request_detail: input.requestDetail,
        owner_id: input.ownerId,
        response_due: input.responseDue,
        requested_at: input.requestedAt ?? null,
      },
    },
  );
  return unwrapRpc(data, error, "Could not record the information request");
}

export async function respondRegulatoryInformationRequest(input: {
  requestId: number;
  evidenceId: string;
}): Promise<{ request_id: number; status: string; answered_late: boolean }> {
  const { data, error } = await supabase.rpc(
    "respond_regulatory_information_request",
    { p_request_id: input.requestId, p_evidence_id: input.evidenceId },
  );
  return unwrapRpc(data, error, "Could not record the RFI response");
}

/** D3.08: retire a promise the organization is no longer bound by, with a
 *  stated reason and a named human behind it (§70). */
export async function withdrawStakeholderCommitment(input: {
  commitmentId: number;
  reason: string;
}): Promise<{ commitment_id: number; status: string; reason: string }> {
  const { data, error } = await supabase.rpc(
    "withdraw_stakeholder_commitment",
    { p_commitment_id: input.commitmentId, p_reason: input.reason },
  );
  return unwrapRpc(data, error, "Could not withdraw the commitment");
}

export interface RegulatoryConditionInput {
  condition_ref: string;
  description: string;
  obligation_domain: string;
  owner_id: string;
  due_date: string;
  evidence_requirement: string;
  consequence_if_missed: string;
  recurrence?: string;
}

export async function recordRegulatoryApproval(input: {
  applicationId: number;
  permitNumber: string;
  decidingAuthority: string;
  decision: string;
  decisionDate?: string | null;
  effectiveFrom?: string | null;
  expiresAt?: string | null;
  perpetual?: boolean;
  refusalReason?: string | null;
  conditions?: RegulatoryConditionInput[];
}): Promise<{
  approval_id: number;
  permit_number: string;
  decision: string;
  conditions_created: number;
  propagation: unknown;
}> {
  const { data, error } = await supabase.rpc("record_regulatory_approval", {
    p_application_id: input.applicationId,
    p_approval: {
      permit_number: input.permitNumber,
      deciding_authority: input.decidingAuthority,
      decision: input.decision,
      decision_date: input.decisionDate ?? null,
      effective_from: input.effectiveFrom ?? null,
      expires_at: input.expiresAt ?? null,
      perpetual: input.perpetual ?? false,
      refusal_reason: input.refusalReason ?? null,
    },
    p_conditions: input.conditions ?? [],
  });
  return unwrapRpc(data, error, "Could not record the regulatory approval");
}

export async function propagateRegulatoryConditions(
  approvalId: number,
): Promise<{
  approval_id: number;
  requirements_created: number;
  work_orders_created: number;
}> {
  const { data, error } = await supabase.rpc(
    "propagate_regulatory_conditions",
    { p_approval_id: approvalId },
  );
  return unwrapRpc(data, error, "Could not propagate the permit conditions");
}

export async function closeRegulatoryCondition(input: {
  conditionId: number;
  evidenceId: string;
  note?: string | null;
}): Promise<{
  condition_id: number;
  status: string;
  recurring: boolean;
  next_due: string | null;
}> {
  const { data, error } = await supabase.rpc("close_regulatory_condition", {
    p_condition_id: input.conditionId,
    p_evidence_id: input.evidenceId,
    p_note: input.note ?? null,
  });
  return unwrapRpc(data, error, "Could not discharge the permit condition");
}

/**
 * D3.16's own act site.
 *
 * NOT a rename of the Slice-3B `recordCaseAssuranceReview` above: that one
 * posts a COMPLETED independent review through the risk family's RPC
 * (record_risk_assurance_review) and is what GovernancePanel uses to release
 * a composite-authority demand. This one posts through
 * record_case_assurance_review, which additionally requires the II.15 record
 * (verified reviewer competency, an explicit conflicts declaration) and can
 * bind the review to a gate. Two doors, two contracts, one table — the older
 * door keeps working exactly as it did, and the register names the residual
 * that leaves.
 */
export interface CaseAssuranceReviewInput {
  assuranceLevel: string;
  scope: string;
  status?: string;
  gateId?: number | null;
  reviewerCompetencyKeys?: string[];
  reviewerCompetencyBasis?: string | null;
  conflictsDeclared?: { conflict: string; mitigation: string }[];
  conflictsDeclarationMade?: boolean;
  dueDate?: string | null;
  conclusion?: string | null;
  evidenceItemIds?: string[];
}

export async function submitCaseAssuranceReview(
  caseId: string,
  input: CaseAssuranceReviewInput,
): Promise<{ review_id: string; assurance_level: string; status: string }> {
  const { data, error } = await supabase.rpc("record_case_assurance_review", {
    p_case_id: caseId,
    p_review: {
      assurance_level: input.assuranceLevel,
      scope: input.scope,
      status: input.status ?? "planned",
      gate_id: input.gateId ?? null,
      reviewer_competency_keys: input.reviewerCompetencyKeys ?? [],
      reviewer_competency_basis: input.reviewerCompetencyBasis ?? null,
      conflicts_declared: input.conflictsDeclared ?? [],
      conflicts_declaration_made: input.conflictsDeclarationMade ?? false,
      due_date: input.dueDate ?? null,
      conclusion: input.conclusion ?? null,
      evidence_item_ids: input.evidenceItemIds ?? [],
    },
  });
  return unwrapRpc(data, error, "Could not record the assurance review");
}

export async function completeCaseAssuranceReview(input: {
  reviewId: string;
  conclusion: string;
  evidenceItemIds: string[];
  findings?: unknown[];
}): Promise<{ review_id: string; status: string; conclusion: string }> {
  const { data, error } = await supabase.rpc("complete_case_assurance_review", {
    p_review_id: input.reviewId,
    p_conclusion: input.conclusion,
    p_evidence_item_ids: input.evidenceItemIds,
    p_findings: input.findings ?? [],
  });
  return unwrapRpc(data, error, "Could not complete the assurance review");
}

export async function gradeEvidenceItem(input: {
  evidenceId: string;
  qualityGrade: string;
  applicabilityGrade: string;
  note?: string | null;
}): Promise<{
  evidence_id: string;
  quality_grade: string;
  applicability_grade: string;
}> {
  const { data, error } = await supabase.rpc("grade_evidence_item", {
    p_evidence_id: input.evidenceId,
    p_quality_grade: input.qualityGrade,
    p_applicability_grade: input.applicabilityGrade,
    p_note: input.note ?? null,
  });
  return unwrapRpc(data, error, "Could not grade the evidence item");
}

export async function adoptEvidenceConfidenceProfile(
  profileId: string,
): Promise<{ profile_id: string; status: string; version: number }> {
  const { data, error } = await supabase.rpc(
    "adopt_evidence_confidence_profile",
    { p_profile_id: profileId },
  );
  return unwrapRpc(data, error, "Could not adopt the weight set");
}

/** D11.22: author a DRAFT weight set. The refusal on an adopted profile
 *  names `create_evidence_confidence_profile_version` as the remedy, so both
 *  verbs are reachable from the same panel. */
export async function setEvidenceConfidenceWeights(input: {
  profileId: string;
  qualityWeights?: Record<string, number>;
  applicabilityWeights?: Record<string, number>;
  verificationWeights?: Record<string, number>;
  freshnessHalfLifeDays?: Record<
    string,
    { halfLifeDays: number; floor: number }
  >;
  basis?: string | null;
}): Promise<{ profile_id: string; status: string; version: number }> {
  const weights: Record<string, unknown> = {};
  if (input.qualityWeights) weights.quality_weights = input.qualityWeights;
  if (input.applicabilityWeights)
    weights.applicability_weights = input.applicabilityWeights;
  if (input.verificationWeights)
    weights.verification_weights = input.verificationWeights;
  if (input.freshnessHalfLifeDays)
    weights.freshness_half_life_days = input.freshnessHalfLifeDays;
  if (input.basis) weights.basis = input.basis;
  const { data, error } = await supabase.rpc(
    "set_evidence_confidence_weights",
    {
      p_profile_id: input.profileId,
      p_weights: weights,
    },
  );
  return unwrapRpc(data, error, "Could not author the weight set");
}

/** D11.22: copy an adopted weight set forward as a new DRAFT version — the
 *  verb `set_evidence_confidence_weights`' refusal names. */
export async function createEvidenceConfidenceProfileVersion(input: {
  fromProfileId: string;
  basis?: string | null;
}): Promise<{
  profile_id: string;
  name: string;
  version: number;
  status: string;
}> {
  const { data, error } = await supabase.rpc(
    "create_evidence_confidence_profile_version",
    { p_from_profile_id: input.fromProfileId, p_basis: input.basis ?? null },
  );
  return unwrapRpc(data, error, "Could not open a new weight-set version");
}

export interface EvidenceConfidenceProfileRow {
  id: string;
  name: string;
  version: number;
  status: string;
  basis: string;
  quality_weights: Record<string, number>;
  applicability_weights: Record<string, number>;
  verification_weights: Record<string, number>;
  freshness_half_life_days: Record<
    string,
    { halfLifeDays: number; floor: number }
  >;
}

export async function listEvidenceConfidenceProfiles(): Promise<
  EvidenceConfidenceProfileRow[]
> {
  const { data, error } = await supabase
    .from("evidence_confidence_profiles")
    .select(
      "id, name, version, status, basis, quality_weights, applicability_weights, verification_weights, freshness_half_life_days",
    )
    .order("status")
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EvidenceConfidenceProfileRow[];
}

export interface CaseStakeholderOption {
  id: string;
  name: string;
  stakeholder_type: string;
  external_organization: string | null;
  role_or_relationship: string;
}

export async function listStakeholders(): Promise<CaseStakeholderOption[]> {
  const { data, error } = await supabase
    .from("risk_stakeholders")
    .select(
      "id, name, stakeholder_type, external_organization, role_or_relationship",
    )
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CaseStakeholderOption[];
}

export async function registerStakeholder(input: {
  name: string;
  stakeholderType: string;
  roleOrRelationship: string;
  externalOrganization?: string | null;
}): Promise<{ stakeholder_id: string }> {
  const { data, error } = await supabase.rpc("upsert_risk_stakeholder", {
    p_stakeholder: {
      name: input.name,
      stakeholder_type: input.stakeholderType,
      role_or_relationship: input.roleOrRelationship,
      external_organization: input.externalOrganization ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not register the stakeholder");
}

// ---------------------------------------------------------------------------
// Slice 3D — the gate review workflow (D3.31), the three agents
// (D12.06/D12.08/D12.12) and the assurance case (D13.06).
//
// Same discipline as every slice above: reads are RPCs, writes are definer
// RPCs, and a refusal is thrown with the SERVER's own words. The agent calls
// are edge-function invocations that return advisory payloads — none of them
// can write a determination, and each says so in its own disclaimer, which
// the surfaces render verbatim rather than paraphrasing.
// ---------------------------------------------------------------------------

export interface GateReviewSodPair {
  pair: string;
  label: string;
  applies: boolean;
  clear: boolean;
  reason: string;
  intensityLevel?: string | null;
}

export interface GateReviewSod {
  actorId: string | null;
  actorRole: string | null;
  isSponsorOrCreator: boolean;
  mayRecord: boolean;
  blockedBy: string[];
  pairs: GateReviewSodPair[];
}

export interface AssembledEvidence {
  id: string;
  evidenceClass: string | null;
  verificationStatus: string;
  description: string | null;
  sourceSystem: string | null;
  sourceReference: string | null;
  observedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  link: string;
  confidence: {
    evidenceConfidence?: number;
    error?: string;
    refusal?: string;
    missingFactors?: string[];
  };
}

export interface AssembledRequirement {
  id: number;
  criterion: string;
  category: string;
  isMandatory: boolean;
  weight: number;
  sourceAuthority: string;
  evidenceType: string | null;
  status: string;
  findingEvidence: string | null;
  deliverables: { total: number; accepted: number };
  assembled: {
    criterionId: number;
    deliverables: {
      id: string;
      title: string;
      status: string;
      revision: string;
      acceptedAt: string | null;
      acceptedBy: string | null;
      owner: string | null;
    }[];
    evidence: AssembledEvidence[];
    evidenceCount: number;
    /** Linked items bound to a risk this reader may not read. The assembly is
     *  SECURITY DEFINER, so the ladder is applied by hand there; the count is
     *  returned (and named in `statement`) rather than the list being silently
     *  short. */
    withheldCount: number;
    verifiedCount: number;
    statement: string;
  };
  activeWaiver: {
    id: string;
    status: string;
    expiresAt: string;
    justification: string;
  } | null;
}

export interface GateReviewPack {
  caseId: string;
  caseTitle: string;
  gateId: number;
  gateName: string;
  decisionType: string;
  independentAssuranceRequired: boolean;
  readiness: GateReadinessResult;
  requirements: AssembledRequirement[];
  waivers: {
    id: string;
    requirementId: number | null;
    status: string;
    justification: string;
    expiresAt: string;
  }[];
  assurance: GateReadinessResult["assurance"] | null;
  evidenceConfidence: Record<string, unknown>;
  sod: GateReviewSod;
  openSession: {
    id: number;
    status: string;
    openedAt: string;
    openedBy: string | null;
    openedById: string | null;
    reviewId: number | null;
    decidedAt: string | null;
  } | null;
}

export async function getGateReviewPack(
  caseId: string,
  gateId: number,
): Promise<GateReviewPack> {
  const { data, error } = await supabase.rpc("get_gate_review_pack", {
    p_case_id: caseId,
    p_gate_id: gateId,
  });
  return unwrap(data, error);
}

export async function openGateReview(
  caseId: string,
  gateId: number,
): Promise<{
  session_id: number;
  gate: string;
  outstanding_obligations: number;
  may_record: boolean;
  sod: GateReviewSod;
}> {
  const { data, error } = await supabase.rpc("open_gate_review", {
    p_case_id: caseId,
    p_gate_id: gateId,
  });
  return unwrap(data, error);
}

export async function recordGateReviewOutcome(input: {
  sessionId: number;
  outcome: string;
  note: string;
  findings: GateFindingInput[];
  conditions: GateConditionInput[];
  fundingAnswer?: string | null;
}): Promise<{
  review_id: number;
  outcome: string;
  session_id: number;
  waived_mandatory?: string[];
}> {
  const { data, error } = await supabase.rpc("record_gate_review_outcome", {
    p_session_id: input.sessionId,
    p_outcome: input.outcome,
    p_note: input.note,
    p_findings: input.findings,
    p_conditions: input.conditions,
    p_funding_answer: input.fundingAnswer ?? null,
  });
  return unwrap(data, error);
}

export async function abandonGateReview(
  sessionId: number,
  reason: string,
): Promise<{ session_id: number; status: string }> {
  const { data, error } = await supabase.rpc("abandon_gate_review", {
    p_session_id: sessionId,
    p_reason: reason,
  });
  return unwrap(data, error);
}

// --- D12.08 Gate Agent ------------------------------------------------------

export interface GateAgentResult {
  advisory: true;
  caseId: string;
  gateId: number;
  reading: {
    headline: string;
    blockerLines: string[];
    projectionLine: string;
  };
  narrative: string | null;
  model: string | null;
  providerNote: string | null;
  recorded: { report_id: number; blocked: boolean } | null;
  recordNote: string | null;
  disclaimer: string;
}

export async function runGateAgent(input: {
  caseId: string;
  gateId: number;
  record?: boolean;
}): Promise<GateAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-gate-agent",
    {
      body: {
        case_id: input.caseId,
        gate_id: input.gateId,
        record: input.record ?? false,
      },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as GateAgentResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as GateAgentResult;
}

export interface GateAgentReportRow {
  id: number;
  gateId: number;
  gate: string | null;
  asAt: string;
  readinessPct: number | null;
  blocked: boolean;
  blockerCount: number;
  narrative: string | null;
  model: string | null;
  agentKey: string;
  advisory: boolean;
  requestedBy: string | null;
}

export async function getGateAgentReports(
  caseId: string,
  gateId?: number,
): Promise<{ caseId: string; reports: GateAgentReportRow[] }> {
  const { data, error } = await supabase.rpc("get_gate_agent_reports", {
    p_case_id: caseId,
    p_gate_id: gateId ?? null,
  });
  return unwrap(data, error);
}

// --- D12.06 Methodology Agent ----------------------------------------------

export interface FrameworkProposalResult {
  advisory: true;
  documentId: string;
  documentTitle: string;
  model?: string | null;
  proposal: {
    name: string;
    basis: string;
    summary: string;
    stages: { stage_key: string; sequence: number; display_name: string }[];
    gates: { stage_key: string; name: string; decision_type: string }[];
    requirements: { gate: string; criterion: string; is_mandatory: boolean }[];
  } | null;
  droppedElements?: string[];
  refusal?: string;
  recorded: {
    proposal_id: string;
    framework_id: string;
    stages: number;
    gates: number;
    requirements: number;
    note: string;
  } | null;
  recordNote?: string | null;
  disclaimer?: string;
}

export async function runMethodologyAgent(input: {
  documentId: string;
  query?: string;
  record?: boolean;
}): Promise<FrameworkProposalResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-methodology-agent",
    {
      body: {
        document_id: input.documentId,
        query: input.query ?? null,
        record: input.record ?? false,
      },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as FrameworkProposalResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as FrameworkProposalResult;
}

export interface FrameworkShelfEntry {
  id: string;
  name: string;
  version: number;
  status?: string;
  sourceAuthority: string;
  machineProposed?: boolean;
  stages?: number;
  gates: number;
  requirements?: number;
  /** What adoption arms: one mandatory requirement blocks its gate at any
   *  readiness percentage (D3.35), and an independence flag changes who may
   *  record the decision. Counts, not a promise. */
  mandatoryRequirements?: number;
  independentAssuranceGates?: number;
  /** Requirement count per provenance tier, so a shelf of AI_SUGGESTION rows
   *  cannot look like a shelf of REGULATION rows. */
  requirementTiers?: Record<string, number>;
  /** The adopted framework this draft would SUPERSEDE, or null. Adoption
   *  supersedes every adopted framework of the same name and re-points every
   *  tailoring rule naming it, so it is stated before the click. */
  willSupersede?: {
    id: string;
    name: string;
    version: number;
    sourceAuthority: string;
    adoptedAt: string | null;
  } | null;
  adoptedAt?: string | null;
  adoptedBy?: string | null;
}

export interface FrameworkShelf {
  proposals: {
    id: string;
    summary: string;
    agentKey: string;
    model: string | null;
    status: string;
    withdrawnReason: string | null;
    createdAt: string;
    proposedBy: string | null;
    document: string | null;
    documentId: string;
    framework: FrameworkShelfEntry;
  }[];
  drafts: FrameworkShelfEntry[];
  adopted: FrameworkShelfEntry[];
}

export async function getFrameworkShelf(): Promise<FrameworkShelf> {
  const { data, error } = await supabase.rpc("get_framework_shelf");
  return unwrap(data, error);
}

/** D3.02 / D12.06: the human act. The DB refuses the AI-operator identity. */
export async function adoptProjectFramework(
  frameworkId: string,
  note: string,
): Promise<{
  framework_id: string;
  status: string;
  name: string;
  version: number;
}> {
  const { data, error } = await supabase.rpc("adopt_project_framework", {
    p_framework_id: frameworkId,
    p_note: note,
  });
  return unwrap(data, error);
}

/** D3.35 / D3.01: an adopted framework is immutable — this drafts the next. */
export async function createProjectFrameworkVersion(
  sourceId: string,
): Promise<{ framework_id: string; version: number; status: string }> {
  const { data, error } = await supabase.rpc(
    "create_project_framework_version",
    {
      p_source_id: sourceId,
    },
  );
  return unwrap(data, error);
}

/** D3.24: a gate on a DRAFT framework. */
export async function addFrameworkGate(input: {
  frameworkId: string;
  stageKey: string;
  name: string;
  sequence: number;
  decisionType: string;
  independentAssuranceRequired?: boolean;
  readinessThreshold?: number | null;
}): Promise<{ gate_id: number; decision_type: string }> {
  const { data, error } = await supabase.rpc("add_framework_gate", {
    p_framework_id: input.frameworkId,
    p_stage_key: input.stageKey,
    p_name: input.name,
    p_sequence: input.sequence,
    p_decision_type: input.decisionType,
    p_readiness_threshold: input.readinessThreshold ?? null,
    p_independent_assurance_required:
      input.independentAssuranceRequired ?? false,
  });
  return unwrap(data, error);
}

/** D3.14 / D3.35: a requirement, its provenance tier and its weight. */
export async function setGateRequirement(input: {
  gateId: number;
  criterion: string;
  isMandatory: boolean;
  sourceAuthority: string;
  category?: string | null;
  evidenceType?: string | null;
  guidance?: string | null;
  weight?: number;
}): Promise<{
  criterion_id: number;
  source_authority: string;
  weight: number;
}> {
  const { data, error } = await supabase.rpc("set_gate_requirement", {
    p_gate_id: input.gateId,
    p_criterion: input.criterion,
    p_is_mandatory: input.isMandatory,
    p_source_authority: input.sourceAuthority,
    p_category: input.category ?? null,
    p_evidence_type: input.evidenceType ?? null,
    p_guidance: input.guidance ?? null,
    p_weight: input.weight ?? 1.0,
  });
  return unwrap(data, error);
}

export async function withdrawFrameworkProposal(
  proposalId: string,
  reason: string,
): Promise<{ proposal_id: string; status: string }> {
  const { data, error } = await supabase.rpc("withdraw_framework_proposal", {
    p_proposal_id: proposalId,
    p_reason: reason,
  });
  return unwrap(data, error);
}

/** D3.03: authoring a tailoring rule / moving a value threshold on a DRAFT. */
export async function addTailoringRule(input: {
  ruleSetId: string;
  priority: number;
  description: string;
  lifecycleTypes?: string[] | null;
  minValueUsd?: number | null;
  maxValueUsd?: number | null;
  minIntensity?: string | null;
  maxIntensity?: string | null;
  frameworkName: string;
  intensityFloor?: string | null;
}): Promise<{ rule_id: string; priority: number }> {
  const { data, error } = await supabase.rpc("add_tailoring_rule", {
    p_rule_set_id: input.ruleSetId,
    p_priority: input.priority,
    p_description: input.description,
    p_framework_name: input.frameworkName,
    p_lifecycle_types: input.lifecycleTypes ?? [],
    p_min_value_usd: input.minValueUsd ?? null,
    p_max_value_usd: input.maxValueUsd ?? null,
    p_min_intensity: input.minIntensity ?? null,
    p_max_intensity: input.maxIntensity ?? null,
    p_intensity_floor: input.intensityFloor ?? null,
  });
  return unwrap(data, error);
}

export async function setRuleSetThresholds(
  ruleSetId: string,
  thresholds: Record<string, number>,
): Promise<{ rule_set_id: string }> {
  const { data, error } = await supabase.rpc("set_rule_set_thresholds", {
    p_rule_set_id: ruleSetId,
    p_value_thresholds: thresholds,
  });
  return unwrap(data, error);
}

// --- D12.12 Risk Agent ------------------------------------------------------

export interface TreatmentAdviceRow {
  id: string;
  riskId: string;
  riskTitle: string;
  riskLevel: string | null;
  workflowStep: string;
  recommendedStrategy: string;
  label: string;
  rationale: string;
  limitations: string;
  expectedResidual: number;
  expectedIntroduced: number;
  model: string | null;
  agent: string | null;
  /** Who ran the agent. The row is attributed to an advisory agent; this is
   *  the human account the RPC was called under, so agent output and a
   *  hand-written row are distinguishable on the screen. */
  proposedBy: string | null;
  adoptedBy: string | null;
  dismissedBy: string | null;
  status: string;
  adoptedTreatmentId: string | null;
  dismissedReason: string | null;
  createdAt: string;
  advisory: true;
}

export async function getCaseTreatmentAdvice(
  caseId: string,
): Promise<{ caseId: string; advice: TreatmentAdviceRow[] }> {
  const { data, error } = await supabase.rpc("get_case_treatment_advice", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export interface RiskAgentResult {
  advisory: true;
  riskId: string;
  riskTitle: string;
  workflowStep: string;
  workflowReason: string;
  candidates: { strategy: string; reason: string }[];
  advice: {
    recommended_strategy: string;
    label: string;
    rationale: string;
    expected_residual: number;
    expected_introduced: number;
    limitations: string;
  } | null;
  refusal?: string;
  model?: string | null;
  recorded: { advice_id: string; status: string } | null;
  recordNote?: string | null;
  disclaimer: string;
}

export async function runRiskAgent(input: {
  riskId: string;
  record?: boolean;
}): Promise<RiskAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-risk-agent",
    {
      body: { risk_id: input.riskId, record: input.record ?? false },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as RiskAgentResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as RiskAgentResult;
}

export async function dismissTreatmentAdvice(
  adviceId: string,
  reason: string,
): Promise<{ advice_id: string; status: string }> {
  const { data, error } = await supabase.rpc("dismiss_risk_treatment_advice", {
    p_advice_id: adviceId,
    p_reason: reason,
  });
  return unwrap(data, error);
}

export async function adoptTreatmentAdvice(
  adviceId: string,
  option: Record<string, unknown>,
): Promise<{ advice_id: string; recommendation_id: string }> {
  const { data, error } = await supabase.rpc("adopt_risk_treatment_advice", {
    p_advice_id: adviceId,
    p_option: option,
  });
  return unwrap(data, error);
}

// --- D13.06 Assurance Case --------------------------------------------------

export interface AssuranceClaimEvidence {
  linkId: string;
  evidenceId: string;
  bearing: "supports" | "contradicts" | "qualifies";
  basis: string;
  linkedAt: string;
  linkedBy: string | null;
  evidenceClass: string | null;
  verificationStatus: string;
  description: string | null;
  sourceSystem: string | null;
  observedAt: string | null;
  confidence: {
    evidenceConfidence?: number;
    error?: string;
    refusal?: string;
    missingFactors?: string[];
  };
}

export interface AssuranceClaim {
  id: string;
  claimRef: string;
  statement: string;
  claimType: string;
  successOutcomeId: string | null;
  requirementId: number | null;
  owner: string | null;
  position: "open" | "supported" | "refuted" | "withdrawn";
  positionBasis: string | null;
  positionAt: string | null;
  positionBy: string | null;
  evidence: AssuranceClaimEvidence[];
  supportingCount: number;
  contradictingCount: number;
  /** Links this reader is not being shown, under the risk-sensitivity ladder.
   *  The read is SECURITY INVOKER, so a reader below a linked item's position
   *  sees the claim without it; the count says so rather than rendering a
   *  shorter list that looks complete. */
  withheldCount: number;
  confidence: {
    scoredCount: number;
    unscoredCount: number;
    highest: number | null;
    lowest: number | null;
    statement: string;
  };
}

export interface CaseAssuranceCase {
  caseId: string;
  caseTitle: string;
  claims: AssuranceClaim[];
  claimCount: number;
  independentReview: {
    required: boolean;
    demandedLevel: string;
    satisfied: boolean;
    reviews: {
      id: string;
      level: string;
      status: string;
      conclusion: string | null;
      reviewer: string | null;
      competencies: string[];
      conflictsDeclaredAt: string | null;
      completedAt: string | null;
    }[];
  };
  assumptions: {
    id: string;
    statement: string;
    status: string;
    confidence: number;
    validUntil: string | null;
    triggerForReview: string;
    invalidationReason: string | null;
    owner: string | null;
  }[];
  openIssues: {
    risks: { id: string; title: string; level: string; status: string }[];
    conditions: {
      id: number;
      description: string;
      dueDate: string;
      overdue: boolean;
    }[];
    uncoveredCommitments: Record<string, unknown>[];
  };
  evidenceConfidenceProfile: {
    id: string;
    name: string;
    version: number;
  } | null;
}

export async function getCaseAssuranceCase(
  caseId: string,
): Promise<CaseAssuranceCase> {
  const { data, error } = await supabase.rpc("get_case_assurance_case", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function recordAssuranceClaim(input: {
  caseId: string;
  claimRef: string;
  statement: string;
  claimType: string;
  ownerId: string;
  successOutcomeId?: string | null;
  requirementId?: number | null;
}): Promise<{ claim_id: string; claim_ref: string; position: string }> {
  const { data, error } = await supabase.rpc("record_assurance_claim", {
    p_case_id: input.caseId,
    p_claim: {
      claim_ref: input.claimRef,
      statement: input.statement,
      claim_type: input.claimType,
      owner_id: input.ownerId,
      success_outcome_id: input.successOutcomeId ?? null,
      requirement_id: input.requirementId ?? null,
    },
  });
  return unwrap(data, error);
}

export async function linkAssuranceClaimEvidence(input: {
  claimId: string;
  evidenceId: string;
  basis: string;
  bearing: string;
}): Promise<{ link_id: string; claim_id: string; bearing: string }> {
  const { data, error } = await supabase.rpc("link_assurance_claim_evidence", {
    p_claim_id: input.claimId,
    p_evidence_id: input.evidenceId,
    p_basis: input.basis,
    p_bearing: input.bearing,
  });
  return unwrap(data, error);
}

export async function unlinkAssuranceClaimEvidence(
  linkId: string,
  reason: string,
): Promise<{ link_id: string; removed: boolean }> {
  const { data, error } = await supabase.rpc(
    "unlink_assurance_claim_evidence",
    {
      p_link_id: linkId,
      p_reason: reason,
    },
  );
  return unwrap(data, error);
}

export async function setAssuranceClaimPosition(input: {
  claimId: string;
  position: string;
  basis: string;
}): Promise<{ claim_id: string; position: string }> {
  const { data, error } = await supabase.rpc("set_assurance_claim_position", {
    p_claim_id: input.claimId,
    p_position: input.position,
    p_basis: input.basis,
  });
  return unwrap(data, error);
}

/* ─────────────────── Slice 4A — Integrated Controls ──────────────────── */
/**
 * D5.01–D5.04, D5.28, D5.29, D11.29. Every write is a definer RPC; every
 * READ that produces a NUMBER goes through a compute_* RPC that records a
 * calculation_runs row, so nothing on the controls surface is a figure with
 * no lineage behind it.
 */

export async function getCaseControls(caseId: string): Promise<CaseControls> {
  const { data, error } = await supabase.rpc("get_case_controls", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function recordScopeNeed(input: {
  caseId: string;
  needRef: string;
  statement: string;
  ownerId: string;
  sourceAuthority?: string;
}): Promise<{ need_id: string; need_ref: string }> {
  const { data, error } = await supabase.rpc("record_scope_need", {
    p_case_id: input.caseId,
    p_need: {
      need_ref: input.needRef,
      statement: input.statement,
      owner_id: input.ownerId,
      source_authority: input.sourceAuthority ?? "PROJECT_FRAMEWORK",
    },
  });
  return unwrap(data, error);
}

export async function recordCbsCode(input: {
  caseId: string;
  cbsCode: string;
  title: string;
  costType: string;
}): Promise<{ cbs_code_id: string; cbs_code: string }> {
  const { data, error } = await supabase.rpc("record_cbs_code", {
    p_case_id: input.caseId,
    p_code: {
      cbs_code: input.cbsCode,
      title: input.title,
      cost_type: input.costType,
    },
  });
  return unwrap(data, error);
}

export async function recordWbsElement(input: {
  caseId: string;
  wbsCode: string;
  title: string;
  scopeDescription: string;
  parentWbsCode?: string | null;
  systemNodeId?: string | null;
}): Promise<{ wbs_element_id: string; wbs_code: string; depth: number }> {
  const { data, error } = await supabase.rpc("record_wbs_element", {
    p_case_id: input.caseId,
    p_element: {
      wbs_code: input.wbsCode,
      title: input.title,
      scope_description: input.scopeDescription,
      parent_wbs_code: input.parentWbsCode ?? null,
      system_node_id: input.systemNodeId ?? null,
    },
  });
  return unwrap(data, error);
}

export async function linkRequirementToNeed(input: {
  requirementId: number;
  needId: string;
}): Promise<{ requirement_ref: string; need_ref: string }> {
  const { data, error } = await supabase.rpc("link_requirement_to_need", {
    p_requirement_id: input.requirementId,
    p_need_id: input.needId,
  });
  return unwrap(data, error);
}

export async function linkRequirementToWbs(input: {
  requirementId: number;
  wbsElementId: string;
}): Promise<{ link_id: string; requirement_ref: string; wbs_code: string }> {
  const { data, error } = await supabase.rpc("link_requirement_to_wbs", {
    p_requirement_id: input.requirementId,
    p_wbs_element_id: input.wbsElementId,
  });
  return unwrap(data, error);
}

export async function designateControlAccount(input: {
  caseId: string;
  controlAccountRef: string;
  wbsCode: string;
  cbsCode: string;
  accountableOwnerId: string;
}): Promise<{ control_account_id: string; control_account_ref: string }> {
  const { data, error } = await supabase.rpc("designate_control_account", {
    p_case_id: input.caseId,
    p_account: {
      control_account_ref: input.controlAccountRef,
      wbs_code: input.wbsCode,
      cbs_code: input.cbsCode,
      accountable_owner_id: input.accountableOwnerId,
    },
  });
  return unwrap(data, error);
}

export async function recordLocalScheduleActivity(input: {
  caseId: string;
  activityId: string;
  description: string;
  durationHours: string;
  plannedStart?: string | null;
  plannedFinish?: string | null;
  wbsCode?: string | null;
}): Promise<{ activity_id: number; activity_key: string; origin: string }> {
  const { data, error } = await supabase.rpc("record_local_schedule_activity", {
    p_case_id: input.caseId,
    p_activity: {
      activity_id: input.activityId,
      description: input.description,
      duration_hours: input.durationHours,
      planned_start: input.plannedStart || null,
      planned_finish: input.plannedFinish || null,
      wbs_code: input.wbsCode || null,
    },
  });
  return unwrap(data, error);
}

export async function setScheduleActivityWbs(input: {
  activityId: number;
  wbsCode: string | null;
}): Promise<{
  activity_id: number;
  activity_key: string;
  origin: string;
  wbs_code: string | null;
}> {
  const { data, error } = await supabase.rpc("set_schedule_activity_wbs", {
    p_activity_id: input.activityId,
    p_wbs_code: input.wbsCode,
  });
  return unwrap(data, error);
}

export async function recordCostItem(input: {
  caseId: string;
  costItemRef: string;
  wbsCode: string;
  cbsCode: string;
  description: string;
  basis: string;
  currency?: string;
  baselineCost?: string | null;
  commitment?: string | null;
  actual?: string | null;
  forecast?: string | null;
  contingency?: string | null;
  contingencyBasis?: string | null;
}): Promise<{
  cost_item_id: string;
  cost_item_ref: string;
  wbs_code: string;
  revised: boolean;
}> {
  const { data, error } = await supabase.rpc("record_cost_item", {
    p_case_id: input.caseId,
    p_item: {
      cost_item_ref: input.costItemRef,
      wbs_code: input.wbsCode,
      cbs_code: input.cbsCode,
      description: input.description,
      basis: input.basis,
      currency: input.currency ?? "CAD",
      baseline_cost: input.baselineCost || null,
      commitment: input.commitment || null,
      actual: input.actual || null,
      forecast: input.forecast || null,
      contingency: input.contingency || null,
      contingency_basis: input.contingencyBasis || null,
    },
  });
  return unwrap(data, error);
}

export async function attributePostBaselineScope(input: {
  caseId: string;
  changeRef: string;
  description: string;
  origin: string;
  wbsCode: string;
  addedAt: string;
  costEffect?: string | null;
  costBasis?: string | null;
  approvedChangeRef?: string | null;
}): Promise<{
  scope_change_id: string;
  change_ref: string;
  baseline_version: number;
}> {
  const { data, error } = await supabase.rpc("attribute_post_baseline_scope", {
    p_case_id: input.caseId,
    p_change: {
      change_ref: input.changeRef,
      description: input.description,
      origin: input.origin,
      wbs_code: input.wbsCode,
      added_at: input.addedAt,
      cost_effect: input.costEffect || null,
      cost_basis: input.costBasis || null,
      approved_change_ref: input.approvedChangeRef || null,
    },
  });
  return unwrap(data, error);
}

export async function captureControlsBaselineStructure(input: {
  baselineId: string;
  structure: string;
}): Promise<{
  capture_id: string;
  structure: string;
  element_count: number;
  digest: string;
}> {
  const { data, error } = await supabase.rpc(
    "capture_controls_baseline_structure",
    { p_baseline_id: input.baselineId, p_structure: input.structure },
  );
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseScopeGrowth(
  caseId: string,
): Promise<ScopeGrowth> {
  const { data, error } = await supabase.rpc("compute_case_scope_growth", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseCostReconciliation(
  caseId: string,
): Promise<CostReconciliation> {
  const { data, error } = await supabase.rpc(
    "compute_case_cost_reconciliation",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

export async function getCaseCalculationLineage(
  caseId: string,
  limit = 20,
): Promise<{ caseId: string; runs: CalculationRun[] }> {
  const { data, error } = await supabase.rpc("get_case_calculation_lineage", {
    p_case_id: caseId,
    p_limit: limit,
  });
  return unwrap(data, error);
}

/** The case's baselines, for the controls-capture act. Rides RLS. */
export async function listCaseBaselines(caseId: string): Promise<
  {
    id: string;
    baseline_type: string;
    version: number;
    status: string;
    approved_at: string | null;
  }[]
> {
  const { data, error } = await supabase
    .from("development_baselines")
    .select("id, baseline_type, version, status, approved_at")
    .eq("development_case_id", caseId)
    .eq("status", "approved")
    .order("baseline_type");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Case-scoped requirements, for the scope-chain link acts. Rides RLS. */
/**
 * Change a business need's status (D5.01).
 *
 * 'met' and 'withdrawn' were a vocabulary the product could not produce: the
 * column carried three values and no act could reach two of them, so the
 * traceability report filtered on a state nothing could set. Withdrawing
 * takes a need out of the chain and un-traces every requirement that rested
 * on it, which is why the reason is mandatory server-side.
 */
export async function setScopeNeedStatus(input: {
  needId: string;
  status: "open" | "met" | "withdrawn";
  reason?: string | null;
}): Promise<{ need_id: string; need_ref: string; status: string }> {
  const { data, error } = await supabase.rpc("set_scope_need_status", {
    p_need_id: input.needId,
    p_status: input.status,
    p_reason: input.reason ?? null,
  });
  return unwrap(data, error);
}

export async function listCaseRequirements(caseId: string): Promise<
  {
    id: number;
    requirement_ref: string;
    category: string;
    requirement: string;
    scope_need_id: string | null;
  }[]
> {
  const { data, error } = await supabase
    .from("design_requirements")
    .select("id, requirement_ref, category, requirement, scope_need_id")
    .eq("development_case_id", caseId)
    .order("requirement_ref");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ────────────────── Slice 4B — Performance & earned value ─────────────── */
/**
 * D5.05, D5.06, D5.16, D5.17, D5.20, D5.07/D5.32, D11.29. Same posture as
 * Slice 4A: every write is a definer RPC, and every READ that produces a
 * NUMBER goes through a compute_* RPC that records a calculation_runs row —
 * so nothing on the performance surface is a figure with no lineage behind
 * it, and nothing on it is a percentile with no distribution behind it.
 */

export async function getCasePerformance(
  caseId: string,
): Promise<CasePerformance> {
  const { data, error } = await supabase.rpc("get_case_performance", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function recordRuleOfCredit(input: {
  caseId: string;
  ruleRef: string;
  title: string;
  appliesTo: string;
  basis: string;
  steps: { step: string; weight: number }[];
}): Promise<{
  rule_id: string;
  rule_ref: string;
  applies_to: string;
  step_count: number;
}> {
  const { data, error } = await supabase.rpc("record_rule_of_credit", {
    p_case_id: input.caseId,
    p_rule: {
      rule_ref: input.ruleRef,
      title: input.title,
      applies_to: input.appliesTo,
      basis: input.basis,
      steps: input.steps,
    },
  });
  return unwrap(data, error);
}

export async function openProgressPeriod(input: {
  caseId: string;
  periodRef: string;
  periodEnd: string;
}): Promise<{
  period_id: string;
  period_ref: string;
  period_end: string;
  status: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("open_progress_period", {
    p_case_id: input.caseId,
    p_period: { period_ref: input.periodRef, period_end: input.periodEnd },
  });
  return unwrap(data, error);
}

/** §70: setting the planned curve is setting a baseline. */
export async function setPeriodPlannedProgress(input: {
  periodId: string;
  percent: string;
  basis: string;
}): Promise<{
  period_id: string;
  period_ref: string;
  planned_percent_complete: number;
}> {
  const { data, error } = await supabase.rpc("set_period_planned_progress", {
    p_period_id: input.periodId,
    p_percent: input.percent,
    p_basis: input.basis,
  });
  return unwrap(data, error);
}

export async function closeProgressPeriod(input: {
  periodId: string;
  note: string;
}): Promise<{
  period_id: string;
  period_ref: string;
  status: string;
  recorded_runs_in_period: number;
  note: string;
}> {
  const { data, error } = await supabase.rpc("close_progress_period", {
    p_period_id: input.periodId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

/**
 * §70: naming an element's work type decides which rule of credit governs
 * every percent complete it will ever report.
 */
export async function setWbsElementWorkType(input: {
  caseId: string;
  wbsCode: string;
  workType: string;
  basis: string;
}): Promise<{
  wbs_code: string;
  work_type: string;
  rule_of_credit: string | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("set_wbs_element_work_type", {
    p_case_id: input.caseId,
    p_element: {
      wbs_code: input.wbsCode,
      work_type: input.workType,
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

/**
 * The claim NAMES A STEP; the percent comes back derived from the rule.
 *
 * There is no `appliesTo` parameter: the rule of credit is resolved from the
 * work type recorded ON THE ELEMENT. A caller that could nominate the work
 * type could nominate the rule, and a rule nominated at claim time is a
 * percent chosen at claim time.
 */
export async function recordProgressClaim(input: {
  periodId: string;
  wbsCode: string;
  stepIndex: number;
  basis: string;
}): Promise<{
  claim_id: string;
  wbs_code: string;
  work_type: string;
  rule_ref: string;
  step_index: number;
  claimed_percent: number;
  previous_percent: number | null;
  regression: boolean;
}> {
  const { data, error } = await supabase.rpc("record_progress_claim", {
    p_period_id: input.periodId,
    p_claim: {
      wbs_code: input.wbsCode,
      step_index: String(input.stepIndex),
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

export async function recordProgressEvidence(input: {
  periodId: string;
  wbsCode: string;
  evidenceSource: string;
  observedComplete: string;
  observedTotal: string;
  unit: string;
  basis: string;
}): Promise<{
  evidence_id: string;
  wbs_code: string;
  evidence_source: string;
  observed_percent: number;
}> {
  const { data, error } = await supabase.rpc("record_progress_evidence", {
    p_period_id: input.periodId,
    p_evidence: {
      wbs_code: input.wbsCode,
      evidence_source: input.evidenceSource,
      observed_complete: input.observedComplete,
      observed_total: input.observedTotal,
      unit: input.unit,
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

/** All eight dimensions, or a refusal naming the one that is missing. */
export async function recordEstimateBasis(input: {
  caseId: string;
  estimateClass: string;
  scopeMaturity: string;
  quantityBasedPercent: string;
  quotationSupport: string;
  supportingQuotationCount: string;
  escalationBasis: string;
  productivityBasis: string;
  exclusions: string;
  contingencyBasis: string;
}): Promise<{
  estimate_basis_id: string;
  version: number;
  estimate_class: string;
  confidence: EstimateConfidence;
}> {
  const { data, error } = await supabase.rpc("record_estimate_basis", {
    p_case_id: input.caseId,
    p_basis: {
      estimate_class: input.estimateClass,
      scope_maturity: input.scopeMaturity,
      quantity_based_percent: input.quantityBasedPercent,
      quotation_support: input.quotationSupport,
      supporting_quotation_count: input.supportingQuotationCount,
      escalation_basis: input.escalationBasis,
      productivity_basis: input.productivityBasis,
      exclusions: input.exclusions,
      contingency_basis: input.contingencyBasis,
    },
  });
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseEarnedValue(
  caseId: string,
): Promise<CaseEarnedValue> {
  const { data, error } = await supabase.rpc("compute_case_earned_value", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseProgressIntegrity(
  caseId: string,
): Promise<CaseProgressIntegrity> {
  const { data, error } = await supabase.rpc(
    "compute_case_progress_integrity",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseEstimateConfidence(
  caseId: string,
): Promise<EstimateConfidence> {
  const { data, error } = await supabase.rpc(
    "compute_case_estimate_confidence",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29). */
export async function computeCaseForecastConfidence(
  caseId: string,
): Promise<ForecastConfidence> {
  const { data, error } = await supabase.rpc(
    "compute_case_forecast_confidence",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/** Computes AND records the lineage row (D11.29) — a run citing runs. */
export async function computeCasePerformanceTrend(
  caseId: string,
): Promise<CasePerformanceTrend> {
  const { data, error } = await supabase.rpc("compute_case_performance_trend", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/* ────────── Slice 4C — Schedule assurance, gating and simulation ───────── */
/**
 * D5.13/D5.31/D5.14 (diagnose and score), D5.08 (the risk→schedule→economics
 * chain), D5.15 (the gated simulation), D5.09 (per-risk attribution),
 * D5.07/D5.32 (the percentiles that finally exist), D11.29 (the modelling
 * kernel records a lineage run).
 *
 * THE ONE THING TO UNDERSTAND ABOUT THIS SECTION. The Monte Carlo runs HERE,
 * in the browser, in `src/lib/modelling/integrated-risk.ts` — one simulator,
 * never two. It does not therefore get to decide what is recorded: the server
 * hands out the inputs WITH their digest and its own gate verdict, and
 * `record_case_schedule_simulation` re-runs the gate, re-computes the digest
 * and refuses anything that does not match. So a modified client can compute
 * whatever it likes and cannot get it into the ledger.
 */

/** D5.13/D5.31/D5.14. Computes AND records the lineage row (D11.29). */
export async function computeCaseScheduleQuality(
  caseId: string,
): Promise<CaseScheduleQuality> {
  const { data, error } = await supabase.rpc("compute_case_schedule_quality", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** D5.08. Computes AND records the lineage row (D11.29). */
export async function computeCaseRiskScheduleEconomics(
  caseId: string,
): Promise<CaseRiskScheduleChain> {
  const { data, error } = await supabase.rpc(
    "compute_case_risk_schedule_economics",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/** D5.08. §70: refused to the AI-operator identity at the server. */
export async function recordRiskScheduleImpact(input: {
  caseId: string;
  riskId: string;
  activityKey: string;
  probability: string;
  delayDaysOptimistic: string;
  delayDaysLikely: string;
  delayDaysPessimistic: string;
  costOptimistic?: string;
  costLikely?: string;
  costPessimistic?: string;
  currency?: string;
  basis: string;
}): Promise<{
  impact_id: string;
  risk_title: string;
  activity_key: string;
  probability: number;
}> {
  const { data, error } = await supabase.rpc("record_risk_schedule_impact", {
    p_case_id: input.caseId,
    p_impact: {
      risk_id: input.riskId,
      activity_key: input.activityKey,
      probability: input.probability,
      delay_days_optimistic: input.delayDaysOptimistic,
      delay_days_likely: input.delayDaysLikely,
      delay_days_pessimistic: input.delayDaysPessimistic,
      cost_optimistic: input.costOptimistic ?? "",
      cost_likely: input.costLikely ?? "",
      cost_pessimistic: input.costPessimistic ?? "",
      currency: input.currency ?? "",
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

/** Sync-authored schedule logic (D5.13's lag and link-type inputs). */
export async function recordLocalScheduleRelationship(input: {
  caseId: string;
  activityKey: string;
  predecessorKey: string;
  linkType?: string;
  lagHours?: string;
}): Promise<{ activity_key: string; predecessor: string }> {
  const { data, error } = await supabase.rpc(
    "record_local_schedule_relationship",
    {
      p_case_id: input.caseId,
      p_relationship: {
        activity_id: input.activityKey,
        predecessor: input.predecessorKey,
        link_type: input.linkType ?? "",
        lag_hours: input.lagHours ?? "",
      },
    },
  );
  return unwrap(data, error);
}

/** The inputs the kernel consumes, with the digest they hash to. */
export async function getCaseSimulationInputs(
  caseId: string,
): Promise<SimulationInputs> {
  const { data, error } = await supabase.rpc("get_case_simulation_inputs", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/**
 * D5.15 + D5.09 + D11.29 — read the inputs, run the kernel, record the result.
 *
 * The seed is generated here and TRAVELS WITH THE RESULT into the recorded
 * run, which is what makes the numbers reproducible by anyone holding the
 * ledger row. `Math.random` is fine for CHOOSING a seed — the seed is not
 * itself a simulated quantity — and is emphatically not used inside the
 * simulation, which draws every sample from `mulberry32(seed)`.
 *
 * If the caller supplies a seed, that seed is used: re-running a recorded
 * simulation at its recorded seed is how somebody checks it.
 */
/**
 * D5.28 / D5.14 / D5.07 — state the duration range that IS the distribution.
 *
 * `optimistic_hours` and `pessimistic_hours` decide the width of every P80
 * this slice publishes and had no product write path at all: not the P6
 * import, not `recordLocalScheduleActivity`, nothing. So D5.14's "uncertainty
 * expressed" component was structurally zero for every customer and the only
 * ranges the transcript ever proved were injected by raw SQL. This is the
 * governed door: role-checked, §70-walled, bracketing the stated duration, and
 * carrying a mandatory basis, exactly as the risk's three-point delay does.
 */
export async function setScheduleActivityDurationRange(input: {
  caseId: string;
  activityId: string;
  optimisticHours: string;
  pessimisticHours: string;
  basis: string;
}): Promise<DurationRangeStatement> {
  const { data, error } = await supabase.rpc(
    "set_schedule_activity_duration_range",
    {
      p_case_id: input.caseId,
      p_range: {
        activity_id: input.activityId,
        optimistic_hours: input.optimisticHours,
        pessimistic_hours: input.pessimisticHours,
        basis: input.basis,
      },
    },
  );
  return unwrap(data, error);
}

export async function runCaseScheduleSimulation(input: {
  caseId: string;
  iterations?: number;
  seed?: number;
}): Promise<{
  simulation_id: string;
  calculation_run_id: string;
  seed: number;
  iterations: number;
  p50Hours: number;
  p80Hours: number;
  p80Finish: string | null;
  costP80: number | null;
  refusals: string[];
}> {
  const inputs = await getCaseSimulationInputs(input.caseId);

  const iterations = input.iterations ?? DEFAULT_SIMULATION_ITERATIONS;
  const seed =
    input.seed ?? Math.floor(Math.random() * 4294967296) % 4294967296;

  const result = simulateIntegratedRisk({
    activities: inputs.activities.map((a) => ({
      id: a.id,
      label: a.label,
      duration: Number(a.duration),
      optimistic: a.optimistic == null ? null : Number(a.optimistic),
      pessimistic: a.pessimistic == null ? null : Number(a.pessimistic),
      predecessors: a.predecessors ?? [],
    })),
    // The server's verdict on whether this schedule's LOGIC is logic the
    // kernel models. `criticalPath` reads every edge as finish-to-start with
    // zero lag, so a schedule using SS/FF/SF or lags is refused rather than
    // simulated over a network that is not the recorded one.
    logicSupport: inputs.logicSupport,
    maximumAttributedRisks: inputs.policy?.maximumAttributedRisks,
    risks: (inputs.risks ?? []).map((r) => ({
      riskId: r.riskId,
      riskTitle: r.riskTitle,
      // The node id is the activity ROW id, matching get_case_simulation_inputs:
      // task_key is unique per schedule, and a case holds two.
      activityId: String(r.activityId),
      probability: Number(r.probability),
      delayDaysOptimistic: Number(r.delayDaysOptimistic),
      delayDaysLikely: Number(r.delayDaysLikely),
      delayDaysPessimistic: Number(r.delayDaysPessimistic),
      costOptimistic:
        r.costOptimistic == null ? null : Number(r.costOptimistic),
      costLikely: r.costLikely == null ? null : Number(r.costLikely),
      costPessimistic:
        r.costPessimistic == null ? null : Number(r.costPessimistic),
    })),
    gate: inputs.gate,
    iterations,
    seed,
    delayCostPerDay:
      inputs.delayCostPerDay == null ? null : Number(inputs.delayCostPerDay),
    costBase: inputs.costBase == null ? null : Number(inputs.costBase),
    currency: inputs.currency,
  });

  // The kernel refuses for the same reasons the server does. Surfacing ITS
  // sentence rather than a client paraphrase keeps one wording for one rule.
  //
  // D5.15's SECOND half — "a refused simulation is a fact about the schedule
  // and belongs in the ledger beside the ones that ran" — used to be
  // unreachable from the product: the client applied the gate first and threw,
  // so the RPC's refusal-recording branch was reached only by the smoke. When
  // the refusal is the SERVER'S to make (the quality gate or the logic
  // support, both of which the server re-runs), the attempt is posted so the
  // server records it, and only then is the kernel's sentence surfaced. A
  // refusal the client can decide alone — nothing varies, no seed, no
  // iterations — is not posted, because there is no server verdict to record.
  if (!result.simulated) {
    const serverJudged =
      !inputs.gate?.permitted || inputs.logicSupport?.supported === false;
    if (serverJudged) {
      await supabase.rpc("record_case_schedule_simulation", {
        p_case_id: input.caseId,
        p_result: {
          seed: String(seed),
          iterations: String(iterations),
          kernelVersion: result.kernelVersion,
          activityDigest: inputs.digest.activityDigest,
          riskDigest: inputs.digest.riskDigest,
        },
      });
    }
    throw new Error(result.reason);
  }

  const { data, error } = await supabase.rpc(
    "record_case_schedule_simulation",
    {
      p_case_id: input.caseId,
      p_result: {
        seed: String(result.seed),
        iterations: String(result.iterations),
        sampleCount: String(result.sampleCount),
        kernelVersion: result.kernelVersion,
        activityDigest: inputs.digest.activityDigest,
        riskDigest: inputs.digest.riskDigest,
        deterministicHours: String(result.deterministicHours),
        p10Hours: String(result.p10Hours),
        p50Hours: String(result.p50Hours),
        p80Hours: String(result.p80Hours),
        p90Hours: String(result.p90Hours),
        probabilityOnPlan:
          result.probabilityOnPlan == null
            ? ""
            : String(result.probabilityOnPlan),
        currency: result.currency ?? "",
        costBase: result.costBase == null ? "" : String(result.costBase),
        costExposureP50:
          result.costExposureP50 == null ? "" : String(result.costExposureP50),
        costExposureP80:
          result.costExposureP80 == null ? "" : String(result.costExposureP80),
        delayCostPerDay:
          result.delayCostPerDay == null ? "" : String(result.delayCostPerDay),
        attribution: result.attribution,
        criticality: result.criticality,
      },
    },
  );
  return unwrap(data, error);
}

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
}): Promise<{ review_id: number; outcome: string }> {
  const { data, error } = await supabase.rpc("record_case_gate_review", {
    p_case_id: input.caseId,
    p_gate_id: input.gateId,
    p_outcome: input.outcome,
    p_note: input.note,
    p_findings: input.findings,
    p_conditions: input.conditions,
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
  const { data, error } = await supabase.rpc(
    "get_case_operational_readiness",
    { p_case_id: caseId },
  );
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

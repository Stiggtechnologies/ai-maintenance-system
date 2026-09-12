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
  CaseOptionComparison,
  GateReadinessResult,
  OperationalReadinessResult,
  OperationalReadinessIndexFactor,
  OperationalReadinessIndexResult,
  SystemOperationalReadinessResult,
  SystemReadinessDesignOriginsResult,
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
import type {
  AuthorityDelegations,
  CaseAssuranceEngine,
  CaseChangeControl,
  CaseContingency,
  CaseDecisionDebt,
  CaseDecisionLatency,
  CaseIntegratedControls,
  ContingencyCauseClass,
  MyDecisions,
} from "../lib/develop/change";
import type {
  RequirementFinding,
  RequirementFindings,
  RequirementTraceability,
  RequirementVerificationView,
} from "../lib/develop/requirements";
import type {
  DesignScorecardPayload,
  FrontlineReviewPayload,
} from "../lib/design";
import type { InterfaceGraphPayload } from "../lib/develop/interfaces";
import type { DevelopEventsPayload } from "../lib/develop/events";
import type { ChangeImpactReportsPayload } from "../lib/develop/changeImpact";
import {
  RAM_KERNEL_VERSION,
  computeCaseRamProfile,
  ramProfileLines,
  type RamProfile,
  type RamScopePayload,
} from "../lib/develop/ram";
import type {
  AuthoritativeVersionPayload,
  OrgThreadSeverancesPayload,
  ThreadContinuityPayload,
  ThreadGraphPayload,
  ThreadImpactPayload,
  ThreadReceiptsPayload,
  ThreadSeverancesPayload,
} from "../lib/develop/thread";
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
  role?: string | null;
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
    .select("id, full_name, email, role")
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

export async function getCaseOperationalReadinessIndex(
  caseId: string,
): Promise<OperationalReadinessIndexResult> {
  const { data, error } = await supabase.rpc(
    "get_case_operational_readiness_index",
    { p_case_id: caseId },
  );
  return unwrap<OperationalReadinessIndexResult>(data, error);
}

export async function saveCaseOperationalReadinessIndexProfile(input: {
  caseId: string;
  profileId?: string | null;
  factors: OperationalReadinessIndexFactor[];
  hardRequirementKeys: string[];
  basis: string;
  evidenceItemId: string;
}): Promise<{ profileId: string; version: number; status: "draft" }> {
  const { data, error } = await supabase.rpc(
    "save_case_operational_readiness_index_profile",
    {
      p_case_id: input.caseId,
      p_profile_id: input.profileId ?? null,
      p_factors: input.factors,
      p_hard_requirement_keys: input.hardRequirementKeys,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrap(data, error);
}

export async function adoptCaseOperationalReadinessIndexProfile(
  profileId: string,
): Promise<{ profileId: string; version: number; status: "adopted" }> {
  const { data, error } = await supabase.rpc(
    "adopt_case_operational_readiness_index_profile",
    { p_profile_id: profileId },
  );
  return unwrap(data, error);
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

export async function getCaseSystemOperationalReadiness(
  caseId: string,
): Promise<SystemOperationalReadinessResult> {
  const { data, error } = await supabase.rpc(
    "get_case_system_operational_readiness",
    { p_case_id: caseId },
  );
  return unwrap<SystemOperationalReadinessResult>(data, error);
}

export async function initializeCommissioningSystemReadiness(input: {
  systemId: number;
  ownerId: string;
  requiredBefore: string;
  basis: string;
  basisEvidenceItemId: string;
}): Promise<{ systemId: number; itemsAssigned: number; status: string }> {
  const { data, error } = await supabase.rpc(
    "initialize_commissioning_system_readiness",
    {
      p_system_id: input.systemId,
      p_owner_id: input.ownerId,
      p_required_before: input.requiredBefore,
      p_basis: input.basis,
      p_basis_evidence_item_id: input.basisEvidenceItemId,
    },
  );
  return unwrap(data, error);
}

export async function recordSystemOperationalReadinessItem(input: {
  systemId: number;
  itemId: string;
  status: "human_provided" | "not_applicable";
  evidenceItemId: string;
  note: string;
  value?: Record<string, unknown>;
}): Promise<{ systemId: number; itemId: string; status: string }> {
  const { data, error } = await supabase.rpc(
    "record_system_operational_readiness_item",
    {
      p_system_id: input.systemId,
      p_item_id: input.itemId,
      p_status: input.status,
      p_evidence_item_id: input.evidenceItemId,
      p_note: input.note,
      p_value: input.value ?? {},
    },
  );
  return unwrap(data, error);
}

export async function getCaseSystemReadinessDesignOrigins(
  caseId: string,
): Promise<SystemReadinessDesignOriginsResult> {
  const { data, error } = await supabase.rpc(
    "get_case_system_readiness_design_origins",
    { p_case_id: caseId },
  );
  return unwrap<SystemReadinessDesignOriginsResult>(data, error);
}

export async function listOperationalReadinessCatalog(): Promise<
  Array<{
    key: string;
    item_label: string;
    ori_category: string;
    section_title: string;
  }>
> {
  const { data, error } = await supabase
    .from("onboarding_requirements")
    .select("key, item_label, ori_category, section_title")
    .not("ori_category", "is", null)
    .order("ori_category")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    key: string;
    item_label: string;
    ori_category: string;
    section_title: string;
  }>;
}

export async function recordSystemReadinessDesignOrigin(input: {
  systemId: number;
  designRequirementId: number;
  onboardingRequirementKey: string;
  ownerId: string;
  requiredBefore: string;
  mappingBasis: string;
  mappingEvidenceItemId: string;
}): Promise<{
  originId: number;
  systemId: number;
  itemsGenerated: number;
  status: "awaiting_assets" | "materialized";
}> {
  const { data, error } = await supabase.rpc(
    "record_system_readiness_design_origin",
    {
      p_system_id: input.systemId,
      p_design_requirement_id: input.designRequirementId,
      p_onboarding_requirement_key: input.onboardingRequirementKey,
      p_owner_id: input.ownerId,
      p_required_before: input.requiredBefore,
      p_mapping_basis: input.mappingBasis,
      p_mapping_evidence_item_id: input.mappingEvidenceItemId,
    },
  );
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
  scheduleActivityId?: number | null;
  dependencies?: Array<{ subjectType: string; subjectId: string }>;
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
      schedule_activity_id: input.scheduleActivityId ?? null,
      dependencies: (input.dependencies ?? []).map((d) => ({
        subject_type: d.subjectType,
        subject_id: d.subjectId,
      })),
      threshold_parameter: input.thresholdParameter ?? null,
      threshold_comparator: input.thresholdComparator ?? null,
      threshold_value: input.thresholdValue ?? null,
      threshold_unit: input.thresholdUnit ?? null,
    },
  });
  return unwrapRpc(data, error, "Could not record the assumption");
}

export interface CaseAssumptionLinks {
  caseId: string;
  assumptions: Array<{
    assumptionId: string;
    statement: string;
    status: string;
    businessCaseId: number | null;
    scheduleActivityId: number | null;
    scheduleActivityLabel: string | null;
    dependencies: Array<{
      subjectType: string;
      subjectId: string;
      estimateRef: string | null;
    }>;
  }>;
  estimateSubjects: Array<{
    id: string;
    costItemRef: string;
    description: string;
  }>;
  scheduleSubjects: Array<{
    id: number;
    taskKey: string;
    label: string;
    eventTitle: string;
  }>;
}

export async function getCaseAssumptionLinks(
  caseId: string,
): Promise<CaseAssumptionLinks> {
  const { data, error } = await supabase.rpc("get_case_assumption_links", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load assumption links");
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

export async function getCaseOptionComparison(
  caseId: string,
): Promise<CaseOptionComparison> {
  const { data, error } = await supabase.rpc("get_case_option_comparison", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the option comparison");
}

export async function recordOptionSustainabilityObservation(input: {
  optionId: number;
  dimension: string;
  observation: string;
  value?: number | null;
  unit?: string | null;
  basis: string;
  evidenceItemId: string;
}): Promise<{ id: number; optionId: number; dimension: string }> {
  const { data, error } = await supabase.rpc(
    "record_option_sustainability_observation",
    {
      p_option_id: input.optionId,
      p_dimension: input.dimension,
      p_observation: input.observation,
      p_value: input.value ?? null,
      p_unit: input.unit ?? null,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrapRpc(data, error, "Could not record the option observation");
}

export async function createClimateResilienceAssessment(input: {
  optionId: number;
  assessmentRef: string;
  futureConditionsBasis: string;
}): Promise<{ assessmentId: string; revision: number; status: string }> {
  const { data, error } = await supabase.rpc(
    "create_climate_resilience_assessment",
    {
      p_option_id: input.optionId,
      p_assessment_ref: input.assessmentRef,
      p_future_conditions_basis: input.futureConditionsBasis,
    },
  );
  return unwrapRpc(data, error, "Could not create the climate assessment");
}

export async function recordClimateResilienceHazard(input: {
  assessmentId: string;
  hazard: string;
  futureCondition: string;
  designResponse: string;
  residualGap: string;
  evidenceItemId: string;
}): Promise<{ id: number; assessmentId: string; hazard: string }> {
  const { data, error } = await supabase.rpc(
    "record_climate_resilience_hazard",
    {
      p_assessment_id: input.assessmentId,
      p_hazard: input.hazard,
      p_future_condition: input.futureCondition,
      p_design_response: input.designResponse,
      p_residual_gap: input.residualGap,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrapRpc(data, error, "Could not record the climate hazard");
}

export async function reviewClimateResilienceAssessment(input: {
  assessmentId: string;
  note: string;
}): Promise<{
  assessmentId: string;
  status: string;
  hazards: number;
  decisionBoundary: string;
}> {
  const { data, error } = await supabase.rpc(
    "review_climate_resilience_assessment",
    { p_assessment_id: input.assessmentId, p_note: input.note },
  );
  return unwrapRpc(data, error, "Could not review the climate assessment");
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
  /* Slice 5A / §10: the fields the Requirement object was missing. */
  parentRequirementId?: number | null;
  ownerId?: string | null;
  acceptanceCriteria?: string | null;
  objectiveId?: string | null;
  operatingKpiKey?: string | null;
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
      parent_requirement_id: input.parentRequirementId ?? null,
      owner_id: input.ownerId ?? null,
      acceptance_criteria: input.acceptanceCriteria ?? null,
      objective_id: input.objectiveId ?? null,
      operating_kpi_key: input.operatingKpiKey ?? null,
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

/** D3.01 / D3.22: a hand-authored DRAFT framework. Nothing governs until adopt. */
export async function createProjectFramework(input: {
  name: string;
  source: string;
  sourceAuthority?: string;
  basis: string;
  projectClasses?: string[];
}): Promise<{
  framework_id: string;
  status: string;
  adoption_required: boolean;
}> {
  const { data, error } = await supabase.rpc("create_project_framework", {
    p_name: input.name,
    p_source: input.source,
    p_source_authority: input.sourceAuthority ?? "INDUSTRY_GUIDANCE",
    p_basis: input.basis,
    p_project_classes: input.projectClasses ?? [],
  });
  return unwrap(data, error);
}

/** D3.23: a named/ordered stage on a DRAFT framework, mapped onto lifecycle_stages. */
export async function addFrameworkStage(input: {
  frameworkId: string;
  stageKey: string;
  sequence: number;
  displayName: string;
  purpose?: string | null;
  entryCriteria?: string | null;
  exitCriteria?: string | null;
}): Promise<{ framework_stage_id: number; stage_key: string }> {
  const { data, error } = await supabase.rpc("add_framework_stage", {
    p_framework_id: input.frameworkId,
    p_stage_key: input.stageKey,
    p_sequence: input.sequence,
    p_display_name: input.displayName,
    p_purpose: input.purpose ?? null,
    p_entry_criteria: input.entryCriteria ?? null,
    p_exit_criteria: input.exitCriteria ?? null,
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
    parent_requirement_id: number | null;
    owner_id: string | null;
    acceptance_criteria: string | null;
    objective_id: string | null;
    operating_kpi_key: string | null;
    verification_method: string | null;
    verification_status: string;
  }[]
> {
  const { data, error } = await supabase
    .from("design_requirements")
    .select(
      "id, requirement_ref, category, requirement, scope_need_id, parent_requirement_id, owner_id, acceptance_criteria, objective_id, operating_kpi_key, verification_method, verification_status",
    )
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

/* ──────── Slice 4D — contingency, change control, decisions, screens ───── */
/**
 * D5.18, D5.19, D5.27, D5.30, D3.12/D3.13/D3.21/D3.36, D5.21, D13.02, D13.08.
 *
 * Same posture as 4A/4B/4C, with one addition that only applies here: THIS IS
 * THE FAMILY THAT MOVES MONEY. Every write is a definer RPC; every READ that
 * produces a NUMBER goes through a compute_* RPC that records a
 * calculation_runs row; and the two SCREEN reads
 * (getCaseIntegratedControls / getCaseAssuranceEngine) compute nothing at all —
 * they compose the runs the compute_* functions already recorded, so a screen
 * can never disagree with the ledger it is describing.
 */

export async function getCaseContingency(
  caseId: string,
): Promise<CaseContingency> {
  const { data, error } = await supabase.rpc("get_case_contingency", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** D5.19 + D11.29: the consumption report, recorded as a run. */
export async function computeCaseContingencyConsumption(
  caseId: string,
): Promise<CaseContingency> {
  const { data, error } = await supabase.rpc(
    "compute_case_contingency_consumption",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/** §70: establishing the fund fixes what every later drawdown is measured against. */
export async function establishContingencyPool(input: {
  caseId: string;
  baselineId: string;
  originalAmount: string;
  currency: string;
  basis: string;
  poolRef?: string;
}): Promise<{
  pool_id: string;
  pool_ref: string;
  original_amount: number;
  currency: string;
  remaining: number;
}> {
  const { data, error } = await supabase.rpc("establish_contingency_pool", {
    p_case_id: input.caseId,
    p_pool: {
      baseline_id: input.baselineId,
      original_amount: input.originalAmount,
      currency: input.currency,
      basis: input.basis,
      pool_ref: input.poolRef ?? "",
    },
  });
  return unwrap(data, error);
}

/**
 * D5.18. The act that spends money: authority-gated, cause-attributed,
 * refused below zero, §70 human-only. The amount travels as TEXT so the
 * server's own finite-money parser is the one place a NaN is caught.
 */
export async function drawDownContingency(input: {
  poolId: string;
  amount: string;
  causeClass: ContingencyCauseClass;
  justification: string;
  riskId?: string;
  changeId?: string;
  causeNote?: string;
}): Promise<{
  entry_id: string;
  entry_no: number;
  amount: number;
  cause_class: string;
  remaining: number;
  currency: string;
}> {
  const { data, error } = await supabase.rpc("draw_down_contingency", {
    p_pool_id: input.poolId,
    p_draw: {
      amount: input.amount,
      cause_class: input.causeClass,
      justification: input.justification,
      risk_id: input.riskId ?? "",
      change_id: input.changeId ?? "",
      cause_note: input.causeNote ?? "",
    },
  });
  return unwrap(data, error);
}

/** A spend made in error is REVERSED, never edited away. */
export async function releaseContingency(input: {
  entryId: string;
  amount: string;
  justification: string;
}): Promise<{
  entry_id: string;
  amount: number;
  reverses_entry_no: number;
  remaining: number;
}> {
  const { data, error } = await supabase.rpc("release_contingency", {
    p_entry_id: input.entryId,
    p_release: { amount: input.amount, justification: input.justification },
  });
  return unwrap(data, error);
}

/* ── The delegation instrument itself (20261203090400) ────────────────── */

/**
 * The ceiling every contingency drawdown and change approval is checked
 * against, and the doors that state it.
 *
 * Before these existed the seeds left `max_commitment_usd` null, R2 made a
 * null ceiling REFUSE, and the refusal's own remediation ("record
 * max_commitment_usd on the delegation") was impossible through the product —
 * the feature could only be enabled by a DBA with raw SQL.
 */
export async function getAuthorityDelegations(
  actionType?: string,
): Promise<AuthorityDelegations> {
  const { data, error } = await supabase.rpc("get_authority_delegations", {
    p_action_type: actionType ?? null,
  });
  return unwrap(data, error);
}

/** States the ceiling and its CURRENCY on a DRAFT delegation. §70: human only. */
export async function stateAuthorityCeiling(input: {
  limitId: string;
  maxCommitment: string;
  currency: string;
  basis: string;
  maxRiskLevel?: string;
}): Promise<{
  limit_id: string;
  ceiling: number;
  currency: string;
  status: string;
}> {
  const { data, error } = await supabase.rpc("state_authority_ceiling", {
    p_id: input.limitId,
    p_ceiling: {
      max_commitment: input.maxCommitment,
      currency: input.currency,
      basis: input.basis,
      max_risk_level: input.maxRiskLevel ?? "",
    },
  });
  return unwrap(data, error);
}

/**
 * Mints a DRAFT from an existing delegation so a live ceiling can be changed
 * through the product. An adopted delegation is never edited: every recorded
 * drawdown quotes the ceiling it was checked against.
 */
export async function draftAuthorityCeiling(input: {
  limitId: string;
  note: string;
}): Promise<{ draft_id: string; role_key: string; action_type: string }> {
  const { data, error } = await supabase.rpc("draft_authority_ceiling", {
    p_id: input.limitId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

/** Adopting a delegation is itself an act of authority. §70 refuses ai_admin. */
export async function adoptAuthorityLimit(input: {
  limitId: string;
  note: string;
}): Promise<{ adopted: string; role_key: string; ceiling: number | null }> {
  const { data, error } = await supabase.rpc("adopt_authority_limit", {
    p_id: input.limitId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

/* ── D5.27 / D5.30: Workflow 3 on the existing MOC engine ─────────────── */

export async function getCaseChangeControl(
  caseId: string,
): Promise<CaseChangeControl> {
  const { data, error } = await supabase.rpc("get_case_change_control", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function computeCaseChangeControl(
  caseId: string,
): Promise<CaseChangeControl> {
  const { data, error } = await supabase.rpc("compute_case_change_control", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function raiseProjectChange(input: {
  caseId: string;
  changeRef: string;
  changeClass: string;
  baselineId: string;
  proposedChange: string;
  reason: string;
}): Promise<{ change_id: string; change_ref: string; status: string }> {
  const { data, error } = await supabase.rpc("raise_project_change", {
    p_case_id: input.caseId,
    p_change: {
      change_ref: input.changeRef,
      change_class: input.changeClass,
      baseline_id: input.baselineId,
      proposed_change: input.proposedChange,
      reason: input.reason,
    },
  });
  return unwrap(data, error);
}

/** §70: the assessed cost effect is the number the authority routing runs on. */
export async function assessProjectChange(input: {
  changeId: string;
  technicalEffect: string;
  costEffect: string;
  scheduleEffectDays: string;
  riskEffect: string;
  contingencyEffect?: string;
  currency: string;
  impactBasis: string;
  targets?: { kind: string; id?: string; effect?: string }[];
}): Promise<{ change_id: string; status: string; propagation_rows: number }> {
  const { data, error } = await supabase.rpc("assess_project_change", {
    p_change_id: input.changeId,
    p_impact: {
      technical_effect: input.technicalEffect,
      cost_effect: input.costEffect,
      schedule_effect_days: input.scheduleEffectDays,
      risk_effect: input.riskEffect,
      contingency_effect: input.contingencyEffect ?? "0",
      currency: input.currency,
      impact_basis: input.impactBasis,
      targets: input.targets ?? [],
    },
  });
  return unwrap(data, error);
}

/** The MOC engine's competence sign-off, on the change object. */
export async function signProjectChangeEngineering(input: {
  changeId: string;
  note: string;
}): Promise<{ change_id: string; rule: string }> {
  const { data, error } = await supabase.rpc(
    "sign_project_change_engineering",
    { p_change_id: input.changeId, p_note: input.note },
  );
  return unwrap(data, error);
}

/** §70 + §42: a human who did not raise it, inside an adopted delegation. */
export async function decideProjectChange(input: {
  changeId: string;
  outcome: "approved" | "rejected";
  note: string;
}): Promise<{ change_id: string; status: string }> {
  const { data, error } = await supabase.rpc("decide_project_change", {
    p_change_id: input.changeId,
    p_decision: { outcome: input.outcome, note: input.note },
  });
  return unwrap(data, error);
}

export async function propagateProjectChange(
  changeId: string,
): Promise<{ change_id: string; applied: number; outstanding: number }> {
  const { data, error } = await supabase.rpc("propagate_project_change", {
    p_change_id: changeId,
  });
  return unwrap(data, error);
}

export async function closeChangePropagation(input: {
  propagationId: string;
  outcome: "applied" | "not_applicable" | "blocked";
  note: string;
}): Promise<{ propagation_id: string; status: string; outstanding: number }> {
  const { data, error } = await supabase.rpc("close_change_propagation", {
    p_propagation_id: input.propagationId,
    p_close: { outcome: input.outcome, note: input.note },
  });
  return unwrap(data, error);
}

export async function implementProjectChange(
  changeId: string,
): Promise<{ change_id: string; status: string }> {
  const { data, error } = await supabase.rpc("implement_project_change", {
    p_change_id: changeId,
  });
  return unwrap(data, error);
}

/* ── D3.12/D3.13/D3.21/D3.36: latency, exposure, debt ─────────────────── */

export async function getCaseDecisionLatency(
  caseId: string,
): Promise<CaseDecisionLatency> {
  const { data, error } = await supabase.rpc("get_case_decision_latency", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function computeCaseDecisionLatency(
  caseId: string,
): Promise<CaseDecisionLatency> {
  const { data, error } = await supabase.rpc("compute_case_decision_latency", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function getCaseDecisionDebt(
  caseId: string,
): Promise<CaseDecisionDebt> {
  const { data, error } = await supabase.rpc("get_case_decision_debt", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function computeCaseDecisionDebt(
  caseId: string,
): Promise<CaseDecisionDebt> {
  const { data, error } = await supabase.rpc("compute_case_decision_debt", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** D3.13: which activities a decision gates. Criticality is P6's float. */
export async function linkDecisionToActivity(input: {
  decisionId: string;
  activityKey?: string;
  activityId?: string;
  basis: string;
}): Promise<{ link_id: string; decision_id: string }> {
  const { data, error } = await supabase.rpc("link_decision_to_activity", {
    p_decision_id: input.decisionId,
    p_link: {
      activity_key: input.activityKey ?? "",
      activity_id: input.activityId ?? "",
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

/** D3.21: the two numbers II.17 needs, stated rather than derived. */
export async function recordDecisionDelayExposure(input: {
  decisionId: string;
  expectedImpact: string;
  probabilityOfDelay: string;
  currency: string;
  basis: string;
}): Promise<{ exposure_id: string; debt: number }> {
  const { data, error } = await supabase.rpc("record_decision_delay_exposure", {
    p_decision_id: input.decisionId,
    p_exposure: {
      expected_impact: input.expectedImpact,
      probability_of_delay: input.probabilityOfDelay,
      currency: input.currency,
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

/* ── D5.21 / D13.08 / D13.02: the compositions. These compute nothing. ── */

export async function getCaseAssuranceEngine(
  caseId: string,
): Promise<CaseAssuranceEngine> {
  const { data, error } = await supabase.rpc("get_case_assurance_engine", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function getCaseIntegratedControls(
  caseId: string,
): Promise<CaseIntegratedControls> {
  const { data, error } = await supabase.rpc("get_case_integrated_controls", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function getMyDecisions(limit = 50): Promise<MyDecisions> {
  const { data, error } = await supabase.rpc("get_my_decisions", {
    p_limit: limit,
  });
  return unwrap(data, error);
}

/* ─────────── Slice 5A — requirements, verification, the thread ────────── */
/**
 * D4.16 (§10 Requirement), D4.17 (§11 Verification), D12.09 (§59 Requirements
 * Agent).
 *
 * Same posture as every slice before it: every write is a definer RPC and the
 * traceability numbers come off `compute_case_requirement_traceability`, which
 * records a calculation_runs row — including when it REFUSES, because a
 * refusal with no lineage is a refusal nobody can later prove happened.
 *
 * There is no `recordRequirementVerificationResult` here on purpose.
 * `recordVerificationResult` in operatingLoopService is the ONE caller of the
 * ONE RPC and it now takes §11's evidence id; a develop-side twin would be a
 * fork of the caller, and the first thing a fork does is stop passing an
 * argument the other one passes.
 */

export async function getCaseRequirementTraceability(
  caseId: string,
): Promise<RequirementTraceability> {
  const { data, error } = await supabase.rpc(
    "get_case_requirement_traceability",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

export async function computeCaseRequirementTraceability(
  caseId: string,
): Promise<RequirementTraceability> {
  const { data, error } = await supabase.rpc(
    "compute_case_requirement_traceability",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

export interface RequirementThreadInput {
  objectiveId?: string;
  satisfiedByAssetId?: string;
  commissioningTestId?: number;
  operatingKpiKey?: string;
  parentRequirementId?: number;
  ownerId?: string;
  acceptanceCriteria?: string;
}

export async function linkRequirementThread(
  requirementId: number,
  input: RequirementThreadInput,
): Promise<{ requirement_id: number; linksTouched: number }> {
  // Only the keys the caller actually set are sent. An empty string would be
  // read by the RPC as "clear this link", which it refuses by name — sending
  // untouched fields would turn every save into a refusal.
  const link: Record<string, unknown> = {};
  if (input.objectiveId) link.objective_id = input.objectiveId;
  if (input.satisfiedByAssetId)
    link.satisfied_by_asset_id = input.satisfiedByAssetId;
  if (input.commissioningTestId != null)
    link.commissioning_test_id = input.commissioningTestId;
  if (input.operatingKpiKey) link.operating_kpi_key = input.operatingKpiKey;
  if (input.parentRequirementId != null)
    link.parent_requirement_id = input.parentRequirementId;
  if (input.ownerId) link.owner_id = input.ownerId;
  if (input.acceptanceCriteria)
    link.acceptance_criteria = input.acceptanceCriteria;

  const { data, error } = await supabase.rpc("link_requirement_thread", {
    p_requirement_id: requirementId,
    p_link: link,
  });
  return unwrapRpc(data, error, "Could not link the requirement thread");
}

export async function getCaseRequirementVerifications(
  caseId: string,
): Promise<RequirementVerificationView> {
  const { data, error } = await supabase.rpc(
    "get_case_requirement_verifications",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

export interface RequirementVerificationInput {
  methodCode: string;
  procedure?: string;
  acceptanceCriteria?: string;
  intendedOutcome?: string;
  dueDate?: string;
  /**
   * The recorded FAILURE this verification re-tests (§11 / repair ruling 8).
   * Without it, a later achieved result does not un-fail the requirement —
   * and the RPC returns `standingFailureNote` saying so rather than letting
   * the planner find out from a status that never moved.
   */
  supersedesObligationId?: string;
}

export async function createRequirementVerification(
  requirementId: number,
  input: RequirementVerificationInput,
): Promise<{
  obligation_id: string;
  methodCode: string;
  dueDateAssumed: boolean;
  standingFailureNote?: string | null;
}> {
  const { data, error } = await supabase.rpc(
    "create_requirement_verification",
    {
      p_requirement_id: requirementId,
      p_verification: {
        method_code: input.methodCode,
        procedure: input.procedure ?? null,
        acceptance_criteria: input.acceptanceCriteria ?? null,
        intended_outcome: input.intendedOutcome ?? null,
        due_date: input.dueDate ?? null,
        // Only sent when the planner named one: an empty string would be read
        // as a malformed identifier and refused.
        ...(input.supersedesObligationId
          ? { supersedes_obligation_id: input.supersedesObligationId }
          : {}),
      },
    },
  );
  return unwrapRpc(data, error, "Could not plan the verification");
}

export async function getCaseRequirementFindings(
  caseId: string,
): Promise<RequirementFindings> {
  const { data, error } = await supabase.rpc("get_case_requirement_findings", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export interface RequirementsAgentResult {
  advisory: true;
  caseId: string;
  refused: boolean;
  refusal?: string;
  reading: {
    headline: string;
    familyLines: string[];
    findingLines: string[];
    refusalLines: string[];
  } | null;
  findings?: RequirementFinding[];
  byFamily?: Record<string, number>;
  requirementCount?: number;
  findingCount?: number;
  refusals?: string[];
  aiFindings?: {
    requirement_ref: string;
    related_requirement_ref: string | null;
    concern: string;
  }[];
  aiDropped?: string[];
  narrative: string | null;
  model: string | null;
  providerNote?: string | null;
  recorded?: { report_id?: number; findingCount?: number } | null;
  recordNote?: string | null;
  disclaimer: string;
}

export async function runRequirementsAgent(input: {
  caseId: string;
  record?: boolean;
}): Promise<RequirementsAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-requirements-agent",
    { body: { case_id: input.caseId, record: input.record ?? false } },
  );
  if (error) throw new Error(error.message);
  const payload = data as RequirementsAgentResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as RequirementsAgentResult;
}

export async function getRequirementAgentReports(caseId: string): Promise<{
  caseId: string;
  reports: {
    id: number;
    asAt: string;
    requirementCount: number;
    findingCount: number;
    byFamily: Record<string, number>;
    findings: RequirementFinding[];
    narrative: string | null;
    model: string | null;
    agentKey: string;
    advisory: boolean;
    requestedBy: string | null;
  }[];
}> {
  const { data, error } = await supabase.rpc("get_requirement_agent_reports", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** The KPI catalogue, for the §10 thread's terminus selector. */
export async function listOperatingKpis(): Promise<
  { kpi_key: string; name: string; page: string }[]
> {
  const { data, error } = await supabase
    .from("kpi_catalog")
    .select("kpi_key, name, page")
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * This organization's commissioning/acceptance tests, for the §10 thread's
 * commissioning-test selector.
 *
 * `acceptance_tests` is SELECT-only for clients (D4.05 owns its authoring gap
 * and is 🟡 for it). This read exists so the LINK is reachable: without a
 * selector, `design_requirements.commissioning_test_id` was write-unreachable
 * from the product entirely, and threadCoveragePct — which requires objective
 * AND asset AND test AND KPI — was structurally pinned at 0% for any
 * customer-created data while rendering as a measured figure.
 */
export async function listCommissioningTests(): Promise<
  { id: number; test_ref: string; test_type: string | null }[]
> {
  const { data, error } = await supabase
    .from("acceptance_tests")
    .select("id, test_ref, test_type")
    .order("test_ref")
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: number;
    test_ref: string;
    test_type: string | null;
  }[];
}

/**
 * This organization's evidence items, for §11's `evidence_id`.
 *
 * The RPC gained the parameter and both recorder forms passed three
 * arguments, so `p_evidence_id` was null in every production call and the
 * only non-null writer in the repository was a smoke script. A parameter with
 * no writer is a capability the register cannot claim.
 */
export async function listOrgEvidenceItems(): Promise<
  { id: string; description: string; evidence_class: string | null }[]
> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select("id, description, evidence_class")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    id: string;
    description: string;
    evidence_class: string | null;
  }[];
}

/** This organization's objectives, for the §10 thread's head selector. */
export async function listCaseObjectives(): Promise<
  { id: string; description: string; objective_level: string }[]
> {
  const { data, error } = await supabase
    .from("risk_objectives")
    .select("id, description, objective_level")
    .order("description");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/* ══════════ Slice 5B — frontline design review, six-axis scoring, §19 ══════
 *
 *   D4.10  the frontline design review: who was in the room by discipline,
 *          and the eight I.25 dimensions as itemized findings.
 *   D4.11  the disposition record — accepted / rejected / accepted with
 *          conditions, with a reason mandatory on every outcome.
 *   D4.12  the six I.26 axes, scored by a human with a basis; the composite
 *          refuses while any axis is unscored.
 *   D4.18  the §19 Interface in seven types, on the SHARED dependency graph.
 *
 * Same posture as every slice before it: every write is a definer RPC, every
 * refusal is the SERVER's text, and nothing here recomputes a number the
 * server already computed.
 */

export async function getCaseFrontlineReview(
  caseId: string,
): Promise<FrontlineReviewPayload> {
  const { data, error } = await supabase.rpc("get_case_frontline_review", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export interface CaseDesignStudyInput {
  studyKind: string;
  summary: string;
  performedOn?: string;
}

export async function recordCaseDesignStudy(
  caseId: string,
  input: CaseDesignStudyInput,
): Promise<{
  study_id: number;
  studyKind: string;
  frontlineKind: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_case_design_study", {
    p_case_id: caseId,
    p_study: {
      study_kind: input.studyKind,
      summary: input.summary,
      ...(input.performedOn ? { performed_on: input.performedOn } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the design study");
}

export async function addDesignStudyParticipant(
  studyId: number,
  input: { participantId: string; discipline: string; basis?: string },
): Promise<{
  participant_id: number;
  discipline: string;
  maintainerParticipated: boolean;
  operatorParticipated: boolean;
  constructorParticipated: boolean;
}> {
  const { data, error } = await supabase.rpc("add_design_study_participant", {
    p_study_id: studyId,
    p_participant: {
      participant_id: input.participantId,
      discipline: input.discipline,
      ...(input.basis ? { basis: input.basis } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the participant");
}

export interface DesignFindingInput {
  findingRef: string;
  dimension: string;
  recommendation: string;
  severity?: string;
  /** Defaults to the caller. Named when a scribe records for the room. */
  raisedBy?: string;
  /** Only needed when the person attended in more than one discipline. */
  discipline?: string;
}

export async function raiseDesignReviewFinding(
  studyId: number,
  input: DesignFindingInput,
): Promise<{
  finding_id: number;
  findingRef: string;
  dimension: string;
  discipline: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("raise_design_review_finding", {
    p_study_id: studyId,
    p_finding: {
      finding_ref: input.findingRef,
      dimension: input.dimension,
      recommendation: input.recommendation,
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.raisedBy ? { raised_by: input.raisedBy } : {}),
      ...(input.discipline ? { discipline: input.discipline } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not raise the finding");
}

export interface DispositionInput {
  outcome: string;
  reason: string;
  discipline: string;
  conditions?: string;
}

export async function dispositionDesignFinding(
  findingId: number,
  input: DispositionInput,
): Promise<{
  disposition_id: number;
  dispositionNo: number;
  outcome: string;
  requirementCarried: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("disposition_design_finding", {
    p_finding_id: findingId,
    p_disposition: {
      outcome: input.outcome,
      reason: input.reason,
      discipline: input.discipline,
      // Sent only for the conditional outcome: the RPC refuses conditions on a
      // flat acceptance BY NAME, so an empty string would turn every save into
      // a refusal.
      ...(input.conditions ? { conditions: input.conditions } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the disposition");
}

export async function carryDesignFindingToRequirement(
  findingId: number,
  requirementId: number,
): Promise<{
  finding_id: number;
  requirement_id: number;
  requirementRef: string;
}> {
  const { data, error } = await supabase.rpc(
    "carry_design_finding_to_requirement",
    { p_finding_id: findingId, p_requirement_id: requirementId },
  );
  return unwrapRpc(data, error, "Could not carry the recommendation");
}

/* ───────────────────────── D4.12 — six-axis scoring ───────────────────── */

export async function getCaseDesignScorecard(
  caseId: string,
): Promise<DesignScorecardPayload> {
  const { data, error } = await supabase.rpc("get_case_design_scorecard", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/**
 * The scorecard WITH a calculation_runs row behind it (D11.29).
 *
 * BEHIND AN EXPLICIT ACT, never on mount (5B-R9). `compute_` records a
 * calculation_runs row every time it is called, so calling it from `load()`
 * appended one lineage row per page view and per write in the panel — turning
 * "when was this scorecard computed, and who asked for it" into a log of who
 * opened the screen. It also carries a narrower role set than the plain read,
 * so mounting it blanked the whole panel for a technician. The panel reads
 * with `getCaseDesignScorecard` and computes on a button, which is what every
 * other develop panel does.
 */
export async function computeCaseDesignScorecard(
  caseId: string,
): Promise<DesignScorecardPayload & { calculationRunId?: string }> {
  const { data, error } = await supabase.rpc("compute_case_design_scorecard", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function scoreDesignAxis(
  caseId: string,
  input: { axis: string; score: number; basis: string; studyId?: number },
): Promise<{
  score_id: number;
  axis: string;
  score: number;
  missingAxes: string[];
  note: string;
}> {
  const { data, error } = await supabase.rpc("score_design_axis", {
    p_case_id: caseId,
    p_score: {
      axis: input.axis,
      score: input.score,
      basis: input.basis,
      ...(input.studyId != null ? { study_id: input.studyId } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the score");
}

/* ────────────────────── D4.18 — the §19 Interface object ──────────────── */

export async function getCaseInterfaceGraph(
  caseId: string,
): Promise<InterfaceGraphPayload> {
  const { data, error } = await supabase.rpc("get_case_interface_graph", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export interface CaseInterfaceInput {
  interfaceRef: string;
  sourceObject: string;
  targetObject: string;
  interfaceType: string;
  ownerId: string;
  requirement: string;
  dueDate?: string;
  sourceAssetId?: string;
  targetAssetId?: string;
  requirementId?: number;
}

export async function recordCaseInterface(
  caseId: string,
  input: CaseInterfaceInput,
): Promise<{
  interface_id: number;
  interfaceRef: string;
  interfaceType: string;
  traversalKind: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_case_interface", {
    p_case_id: caseId,
    p_interface: {
      interface_ref: input.interfaceRef,
      source_object: input.sourceObject,
      target_object: input.targetObject,
      interface_type: input.interfaceType,
      owner_id: input.ownerId,
      requirement: input.requirement,
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
      ...(input.sourceAssetId ? { source_asset_id: input.sourceAssetId } : {}),
      ...(input.targetAssetId ? { target_asset_id: input.targetAssetId } : {}),
      ...(input.requirementId != null
        ? { requirement_id: input.requirementId }
        : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the interface");
}

export async function setCaseInterfaceStatus(
  interfaceId: number,
  status: string,
  note: string,
): Promise<{ interface_id: number; status: string; previousStatus: string }> {
  const { data, error } = await supabase.rpc("set_case_interface_status", {
    p_interface_id: interfaceId,
    p_status: status,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not move the interface");
}

/* ───────────── Slice 5C — the digital thread (D11.05/06/07/19/20/21) ───────── */

export async function getCaseThreadGraph(
  caseId: string,
): Promise<ThreadGraphPayload> {
  const { data, error } = await supabase.rpc("get_case_thread_graph", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function checkThreadContinuity(
  caseId: string,
): Promise<ThreadContinuityPayload> {
  const { data, error } = await supabase.rpc("check_thread_continuity", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function getCaseThreadReceipts(
  caseId: string,
): Promise<ThreadReceiptsPayload> {
  const { data, error } = await supabase.rpc("get_case_thread_receipts", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export async function getCaseThreadSeverances(
  caseId: string,
): Promise<ThreadSeverancesPayload> {
  const { data, error } = await supabase.rpc("get_case_thread_severances", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/**
 * The tenant's whole severance ledger (D11.20).
 *
 * Separate from the case-scoped read because it has to be: that one resolves
 * the development case and refuses when it is gone, so it can never return a
 * `case_cascade` row — those rows exist BECAUSE the case was deleted. This read
 * resolves nothing and therefore loses nothing.
 */
export async function getOrgThreadSeverances(
  limit = 200,
): Promise<OrgThreadSeverancesPayload> {
  const { data, error } = await supabase.rpc("get_org_thread_severances", {
    p_limit: limit,
  });
  return unwrap(data, error);
}

/**
 * The downstream-impact traversal (D11.07).
 *
 * `unwrap` rather than `unwrapRpc`, deliberately: a REFUSAL is not an error
 * here. The server returns `refused: true` with the gap named, and the panel
 * has to render that refusal — throwing it away as an exception would leave the
 * screen showing nothing, which is the one outcome worse than a wrong number.
 */
export async function getCaseThreadImpact(
  caseId: string,
  objectId: number,
): Promise<ThreadImpactPayload> {
  const { data, error } = await supabase.rpc("get_case_thread_impact", {
    p_case_id: caseId,
    p_object_id: objectId,
  });
  return unwrap(data, error);
}

export async function resolveThreadAuthoritativeVersion(
  objectId: number,
): Promise<AuthoritativeVersionPayload> {
  const { data, error } = await supabase.rpc(
    "resolve_thread_authoritative_version",
    { p_object_id: objectId },
  );
  return unwrap(data, error);
}

export interface ThreadObjectInput {
  objectKind: string;
  objectRef: string;
  title: string;
  anchorAssetId: string;
  requirementId?: number;
  commissioningTestId?: number;
}

export async function registerThreadObject(
  caseId: string,
  input: ThreadObjectInput,
): Promise<{
  object_id: number;
  objectKind: string;
  objectRef: string;
  chainPosition: number;
  canonicalHome: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("register_thread_object", {
    p_case_id: caseId,
    p_object: {
      object_kind: input.objectKind,
      object_ref: input.objectRef,
      title: input.title,
      anchor_asset_id: input.anchorAssetId,
      ...(input.requirementId != null
        ? { requirement_id: input.requirementId }
        : {}),
      ...(input.commissioningTestId != null
        ? { commissioning_test_id: input.commissioningTestId }
        : {}),
    },
  });
  return unwrapRpc(data, error, "Could not register the thread object");
}

export async function linkThreadObjects(
  upstreamId: number,
  downstreamId: number,
  linkType: string,
  basis: string,
): Promise<{
  link_id: number;
  linkType: string;
  traversalKind: string;
  positionsSkipped: number;
  anchorsAgree: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("link_thread_objects", {
    p_upstream_id: upstreamId,
    p_downstream_id: downstreamId,
    p_link_type: linkType,
    p_basis: basis,
  });
  return unwrapRpc(data, error, "Could not link the objects");
}

export async function recordThreadVersion(
  objectId: number,
  input: {
    versionLabel: string;
    issuedOn?: string;
    contentRef?: string;
    changeSummary?: string;
  },
): Promise<{ version_id: number; versionLabel: string; note: string }> {
  const { data, error } = await supabase.rpc("record_thread_version", {
    p_object_id: objectId,
    p_version: {
      version_label: input.versionLabel,
      ...(input.issuedOn ? { issued_on: input.issuedOn } : {}),
      ...(input.contentRef ? { content_ref: input.contentRef } : {}),
      ...(input.changeSummary ? { change_summary: input.changeSummary } : {}),
    },
  });
  return unwrapRpc(data, error, "Could not record the revision");
}

export async function declareThreadVersionAuthoritative(
  versionId: number,
  basis: string,
): Promise<{
  version_id: number;
  versionLabel: string;
  supersededVersionLabel: string | null;
  firstIssue: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc(
    "declare_thread_version_authoritative",
    { p_version_id: versionId, p_basis: basis },
  );
  return unwrapRpc(data, error, "Could not declare the revision authoritative");
}

export async function severThreadLink(
  linkId: number,
  reason: string,
): Promise<{ link_id: number; severance_id: number; note: string }> {
  const { data, error } = await supabase.rpc("sever_thread_link", {
    p_link_id: linkId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not sever the hop");
}

export async function retireThreadObject(
  objectId: number,
  reason: string,
): Promise<{
  object_id: number;
  severance_id: number;
  linksSevered: number;
  note: string;
}> {
  const { data, error } = await supabase.rpc("retire_thread_object", {
    p_object_id: objectId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not retire the object");
}

export async function reanchorThreadObject(
  objectId: number,
  newAssetId: string,
  reason: string,
): Promise<{
  object_id: number;
  severance_id: number;
  anchorAssetName: string;
  previousAnchorAssetName: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("reanchor_thread_object", {
    p_object_id: objectId,
    p_new_asset_id: newAssetId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not move the anchor");
}

export async function acknowledgeThreadReceipt(
  receiptId: number,
  disposition: string,
  note: string,
): Promise<{
  receipt_id: number;
  status: string;
  outstandingOnCase: number;
  note: string;
}> {
  const { data, error } = await supabase.rpc("acknowledge_thread_receipt", {
    p_receipt_id: receiptId,
    p_disposition: disposition,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not answer the receipt");
}

export async function setAssetEnterpriseIdentity(
  assetId: string,
  enterpriseAssetId: string,
  functionalLocation: string,
): Promise<{
  asset_id: string;
  enterpriseAssetId: string | null;
  functionalLocation: string | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("set_asset_enterprise_identity", {
    p_asset_id: assetId,
    p_enterprise_asset_id: enterpriseAssetId || null,
    p_functional_location: functionalLocation || null,
  });
  return unwrapRpc(data, error, "Could not record the enterprise identity");
}

/* ─────────── Slice 5D: the event bus, the two agents, the engine ────────── */

/**
 * The five §71-78 events on one case, with what the ONE consumer did.
 *
 * `unwrap` rather than `unwrapRpc`: an empty list is not an error, and the
 * server's sentence about WHICH empty it is must reach the screen.
 */
export async function getCaseDevelopEvents(
  caseId: string,
): Promise<DevelopEventsPayload> {
  const { data, error } = await supabase.rpc("get_case_develop_events", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/**
 * The unanswered BLOCKING event consequences on a case — THE ROWS THE GATE
 * WALL READS.
 *
 * Deliberately not derived on the client from the deliveries payload. The
 * panel used to re-filter `consequence === "blocking"` itself, which is a
 * second implementation of a predicate that already has one, and the two
 * would drift the first time the rule set changed (they nearly did: a
 * gate-level consequence blocks its own gate only, and a client filter cannot
 * know that). Reading `case_event_consequence_obligations` means the screen
 * and `enforce_gate_review_outstanding_obligations` speak from the same rows.
 */
export interface EventGateBlocker {
  type: string;
  id: number;
  name: string;
  eventName: string;
  ruleKey: string;
  /** The gate this consequence is ABOUT, or null when it blocks every gate. */
  gateId: number | null;
  gateName: string | null;
  emittedAt: string;
}

export async function getCaseEventGateBlockers(
  caseId: string,
  gateId?: number,
): Promise<EventGateBlocker[]> {
  const { data, error } = await supabase.rpc(
    "case_event_consequence_obligations",
    { p_case_id: caseId, p_gate_id: gateId ?? null },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as EventGateBlocker[];
}

export async function answerDevelopEventConsequence(
  deliveryId: number,
  note: string,
): Promise<{
  delivery_id: number;
  eventName: string;
  consequence: string;
  openOnCase: number;
  blockingOnCase: number;
  note: string;
}> {
  const { data, error } = await supabase.rpc(
    "answer_develop_event_consequence",
    { p_delivery_id: deliveryId, p_note: note },
  );
  return unwrapRpc(data, error, "Could not answer the event consequence");
}

export interface ChangeImpactAgentResult {
  advisory: true;
  caseId: string;
  objectId: number;
  objectRef: string;
  refused: boolean;
  refusal: string | null;
  reading: {
    refused: boolean;
    headline: string;
    affectedLines: string[];
    gapLines: string[];
  };
  downstreamCount: number | null;
  reachedCount: number;
  affected: ThreadImpactPayload["affected"];
  gaps: ThreadImpactPayload["gaps"];
  aiConsequences: { objectRef: string; consequence: string }[];
  aiDropped: string[];
  narrative: string | null;
  model: string | null;
  providerNote: string | null;
  recorded: { report_id?: number; refused?: boolean } | null;
  recordNote: string | null;
  disclaimer: string;
}

export async function runChangeImpactAgent(input: {
  caseId: string;
  objectId: number;
  record?: boolean;
}): Promise<ChangeImpactAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-change-impact-agent",
    {
      body: {
        case_id: input.caseId,
        object_id: input.objectId,
        record: input.record ?? false,
      },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as ChangeImpactAgentResult | { error?: string };
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return payload as ChangeImpactAgentResult;
}

export async function getChangeImpactReports(
  caseId: string,
): Promise<ChangeImpactReportsPayload> {
  const { data, error } = await supabase.rpc("get_change_impact_reports", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** The RAM kernel's INPUTS for one case. Refuses; computes nothing. */
export async function getCaseRamScope(
  caseId: string,
): Promise<RamScopePayload> {
  const { data, error } = await supabase.rpc("get_case_ram_scope", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/**
 * Run the shipped RAM kernel over one case's scope and record the reading.
 *
 * THE ARITHMETIC IS THE KERNEL'S. `computeCaseRamProfile` composes
 * `allocateAvailability` and `selectWeibullMethod` — nothing is re-derived
 * here — and the RPC re-reads the scope and the refusals server-side, so the
 * lineage row cannot claim a clean profile over a scope the database says is
 * short of inputs.
 */
export async function runCaseRamAgent(caseId: string): Promise<{
  scope: RamScopePayload;
  profile: RamProfile;
  recorded: {
    report_id?: number;
    run_id?: string;
    refused?: boolean;
    refusalCount?: number;
  } | null;
}> {
  const scope = await getCaseRamScope(caseId);
  const profile = computeCaseRamProfile(scope);
  const { data, error } = await supabase.rpc("record_ram_agent_report", {
    p_case_id: caseId,
    p_kernel_version: RAM_KERNEL_VERSION,
    p_profile: profile.refused
      ? {}
      : (JSON.parse(JSON.stringify(profile)) as Record<string, unknown>),
    p_refusals: profile.refusals,
    p_narrative: ramProfileLines(profile).join("\n").slice(0, 6000),
    // No model is asked for this reading: every sentence in it restates a
    // kernel result or a refusal, and sending a reproducible fact to a
    // language model makes it probabilistic.
    p_model: null,
  });
  const recorded = unwrapRpc<{
    report_id?: number;
    run_id?: string;
    refused?: boolean;
    refusalCount?: number;
  }>(data, error, "Could not record the RAM reading");
  return { scope, profile, recorded };
}

export async function getRamAgentReports(caseId: string): Promise<{
  caseId: string;
  kernelVersion: string;
  reports: {
    id: number;
    asAt: string;
    refused: boolean;
    refusals: string[];
    scope: RamScopePayload;
    profile: Record<string, unknown>;
    kernelVersion: string;
    narrative: string | null;
    model: string | null;
    runId: string | null;
    agentKey: string;
    advisory: boolean;
    requestedBy: string | null;
  }[];
}> {
  const { data, error } = await supabase.rpc("get_ram_agent_reports", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** The composed Sync Information module (D11.09) — legs, refusals, no score. */
export async function getCaseInformationEngine(
  caseId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("get_case_information_engine", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/* ==========================================================================
 * Slice 6A — procurement, the sealed-bid tender, the contract and its
 * commitments (D6.03, D6.04, D6.05, D6.08, D6.09 — spec I.16, §24, §25).
 *
 * Every write is a definer RPC; nothing here writes a table. The reads are
 * definer too, and that is deliberate: `get_package_tender` is what enforces
 * the SEAL for the product surface, because a SECURITY DEFINER read is not
 * constrained by the row-level policy that hides sealed bids from a direct
 * table read.
 * ======================================================================== */

/** The four §25 dimensions, as the server returns them. */
export interface ProcurementPackageStatus {
  technical: string;
  commercial: string;
  manufacturing: string;
  delivery: string;
}

export interface ProcurementPackageRow {
  packageId: number;
  packageCode: string;
  title: string;
  equipmentOrScope: string | null;
  requiredDate: string | null;
  leadTimeDays: number | null;
  awardRequiredBy: string | null;
  forecastDeliveryDate: string | null;
  slippageDays: number | null;
  isMandatory: boolean;
  mandatoryBasis: string | null;
  status: ProcurementPackageStatus;
  statusUpdatedAt: string | null;
  awarded: boolean;
  awardedSupplier: string | null;
  awardedValue: number | null;
  contractCurrency: string | null;
  contractType: string | null;
  bidsCloseAt: string | null;
  bidsOpenedAt: string | null;
  /** True only of a package that was ISSUED for tender and not yet opened. */
  tendered: boolean;
  sealed: boolean;
  bidCount: number;
  wbsCode: string | null;
  scheduleFloatHours: number | null;
  schedulePositionNote: string | null;
  assessable: boolean;
  notAssessableReason: string | null;
  /**
   * Whether anything at all measures when this package will arrive. Distinct
   * from `assessable`, which answers only "can the award-by date be computed":
   * a mandatory awarded package with no forecast and no contract completion
   * date is measured by nothing, and was reported clean by every counter.
   */
  deliveryAssessable: boolean;
  deliveryNotAssessableReason: string | null;
  actualDeliveryDate: string | null;
  commitment: CommitmentPosition;
  /**
   * Slice 6B: the contract's life AFTER signature, from
   * `contract_commercial_summary`. Refuses on an unawarded package rather than
   * returning empty counters, because a package nobody awarded has no
   * commercial life to be at zero.
   */
  commercial: CommercialSummary;
}

export type CommercialSummary =
  | { answered: false; refusal: string }
  | {
      answered: true;
      awardedValue: number | null;
      currentValue: number | null;
      currency: string | null;
      changeOrdersApproved: number;
      changeOrdersDraft: number;
      changeOrderDelta: number;
      /** Null when the ONE invoice position REFUSES — never a confident zero. */
      invoices: number | null;
      invoicesAwaitingPayment: number | null;
      /** The position's own refusal, carried verbatim to the case screen. */
      invoiceRefusal: string | null;
      claimsRaised: number;
      claimsOpen: number;
      claimsSettledNet: number | null;
      /**
       * A settled claim does not move the contract by itself. The SENTENCE is
       * carried; the arithmetic that used to accompany it is gone — nothing
       * links a claim to the change order that carries it, so the difference
       * was wrong in both directions.
       */
      settlementNote: string | null;
      warrantyTerms: number;
      /** Counted off warranty_cover_position, not off `ends_on < today`. */
      warrantyExpired: number;
      /** Terms the ONE cover predicate refuses over. Counted AND rendered. */
      warrantyNotAssessable: number;
      warrantyGap: string | null;
    };

export type CommitmentPosition =
  | {
      answered: true;
      lines: number;
      total: number;
      currency: string;
      contractValue: number | null;
      variance: number | null;
      overCommitted: boolean;
      approvedLines: number;
      postedTotal: number | null;
    }
  | {
      answered: false;
      lines: number;
      total: null;
      unpricedLines?: number;
      commitmentCurrency?: string | null;
      contractCurrency?: string | null;
      refusal: string;
    };

export interface CaseProcurement {
  caseId: string;
  answered: boolean;
  packages: ProcurementPackageRow[];
  packageCount: number;
  mandatoryCount?: number;
  mandatoryAssessable?: number;
  mandatoryNotAssessable?: number;
  assessabilityNote?: string | null;
  mandatoryDeliveryNotAssessable?: number;
  deliveryAssessabilityNote?: string | null;
  refusal?: string;
  blockers: ProcurementGateBlocker[];
  blockerCount: number;
  calculationRunId?: string;
  /** null when the answering contracts are not all in one currency. */
  committedTotal?: number | null;
  committedCurrency?: string | null;
  codeVersion?: string;
}

/**
 * The §25 obligations that BLOCK a gate, in the shape
 * `case_gate_outstanding_obligations` speaks.
 *
 * Read from `case_procurement_gate_obligations` — the ONE predicate the
 * readiness screen renders and `enforce_gate_review_outstanding_obligations`
 * refuses over — never re-derived on the client from the package list. A
 * client filter is a second implementation of a rule that already has one, and
 * the two drift the first time the rule changes.
 */
export type ProcurementGateBlocker =
  | {
      type: "procurement_package_unawarded";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      awardRequiredBy: string;
      leadTimeDays: number;
      commercialStatus: string;
      mandatoryBasis: string;
    }
  | {
      type: "procurement_package_late";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      forecastDeliveryDate: string;
      slippageDays: number;
      deliveryStatus: string;
      mandatoryBasis: string;
    }
  | {
      /**
       * The leg that closes "mandatory, awarded LATE, no forecast recorded" —
       * which the first two legs between them left silent, because leg 1 stops
       * the moment anything is awarded and leg 2 needs a forecast nobody is
       * required to record. §24 makes contract_completion_date mandatory on
       * every awarded package, so this evidence is always present.
       */
      type: "procurement_package_contract_late";
      id: number;
      name: string;
      packageCode: string;
      requiredDate: string;
      contractCompletionDate: string;
      slippageDays: number;
      awardedAt: string;
      forecastDeliveryDate: string | null;
      deliveryStatus: string;
      mandatoryBasis: string;
    };

export async function getCaseProcurement(
  caseId: string,
): Promise<CaseProcurement> {
  const { data, error } = await supabase.rpc("get_case_procurement", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** The same answer AND a calculation_runs row — recorded even on a refusal. */
export async function computeCaseProcurementPosition(
  caseId: string,
): Promise<CaseProcurement> {
  const { data, error } = await supabase.rpc(
    "compute_case_procurement_position",
    { p_case_id: caseId },
  );
  return unwrap(data, error);
}

/*
 * There is deliberately NO `getCaseProcurementGateBlockers` wrapper here.
 * `case_procurement_gate_obligations` is read by `get_case_procurement`, which
 * returns its rows as `blockers` — one call, one list, one count. A second
 * client entry point onto the same predicate is a second place the screen can
 * read a different set of blockers from the one the gate wall refuses over,
 * and it had no callers.
 */

export interface ProcurementPackageInput {
  package_code: string;
  title: string;
  equipment_or_scope: string;
  scope_of_work?: string;
  exclusions?: string;
  interfaces?: string;
  acceptance_criteria?: string;
  site_conditions_stated?: boolean;
  required_date?: string;
  lead_time_days?: string;
  /**
   * OMIT IT to leave the flag exactly as it is. Sending `false` on a package
   * that IS mandatory is an ACT — it takes a gate blocker off the board — and
   * the server refuses it without `mandatory_release_basis`.
   */
  is_mandatory?: boolean;
  mandatory_basis?: string;
  /** Required to CLEAR `is_mandatory` on a package that carries it. */
  mandatory_release_basis?: string;
  wbs_code?: string;
}

export async function recordProcurementPackage(
  caseId: string,
  input: ProcurementPackageInput,
): Promise<{
  package_id: number;
  package_code: string;
  isMandatory: boolean;
  mandatoryReleased: boolean;
  awardRequiredBy: string | null;
  assessable: boolean;
  notAssessableReason: string | null;
  revised: boolean;
}> {
  const { data, error } = await supabase.rpc("record_procurement_package", {
    p_case_id: caseId,
    p_package: input,
  });
  return unwrapRpc(data, error, "Could not record the procurement package");
}

export async function setProcurementPackageStatus(
  packageId: number,
  dimension: string,
  status: string,
  basis: string,
): Promise<{
  package_id: number;
  package_code: string;
  dimension: string;
  previousStatus: string;
  status: string;
}> {
  const { data, error } = await supabase.rpc("set_procurement_package_status", {
    p_package_id: packageId,
    p_dimension: dimension,
    p_status: status,
    p_basis: basis,
  });
  return unwrapRpc(data, error, "Could not move the status dimension");
}

/**
 * The delivery forecast — the one §25 field that may move on an AWARDED
 * package, and the fact the mandatory long-lead slippage blocker measures.
 */
export async function recordPackageDeliveryForecast(
  packageId: number,
  forecastDate: string,
  basis: string,
): Promise<{
  package_id: number;
  package_code: string;
  forecastDeliveryDate: string;
  requiredDate: string;
  slippageDays: number;
  late: boolean;
  blocksGate: boolean;
}> {
  const { data, error } = await supabase.rpc(
    "record_package_delivery_forecast",
    {
      p_package_id: packageId,
      p_forecast_date: forecastDate,
      p_basis: basis,
    },
  );
  return unwrapRpc(data, error, "Could not record the delivery forecast");
}

/**
 * THE DATED RECEIPT — the only act that discharges the mandatory long-lead
 * slippage blocker.
 *
 * `set_procurement_package_status` refuses `delivery =
 * 'received_and_inspected'` BY NAME and points here: the first draft let one
 * planner type that value with a ten-character basis while the recorded dates
 * still said the equipment was 45 days late, and the gate review the wall had
 * just refused was then accepted with nothing arrived. A status somebody can
 * set is not evidence that anything arrived; a date is.
 */
export async function recordPackageDeliveryReceipt(
  packageId: number,
  receivedDate: string,
  note: string,
): Promise<{
  package_id: number;
  package_code: string;
  actualDeliveryDate: string;
  requiredDate: string | null;
  deliveryStatus: string;
  daysLate: number | null;
  arrivedLateNote: string | null;
}> {
  const { data, error } = await supabase.rpc(
    "record_package_delivery_receipt",
    {
      p_package_id: packageId,
      p_received_date: receivedDate,
      p_note: note,
    },
  );
  return unwrapRpc(data, error, "Could not record the delivery receipt");
}

export interface TenderBidder {
  bidderId: number;
  supplier: string;
  supplierCode: string;
  status: string;
  prequalificationStated: boolean;
  prequalificationBasis: string | null;
  safetyQualificationStatus: string;
  approvedVendor: boolean;
}

export interface TenderBidEvaluation {
  evaluationId: number;
  kind: string;
  outcome: string;
  score: number | null;
  rationale: string;
  evaluator: string | null;
  recordedAt: string;
}

/**
 * A bid as the server is willing to describe it.
 *
 * Every content field is `null` while `sealed` is true — the server returns it
 * that way and this type says so, so a component that renders `price ?? 0`
 * fails type review rather than turning a sealed bid into a free one.
 */
export interface TenderBid {
  bidId: number;
  bidRef: string | null;
  supplier: string;
  submittedOn: string | null;
  withdrawn: boolean;
  withdrawnReason: string | null;
  sealed: boolean;
  price: number | null;
  currency: string | null;
  labourHours: number | null;
  assumedProductivityFactor: number | null;
  durationDays: number | null;
  qualifications: string | null;
  priceBasis: string | null;
  evaluations: TenderBidEvaluation[];
}

export interface PackageTender {
  packageId: number;
  packageCode: string;
  title: string;
  equipmentOrScope: string | null;
  bidsCloseAt: string | null;
  bidsOpenedAt: string | null;
  openedBy: string | null;
  /** Issued for tender at all — a package nobody put to market has no seal. */
  tendered: boolean;
  sealed: boolean;
  /** The REDACTION rule: no bid content is legible until an open act. */
  contentSealed: boolean;
  sealNote: string | null;
  /**
   * Why the bid list is empty, when it is. An empty array meant three
   * different things — not tendered, tendered and unanswered, opened and empty
   * — and returned the same confident `[]` for all three.
   */
  bidsRefusal: string | null;
  bidders: TenderBidder[];
  bids: TenderBid[];
  contract: {
    awardedAt: string;
    awardedBy: string | null;
    supplier: string | null;
    value: number | null;
    currency: string | null;
    contractType: string | null;
    start: string | null;
    completion: string | null;
    performanceRequirements: string | null;
    awardBasis: string | null;
    warrantyTermId: number | null;
    authorityTier: string | null;
    authorityCeiling: number | null;
  } | null;
  commitment: CommitmentPosition;
  /**
   * The commitment lines themselves, so the screen renders the position from
   * the same rows the server summed rather than from a total it has to trust.
   */
  commitmentLines: {
    lineRef: string;
    description: string;
    amount: number | null;
    currency: string;
    costItemRef: string | null;
    approved: boolean;
    posted: boolean;
  }[];
}

export async function getPackageTender(
  packageId: number,
): Promise<PackageTender> {
  const { data, error } = await supabase.rpc("get_package_tender", {
    p_package_id: packageId,
  });
  return unwrap(data, error);
}

export async function invitePackageBidder(
  packageId: number,
  supplierId: number,
  prequalificationBasis?: string,
): Promise<{
  bidder_id: number;
  supplier: string;
  prequalificationStated: boolean;
  prequalificationGap: string | null;
  safetyQualificationStatus: string;
  safetyQualificationWarning: string | null;
}> {
  const { data, error } = await supabase.rpc("invite_package_bidder", {
    p_package_id: packageId,
    p_supplier_id: supplierId,
    p_prequalification_basis: prequalificationBasis ?? null,
  });
  return unwrapRpc(data, error, "Could not invite the bidder");
}

export async function openPackageBidding(
  packageId: number,
  closeAt: string,
): Promise<{
  package_id: number;
  package_code: string;
  bidsCloseAt: string;
  commercialStatus: string;
  invitedBidders: number;
}> {
  const { data, error } = await supabase.rpc("open_package_bidding", {
    p_package_id: packageId,
    p_close_at: closeAt,
  });
  return unwrapRpc(data, error, "Could not issue the tender");
}

export interface SealedBidInput {
  supplier_code: string;
  price: string;
  currency: string;
  bid_ref?: string;
  labour_hours?: string;
  assumed_productivity_factor?: string;
  duration_days?: string;
  inclusions?: string;
  qualifications?: string;
  price_basis?: string;
}

export async function submitSealedBid(
  packageId: number,
  input: SealedBidInput,
): Promise<{
  bid_id: number;
  supplier: string;
  bidRef: string;
  sealed: boolean;
  productivityStated: boolean;
  comparabilityWarning: string | null;
}> {
  const { data, error } = await supabase.rpc("submit_sealed_bid", {
    p_package_id: packageId,
    p_bid: input,
  });
  return unwrapRpc(data, error, "Could not lodge the bid");
}

export async function withdrawSealedBid(
  bidId: number,
  reason: string,
): Promise<{ bid_id: number; withdrawn: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("withdraw_sealed_bid", {
    p_bid_id: bidId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not withdraw the bid");
}

/** THE OPEN ACT — the single moment the seal comes off (§70: a human act). */
export async function openPackageBids(
  packageId: number,
  note: string,
): Promise<{
  package_id: number;
  package_code: string;
  openedAt: string;
  liveBids: number;
  withdrawnBids: number;
  commercialStatus: string;
}> {
  const { data, error } = await supabase.rpc("open_package_bids", {
    p_package_id: packageId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not open the bids");
}

export interface BidEvaluationInput {
  evaluation_kind: string;
  outcome: string;
  rationale: string;
  score?: string;
  criteria?: Record<string, unknown>;
}

export async function recordBidEvaluation(
  bidId: number,
  input: BidEvaluationInput,
): Promise<{
  evaluation_id: number;
  evaluationKind: string;
  outcome: string;
  score: number | null;
  frozen: boolean;
  awaiting: string | null;
}> {
  const { data, error } = await supabase.rpc("record_bid_evaluation", {
    p_bid_id: bidId,
    p_evaluation: input,
  });
  return unwrapRpc(data, error, "Could not record the evaluation");
}

export interface ContractAwardInput {
  bid_id: string;
  contract_type: string;
  performance_requirements: string;
  award_basis: string;
  contract_start_date: string;
  contract_completion_date: string;
  warranty_term_id?: string;
}

/** §41-43 + §70: routed through authority_limits.action_type='contract_award'. */
export async function awardContract(
  packageId: number,
  input: ContractAwardInput,
): Promise<{
  package_id: number;
  package_code: string;
  supplier: string;
  value: number;
  currency: string;
  contractType: string;
  awardedUnder: string;
  ceiling: number;
  warrantyLinked: boolean;
  warrantyGap: string | null;
  /** What this awarder had already committed on this case (4D-R8). */
  alreadyAwardedOnCase: number;
  /** Live bids on the package that carry NO evaluation at all. */
  unevaluatedLiveBids: string | null;
  unevaluatedFieldNote: string | null;
  commitmentNext: string;
}> {
  const { data, error } = await supabase.rpc("award_contract", {
    p_package_id: packageId,
    p_award: input,
  });
  return unwrapRpc(data, error, "Could not award the contract");
}

export interface CommitmentLineInput {
  line_ref: string;
  cost_item_ref: string;
  description: string;
  basis: string;
  /** Omitted entirely when the price is not agreed — never sent as "0". */
  amount?: string;
}

export async function recordContractCommitmentLine(
  packageId: number,
  input: CommitmentLineInput,
): Promise<{
  line_id: number;
  line_ref: string;
  costItemRef: string;
  amount: number | null;
  currency: string;
  priced: boolean;
  unpricedNote: string | null;
}> {
  const { data, error } = await supabase.rpc(
    "record_contract_commitment_line",
    { p_package_id: packageId, p_line: input },
  );
  return unwrapRpc(data, error, "Could not record the commitment line");
}

/** §70: approving a commitment moves money in Slice 4's ONE cost model. */
export async function approveContractCommitments(
  packageId: number,
  note: string,
): Promise<{
  package_id: number;
  package_code: string;
  total: number;
  currency: string;
  costLinesPosted: number;
  contractValue: number | null;
  variance: number | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("approve_contract_commitments", {
    p_package_id: packageId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not approve the commitments");
}

/** The organization's suppliers, for the bidder-invitation selector. */
export async function listOrgSuppliers(): Promise<
  {
    id: number;
    name: string;
    supplierCode: string;
    kind: string;
    approvedVendor: boolean;
    safetyQualificationStatus: string;
  }[]
> {
  const { data, error } = await supabase
    .from("suppliers")
    .select(
      "id, name, supplier_code, supplier_kind, approved_vendor, safety_qualification_status",
    )
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as number,
    name: row.name as string,
    supplierCode: row.supplier_code as string,
    kind: row.supplier_kind as string,
    approvedVendor: row.approved_vendor as boolean,
    safetyQualificationStatus: row.safety_qualification_status as string,
  }));
}

/** The case's coded cost lines, for the commitment-line selector (D5.29). */
export async function listCaseCostItemRefs(
  caseId: string,
): Promise<{ ref: string; description: string; currency: string }[]> {
  const { data, error } = await supabase
    .from("project_cost_items")
    .select("cost_item_ref, description, currency")
    .eq("development_case_id", caseId)
    .order("cost_item_ref");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ref: row.cost_item_ref as string,
    description: row.description as string,
    currency: row.currency as string,
  }));
}

/* ═════════════════════ Sync Develop Slice 6B ═══════════════════════════════
 * The commercial life of a contract after signature (D6.06), the vendor
 * quality record accrued from acts (D6.01) and the specification-to-failure
 * commercial thread (D6.07).
 *
 * Every wrapper below is a thin call onto a definer RPC. None of them computes
 * anything: what a contract is worth, what is committed, what is invoiced and
 * whether a warranty covers are each answered by exactly one server predicate,
 * and a second arithmetic here would be a second answer.
 * ═════════════════════════════════════════════════════════════════════════ */

export interface ChangeOrderInput {
  change_order_ref: string;
  description: string;
  reason: string;
  /** Signed. Positive commits more of the owner's money, negative releases it. */
  value_delta: string;
  time_delta_days?: string;
}

export async function recordContractChangeOrder(
  packageId: number,
  input: ChangeOrderInput,
): Promise<{
  change_order_id: number;
  change_order_ref: string;
  package_code: string;
  valueDelta: number;
  currency: string;
  timeDeltaDays: number;
  contractValueNow: number;
  contractValueIfApproved: number;
  revised: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_contract_change_order", {
    p_package_id: packageId,
    p_change: input,
  });
  return unwrapRpc(data, error, "Could not record the change order");
}

/**
 * §41-43 + §70: routed through THE SAME authority evaluator and the same
 * `authority_limits.action_type = 'contract_award'` the award used, with the
 * ceiling cumulative across this person's awards AND change orders on the case.
 */
export async function decideContractChangeOrder(
  changeOrderId: number,
  decision: "approved" | "rejected",
  note: string,
): Promise<{
  change_order_id: number;
  change_order_ref: string;
  status: string;
  contractValue: number;
  currency: string;
  valueDelta?: number;
  contractValueBefore?: number;
  approvedUnder?: string;
  ceiling?: number;
  commitmentNote?: string;
}> {
  const { data, error } = await supabase.rpc("decide_contract_change_order", {
    p_change_order_id: changeOrderId,
    p_decision: decision,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not decide the change order");
}

export async function withdrawContractChangeOrder(
  changeOrderId: number,
  reason: string,
): Promise<{ change_order_id: number; status: string; note: string }> {
  const { data, error } = await supabase.rpc("withdraw_contract_change_order", {
    p_change_order_id: changeOrderId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not withdraw the change order");
}

export interface ContractClaimInput {
  claim_ref: string;
  direction: "from_supplier" | "against_supplier";
  grounds: string;
  claimed_value: string;
  time_claimed_days?: string;
  raised_on?: string;
}

export async function recordContractClaim(
  packageId: number,
  input: ContractClaimInput,
): Promise<{
  claim_id: number;
  claim_ref: string;
  direction: string;
  claimedValue: number;
  currency: string;
  status: string;
  revised: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_contract_claim", {
    p_package_id: packageId,
    p_claim: input,
  });
  return unwrapRpc(data, error, "Could not record the claim");
}

/** §70: answering a claim is a human determination, and it FREEZES the claim. */
export async function answerContractClaim(
  claimId: number,
  answer: "accepted" | "partially_accepted" | "rejected",
  note: string,
  settledValue?: string,
  settledTimeDays?: string,
): Promise<{
  claim_id: number;
  claim_ref: string;
  status: string;
  claimedValue: number;
  settledValue: number | null;
  currency: string;
  frozen: boolean;
  carryNote: string | null;
}> {
  const { data, error } = await supabase.rpc("answer_contract_claim", {
    p_claim_id: claimId,
    p_answer: answer,
    p_note: note,
    p_settled_value: settledValue ?? null,
    p_settled_time_days: settledTimeDays ?? null,
  });
  return unwrapRpc(data, error, "Could not answer the claim");
}

export async function withdrawContractClaim(
  claimId: number,
  reason: string,
): Promise<{ claim_id: number; status: string; note: string }> {
  const { data, error } = await supabase.rpc("withdraw_contract_claim", {
    p_claim_id: claimId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not withdraw the claim");
}

export interface ContractInvoiceInput {
  invoice_ref: string;
  invoice_date: string;
  description: string;
  gross_amount: string;
  period_start?: string;
  period_end?: string;
}

export async function recordContractInvoice(
  packageId: number,
  input: ContractInvoiceInput,
): Promise<{
  invoice_id: number;
  invoice_ref: string;
  grossAmount: number;
  currency: string;
  status: string;
  revised: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_contract_invoice", {
    p_package_id: packageId,
    p_invoice: input,
  });
  return unwrapRpc(data, error, "Could not record the invoice");
}

/** §70: certification is the statement that money is due, and it freezes the row. */
export async function certifyContractInvoice(
  invoiceId: number,
  decision: "certified" | "rejected",
  note: string,
  certifiedAmount?: string,
): Promise<{
  invoice_id: number;
  invoice_ref: string;
  status: string;
  certifiedAmount?: number;
  certifiedTotal?: number;
  contractValue?: number;
  remainingToCertify?: number;
  withheld?: number | null;
  frozen: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("certify_contract_invoice", {
    p_invoice_id: invoiceId,
    p_decision: decision,
    p_note: note,
    p_certified_amount: certifiedAmount ?? null,
  });
  return unwrapRpc(data, error, "Could not certify the invoice");
}

/** Paid ONCE. A second payment is refused by name, and un-paying is refused at the table. */
export async function recordInvoicePayment(
  invoiceId: number,
  paymentReference: string,
  note: string,
): Promise<{
  invoice_id: number;
  invoice_ref: string;
  status: string;
  paidAmount: number;
  currency: string;
  paymentReference: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoiceId,
    p_payment_reference: paymentReference,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not record the payment");
}

export interface WarrantyTermInput {
  warranty_ref: string;
  covers: string;
  basis: string;
  starts_on: string;
  /** A warranty must expire: an end date, a usage limit, or both. */
  ends_on?: string;
  usage_limit?: string;
  usage_unit?: string;
  claim_window_days?: string;
  exclusions?: string;
  package_id?: string;
  asset_id?: string;
  material_id?: string;
  supplier_id?: string;
}

export async function recordWarrantyTerm(input: WarrantyTermInput): Promise<{
  warranty_id: number;
  warranty_ref: string;
  startsOn: string;
  endsOn: string | null;
  usageLimit: number | null;
  claimWindowDays: number | null;
  revised: boolean;
  coverToday: WarrantyCoverPosition;
  note: string | null;
}> {
  const { data, error } = await supabase.rpc("record_warranty_term", {
    p_term: input,
  });
  return unwrapRpc(data, error, "Could not record the warranty term");
}

/** The ONE cover predicate's answer, as the server returns it. */
export type WarrantyCoverPosition =
  | { answered: false; covered: null; refusal: string }
  | {
      answered: true;
      covered: boolean;
      reason: string;
      endsOn?: string | null;
      expiredByDays?: number;
      daysRemaining?: number | null;
      usageAssessed?: boolean;
    };

export interface WarrantyClaimInput {
  claim_ref: string;
  failure_on: string;
  claim_value: string;
  currency?: string;
  usage_at_failure?: string;
  work_order_id?: string;
}

export async function raiseWarrantyClaim(
  warrantyId: number,
  input: WarrantyClaimInput,
): Promise<{
  claim_id: number;
  claim_ref: string;
  warrantyRef: string | null;
  failureOn: string;
  claimValue: number;
  currency: string | null;
  status: string;
  cover: WarrantyCoverPosition;
  claimWindowDays: number | null;
  note: string | null;
}> {
  const { data, error } = await supabase.rpc("raise_warranty_claim", {
    p_warranty_id: warrantyId,
    p_claim: input,
  });
  return unwrapRpc(data, error, "Could not raise the warranty claim");
}

/** Records TIME_BARRED rather than submitting when the claim window has closed. */
export async function submitWarrantyClaim(
  claimId: number,
  note: string,
): Promise<{
  claim_id: number;
  claim_ref: string;
  status: string;
  daysLate?: number;
  windowClosedOn?: string;
  windowClosesOn?: string | null;
  note?: string;
}> {
  const { data, error } = await supabase.rpc("submit_warranty_claim", {
    p_claim_id: claimId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not submit the warranty claim");
}

/** §70: accepting a warranty settlement is a human act, and it freezes the claim. */
export async function answerWarrantyClaim(
  claimId: number,
  outcome: "accepted" | "rejected",
  note: string,
  recoveredValue?: string,
): Promise<{
  claim_id: number;
  claim_ref: string;
  status: string;
  claimValue: number | null;
  recoveredValue: number | null;
  shortfall: number | null;
  frozen: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("answer_warranty_claim", {
    p_claim_id: claimId,
    p_outcome: outcome,
    p_note: note,
    p_recovered_value: recoveredValue ?? null,
  });
  return unwrapRpc(data, error, "Could not answer the warranty claim");
}

export async function withdrawWarrantyClaim(
  claimId: number,
  reason: string,
): Promise<{ claim_id: number; status: string; note: string }> {
  const { data, error } = await supabase.rpc("withdraw_warranty_claim", {
    p_claim_id: claimId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not withdraw the warranty claim");
}

export interface ContractPerformanceInput {
  period_start: string;
  period_end: string;
  basis: string;
  planned_hours?: string;
  actual_hours?: string;
  planned_cost?: string;
  actual_cost?: string;
  rework_events?: string;
  safety_incidents?: string;
  quality_escapes?: string;
  note?: string;
}

/** D6.01: the write path contract_performance never had. */
export async function recordContractPerformancePeriod(
  packageId: number,
  input: ContractPerformanceInput,
): Promise<{
  performance_id: number;
  supplierId: number;
  periodStart: string;
  periodEnd: string;
  reworkEvents: number;
  safetyIncidents: number;
  qualityEscapes: number;
  revised: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc(
    "record_contract_performance_period",
    { p_package_id: packageId, p_period: input },
  );
  return unwrapRpc(data, error, "Could not record the performance period");
}

/** One contract's whole commercial life, every figure from its own predicate. */
export interface ContractCommercial {
  packageId: number;
  packageCode: string;
  answered: boolean;
  refusal?: string;
  supplier?: string | null;
  supplierId?: number | null;
  contractType?: string | null;
  awardedValue?: number | null;
  currency?: string | null;
  currentValue?: number | null;
  contractStartDate?: string | null;
  contractCompletionDate?: string | null;
  summary?: Record<string, unknown>;
  commitment?: Record<string, unknown>;
  invoicePosition?: Record<string, unknown>;
  changeOrders?: {
    changeOrderId: number;
    changeOrderRef: string;
    description: string;
    reason: string;
    valueDelta: number;
    currency: string;
    timeDeltaDays: number;
    status: string;
    decidedAt: string | null;
    decisionNote: string | null;
    contractValueBefore: number | null;
    contractValueAfter: number | null;
    frozen: boolean;
  }[];
  invoices?: {
    invoiceId: number;
    invoiceRef: string;
    invoiceDate: string;
    description: string;
    grossAmount: number;
    certifiedAmount: number | null;
    currency: string;
    status: string;
    certifiedAt: string | null;
    paidAt: string | null;
    paymentReference: string | null;
    payable: boolean;
    frozen: boolean;
    withheld: number | null;
  }[];
  claims?: {
    claimId: number;
    claimRef: string;
    direction: string;
    grounds: string;
    claimedValue: number;
    currency: string;
    timeClaimedDays: number;
    raisedOn: string;
    status: string;
    settledValue: number | null;
    answeredAt: string | null;
    answerNote: string | null;
    frozen: boolean;
  }[];
  warranties?: {
    warrantyId: number;
    warrantyRef: string | null;
    startsOn: string;
    endsOn: string | null;
    usageLimit: number | null;
    usageUnit: string | null;
    claimWindowDays: number | null;
    covers: string | null;
    exclusions: string | null;
    coverToday: WarrantyCoverPosition;
    claims: {
      claimId: number;
      claimRef: string | null;
      failureOn: string | null;
      raisedOn: string;
      claimValue: number | null;
      recoveredValue: number | null;
      currency: string | null;
      status: string;
      coverBasis: string | null;
      answeredAt: string | null;
      frozen: boolean;
    }[];
  }[];
  basis?: string;
}

export async function getContractCommercial(
  packageId: number,
): Promise<ContractCommercial> {
  const { data, error } = await supabase.rpc("get_contract_commercial", {
    p_package_id: packageId,
  });
  return unwrap(data, error);
}

/** D6.01: accrued from acts, never stored. Refuses when no period is recorded. */
export interface VendorQualityRecord {
  supplierId: number;
  supplier: string;
  supplierCode: string;
  answered: boolean;
  refusal?: string;
  periods?: number;
  firstPeriod?: string | null;
  lastPeriod?: string | null;
  awardedContracts?: number;
  plannedHours?: number | null;
  actualHours?: number | null;
  productivityFactor?: number | null;
  productivityNote?: string | null;
  /** Refuses across currencies and over periods that sit on no contract. */
  cost?: {
    answered: boolean;
    refusal?: string;
    currency?: string | null;
    plannedCost?: number | null;
    actualCost?: number | null;
    costPerformanceFactor?: number | null;
    costFactorNote?: string | null;
  };
  reworkEvents?: number;
  reworkPerThousandHours?: number | null;
  reworkRateNote?: string | null;
  safetyIncidents?: number;
  qualityEscapes?: number;
  deliveries?: {
    recorded: number;
    assessable: number;
    onTime: number;
    rejectedOnReceipt: number;
    onTimeRate: number | null;
    /** "100% on time over deliveries nobody dated" is what this prevents. */
    refusal: string | null;
  };
  warranty?: {
    terms: number;
    claims: number;
    accepted: number;
    timeBarred: number;
    claimedValue: number | null;
    recoveredValue: number | null;
    currency: string | null;
    refusal: string | null;
    /** Cover was real and the entitlement lapsed — money not recovered. */
    timeBarredNote: string | null;
  };
  /** Signed by direction and single-currency, or a refusal. Never a bare sum. */
  contractClaims?: {
    raised: number;
    currency?: string | null;
    settledFromSupplier?: number | null;
    settledAgainstSupplier?: number | null;
    settledNet?: number | null;
    refusal?: string | null;
  };
  approvedVendor?: boolean;
  safetyQualificationStatus?: string;
  qualificationExpired?: boolean;
  basis?: string;
}

export async function getVendorQualityRecord(
  supplierId: number,
): Promise<VendorQualityRecord> {
  const { data, error } = await supabase.rpc("get_vendor_quality_record", {
    p_supplier_id: supplierId,
  });
  return unwrap(data, error);
}

/** D6.07: the Specification → ProcurementPackage hop of the commercial thread. */
export async function linkPackageSpecification(
  packageId: number,
  requirementRef: string,
  basis: string,
): Promise<{
  link_id: number;
  package_code: string;
  requirementRef: string;
  requirement: string;
  derivedFromFailureMode: string | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("link_package_specification", {
    p_package_id: packageId,
    p_requirement_ref: requirementRef,
    p_basis: basis,
  });
  return unwrapRpc(data, error, "Could not link the specification");
}

export interface SpecificationFailureThread {
  requirementRef: string;
  requirement: string;
  category?: string;
  derivedFromFailureMode: string | null;
  answered: boolean;
  refusal?: string;
  packages?: {
    packageId: number;
    packageCode: string;
    title: string;
    linkBasis: string;
    bids: number;
    awarded: boolean;
    contractValue: number | null;
    currency: string | null;
    supplier: string | null;
    hopNote: string | null;
  }[];
  packageCount?: number;
  awardedPackages?: number;
  vendors?: { supplierId: number; supplier: string; approvedVendor: boolean }[];
  materials?: number;
  installedAssets?: number;
  failures?: {
    failureMode: string;
    occurrences: number;
    assetsAffected: number;
    firstSeen: string | null;
    lastSeen: string | null;
  }[];
  failureTotal?: number;
  failureNote?: string | null;
  backward?: {
    failureMode: string;
    occurrences: number;
    assetsAffected: number;
    requirementsReferencing: number;
    loopClosed: boolean;
  }[];
  backwardNote?: string | null;
  basis?: string;
}

export async function getSpecificationFailureThread(
  requirementRef: string,
): Promise<SpecificationFailureThread> {
  const { data, error } = await supabase.rpc(
    "get_specification_failure_thread",
    { p_requirement_ref: requirementRef },
  );
  return unwrap(data, error);
}

/** The case's requirements, for the specification-link selector (D4.16). */
export async function listCaseRequirementRefs(): Promise<
  { ref: string; requirement: string; category: string }[]
> {
  const { data, error } = await supabase
    .from("design_requirements")
    .select("requirement_ref, requirement, category")
    .order("requirement_ref");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ref: row.requirement_ref as string,
    requirement: row.requirement as string,
    category: row.category as string,
  }));
}

/* ───────────────── Slice 7A — Advanced Work Packaging (D7.17, D7.10,
   D7.18, D7.07). Every write is a definer RPC; every number rendered by the
   panel comes from the server, because there is ONE forward projection
   (get_package_constraint_burndown) and one readiness verdict
   (release_work_package). ───────────────────────────────────────────────── */

export interface WorkPackageConstraint {
  constraintId: string;
  kind: string;
  state: string;
  isHard: boolean;
  description: string;
  ownerRole: string | null;
  requiredBy: string | null;
  expectedClearDate: string | null;
  probabilityOfClearance: number | null;
  scheduleImpactDays: number | null;
  verifiedAt: string | null;
  /** 'derived' when a machine raised it, 'manual' when a person recorded it. */
  sourceKind?: string | null;
  /**
   * The server's own provenance key. A row the field-readiness assessment
   * DERIVED from a canonical store cannot be cleared by hand
   * (20261211090200), and the screen reads this rather than restating the rule.
   */
  sourceRef?: string | null;
}

export interface WorkPackageRow {
  packageId: number;
  packageCode: string;
  title: string;
  packageType: string;
  level: number;
  /** The parent's ACTUAL package_type (null when there is no parent). */
  parentType: string | null;
  /** The type the chain rule says the parent must be (null for the head). */
  parentTypeExpected: string | null;
  /** True when the two differ — a broken chain the surface can now report. */
  parentTypeDiverges: boolean;
  parentPackageId: number | null;
  parentPackageCode: string | null;
  area: string | null;
  wbsCode: string | null;
  scope: string;
  requiredBy: string | null;
  status: string;
  releasedAt: string | null;
  releaseNote: string | null;
  releasedBy: string | null;
  workOrders: {
    workOrderId: string;
    woNumber: string | null;
    title: string;
    executionStatus: string | null;
    basis: string;
  }[];
  constraints: {
    recorded: number;
    openHard: number;
    satisfied: number;
    items: WorkPackageConstraint[];
  };
  /** Verbatim from sync_work_package_release_verdict — the sentence the
   *  release door refuses with. Never restated on the client. */
  readiness: string;
  readinessVerdict:
    | "ready_for_human"
    | "unassessed"
    | "empty"
    | "parent_unreleased"
    | "not_ready"
    // The seventh state (20261211090200): a RECORDED field-readiness
    // assessment the canonical stores have moved past. It refuses.
    | "stale"
    | "released"
    | "cancelled"
    | "not_found";
  canRelease: boolean;
}

export interface CaseWorkPackages {
  answered: boolean;
  refusal?: string;
  caseId?: string;
  packageCount?: number;
  packages?: WorkPackageRow[];
  chain?: string[];
  basis?: string;
}

/** D7.17/D7.10: the case's AWP chain, its work and its constraint position. */
export async function getCaseWorkPackages(
  caseId: string,
): Promise<CaseWorkPackages> {
  const { data, error } = await supabase.rpc("get_case_work_packages", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

/** D7.17 (§27): records or revises a typed work package on a case. */
export async function recordWorkPackage(
  caseId: string,
  pkg: {
    package_code: string;
    title: string;
    package_type: string;
    scope: string;
    area?: string;
    parent_package_code?: string;
    wbs_code?: string;
    required_by?: string;
  },
): Promise<{
  work_package_id: number;
  package_code: string;
  package_type: string;
  level: number;
  parentType: string | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("record_work_package", {
    p_case_id: caseId,
    p_package: pkg,
  });
  return unwrapRpc(data, error, "Could not record the work package");
}

/** D7.17: puts an existing work order into a package. work_orders is untouched. */
export async function assignWorkToPackage(
  packageId: number,
  workOrderId: string,
  basis: string,
): Promise<{
  membership_id: number;
  package_code: string;
  work_order: string;
}> {
  const { data, error } = await supabase.rpc("assign_work_to_package", {
    p_package_id: packageId,
    p_work_order_id: workOrderId,
    p_basis: basis,
  });
  return unwrapRpc(data, error, "Could not add the work order to the package");
}

/** D7.18 (§28): records one of the ten spec constraint types on a package. */
export async function recordPackageConstraint(
  packageId: number,
  constraint: {
    constraint_type: string;
    description: string;
    basis: string;
    phase?: string;
    is_hard?: boolean;
    owner_role?: string;
    owner_id?: string;
    work_order_id?: string;
    required_by?: string;
  },
): Promise<{
  constraint_id: string;
  package_code: string;
  specType: string;
  constraint_kind: string;
  state: string;
}> {
  const { data, error } = await supabase.rpc("record_package_constraint", {
    p_package_id: packageId,
    p_constraint: constraint,
  });
  return unwrapRpc(data, error, "Could not record the constraint");
}

/** I.28 (D7.07): the forward-looking fields — required-by, expected clear,
 *  probability with its basis, schedule impact with its basis. */
export async function forecastPackageConstraint(
  constraintId: string,
  forecast: {
    required_by?: string;
    expected_clear_date?: string;
    probability_of_clearance?: string;
    probability_basis?: string;
    schedule_impact_days?: string;
    impact_basis?: string;
  },
): Promise<{
  constraint_id: string;
  required_by: string | null;
  expected_clear_date: string | null;
  probability_of_clearance: number | null;
  schedule_impact_days: number | null;
  note: string;
}> {
  const { data, error } = await supabase.rpc("forecast_package_constraint", {
    p_constraint_id: constraintId,
    p_forecast: forecast,
  });
  return unwrapRpc(data, error, "Could not record the forecast");
}

/** D7.18 × §70: sets a package constraint's state. Satisfied needs a person. */
export async function clearPackageConstraint(
  constraintId: string,
  state: string,
  basis: string,
): Promise<{ constraint_id: string; state: string; package_code: string }> {
  const { data, error } = await supabase.rpc("clear_package_constraint", {
    p_constraint_id: constraintId,
    p_state: state,
    p_basis: basis,
  });
  return unwrapRpc(data, error, "Could not set the constraint state");
}

/** D7.06/D7.17 × §70: the READY / NOT READY release. */
export async function releaseWorkPackage(
  packageId: number,
  note: string,
): Promise<{
  work_package_id: number;
  package_code: string;
  status: string;
  constraintsChecked: number;
  workOrders: number;
  note: string;
}> {
  const { data, error } = await supabase.rpc("release_work_package", {
    p_package_id: packageId,
    p_note: note,
  });
  return unwrapRpc(data, error, "Could not release the work package");
}

/** D7.17: withdraws a package — the remedy the DELETE refusals all name. The
 *  release record, if there is one, is preserved rather than erased. */
export async function cancelWorkPackage(
  packageId: number,
  reason: string,
): Promise<{
  work_package_id: number;
  package_code: string;
  status: string;
  wasReleased: boolean;
  note: string;
}> {
  const { data, error } = await supabase.rpc("cancel_work_package", {
    p_package_id: packageId,
    p_reason: reason,
  });
  return unwrapRpc(data, error, "Could not cancel the work package");
}

export interface PackageBurndownConstraint {
  constraintId: string;
  kind: string;
  state: string;
  isHard: boolean;
  description: string;
  basis: string;
  ownerRole: string | null;
  ownerId: string | null;
  workOrder: string | null;
  requiredBy: string | null;
  expectedClearDate: string | null;
  probabilityOfClearance: number | null;
  probabilityBasis: string | null;
  scheduleImpactDays: number | null;
  impactBasis: string | null;
  /** lapsed | will_block | expected_clear | unforecast | not_assessable */
  forecast: string;
  /** Days late against required_by, or (for `lapsed`) days since the forecast passed. */
  daysLate: number | null;
  /** Days the expected clear date falls beyond the end of the horizon. */
  daysBeyondHorizon: number | null;
  inHorizon: boolean;
}

export interface PackageBurndown {
  answered: boolean;
  refusal?: string;
  packageId?: number;
  packageCode?: string;
  packageType?: string;
  level?: number;
  asOf?: string;
  horizonDays?: number;
  horizonEnd?: string;
  constraintsRecorded?: number;
  hardConstraints?: number;
  openConstraints?: number;
  openInHorizon?: number;
  willBlock?: number;
  expectedClear?: number;
  /** Open constraints whose forecast clear date has already passed. */
  lapsed?: number;
  unforecast?: number;
  notAssessable?: number;
  statedScheduleImpactDays?: number | null;
  forecastComplete?: boolean;
  projectedConstraintFreeDate?: string | null;
  projectedConstraintFreeRefusal?: string | null;
  constraints?: PackageBurndownConstraint[];
  refusals?: { reason: string; scope: string }[];
  basis?: string;
  calculationRunId?: string;
  codeVersion?: string;
  recorded?: boolean;
  recordNote?: string;
}

// `get_package_constraint_burndown` deliberately has NO service wrapper. It is
// the shared predicate `compute_package_constraint_burndown` delegates to, and
// a wrapper here would be an exported function with no caller — the register's
// own demoted "dead RPC" pattern. The panel takes the RECORDED projection, so
// every burn-down a person sees leaves a lineage row behind it.

/** D7.07: the same projection, recorded as an immutable calculation_runs row. */
export async function computePackageConstraintBurndown(
  packageId: number,
  horizonDays: number,
): Promise<PackageBurndown> {
  const { data, error } = await supabase.rpc(
    "compute_package_constraint_burndown",
    { p_package_id: packageId, p_horizon_days: horizonDays },
  );
  return unwrap(data, error);
}

export interface PackageBurndownHistory {
  answered: boolean;
  refusal?: string;
  packageId?: number;
  packageCode?: string;
  runCount?: number;
  runs?: {
    runId: string;
    computedAt: string;
    codeVersion: string;
    status: string;
    method: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown> | null;
    refusals: { reason: string; scope: string }[];
  }[];
  basis?: string;
}

/** D7.07: the recorded history, read back verbatim. Never recomputed. */
export async function getPackageBurndownHistory(
  packageId: number,
  limit = 20,
): Promise<PackageBurndownHistory> {
  const { data, error } = await supabase.rpc("get_package_burndown_history", {
    p_package_id: packageId,
    p_limit: limit,
  });
  return unwrap(data, error);
}

/** The case's work orders, for the package-membership selector (D7.17). */
export async function listCaseWorkOrderOptions(): Promise<
  { id: string; label: string; status: string | null }[]
> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, wo_number, title, status")
    .order("wo_number", { nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    label: `${(row.wo_number as string | null) ?? "—"} · ${row.title as string}`,
    status: (row.status as string | null) ?? null,
  }));
}

/* ───────────────── Slice 7B — field readiness on ONE engine (D7.05, D7.06,
   D7.11, D7.12, D7.19, D13.09). RULING 22: there is one field-readiness
   predicate at the database and one release verdict, and this module reads
   both rather than restating either. No function below computes whether an
   element is ready or whether a package is. ──────────────────────────────── */

export interface FieldReadyElementRow {
  key: string;
  label: string;
  /** "derived" — a canonical store answered it. "declared" — none can. */
  basisKind: string;
  /** ready | blocked | not_applicable | unverifiable */
  state: string;
  detail: string;
  source: string;
  constraintKind?: string | null;
  /** The constraint currently holding this element, when one is recorded. */
  constraint?: {
    constraintId: string;
    state: string;
    isHard: boolean;
    sourceKind: string;
    basis: string;
    ownerRole: string | null;
    requiredBy: string | null;
    expectedClearDate: string | null;
    verifiedAt: string | null;
  } | null;
}

/**
 * A place where the RECORDED assessment no longer describes the work — the
 * itemization behind the ONE verdict's `stale` state (20261211090200). The
 * server states these; nothing here derives one.
 */
export interface FieldReadinessGap {
  workOrderId: string;
  woNumber: string | null;
  element: string;
  label: string;
  /** blocked_and_unheld | unanswerable_and_unheld | never_asked | unreadable */
  reason: string;
  detail: string;
  sentence: string;
}

export interface FieldReadyWorkOrder {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  executionStatus?: string | null;
  elements: FieldReadyElementRow[];
  ready?: number;
  blocked?: number;
  notApplicable?: number;
  unverifiable?: number;
}

export interface PackageFieldReadiness {
  answered: boolean;
  refusal?: string;
  packageId?: number;
  packageCode?: string;
  packageType?: string;
  status?: string;
  workOrders?: number;
  items?: FieldReadyWorkOrder[];
  /** Whether an assessment was ever RECORDED. Never defaulted to true. */
  assessed?: boolean;
  assessedAt?: string | null;
  assessmentRunId?: string | null;
  assessmentCodeVersion?: string | null;
  assessmentNote?: string;
  /** Verbatim from sync_work_package_release_verdict. Never restated here. */
  readiness?: string;
  readinessVerdict?: string;
  canRelease?: boolean;
  openConstraints?: {
    constraint_id: string;
    kind: string;
    state: string;
    description: string;
    owner_role: string | null;
    required_by: string | null;
    expected_clear_date: string | null;
  }[];
  /** Empty unless the verdict is `stale`. Composed, never recomputed. */
  fieldReadinessGaps?: FieldReadinessGap[];
  basis?: string;
}

/** D7.11/D7.12: WHICH element is not ready, per work order in the package. */
export async function getPackageFieldReadiness(
  packageId: number,
): Promise<PackageFieldReadiness> {
  const { data, error } = await supabase.rpc("get_package_field_readiness", {
    p_package_id: packageId,
  });
  return unwrap(data, error);
}

export interface FieldReadinessAssessment {
  answered: boolean;
  refusal?: string;
  packageId?: number;
  packageCode?: string;
  workOrders?: number;
  elementsPerWorkOrder?: number;
  derivedBlockersRecorded?: number;
  /** Derived elements no store could answer, recorded as questions. */
  derivedQuestionsRaised?: number;
  declaredQuestionsRaised?: number;
  unverifiableElements?: number;
  previousDerivedRowsReplaced?: number;
  constraintsWritten?: number;
  items?: FieldReadyWorkOrder[];
  calculationRunId?: string;
  codeVersion?: string;
  verdict?: string;
  readiness?: string;
  canRelease?: boolean;
  note?: string;
}

/**
 * D7.05/D7.12: walks the ten elements for every work order in the package and
 * records what is NOT established as constraints the ONE release verdict
 * already refuses on.
 *
 * It declares nothing ready. §70 reserves that for a person, and the database
 * enforces it — this call cannot produce a `satisfied` constraint whoever runs
 * it.
 */
export async function assessPackageFieldReadiness(
  packageId: number,
): Promise<FieldReadinessAssessment> {
  const { data, error } = await supabase.rpc("assess_package_field_readiness", {
    p_package_id: packageId,
  });
  return unwrap(data, error);
}

export interface ExecutionReadinessPackage {
  packageId: number;
  packageCode: string;
  title: string;
  packageType: string;
  level: number;
  caseId: string;
  caseTitle: string | null;
  area: string | null;
  requiredBy: string | null;
  status: string;
  /** Verbatim from the ONE predicate. The board restates no rule. */
  readiness: string;
  readinessVerdict: string;
  canRelease: boolean;
  constraintsRecorded: number;
  openHard: number;
  workOrders: number;
  blockingItems: {
    constraintId: string;
    kind: string;
    state: string;
    description: string;
    basis: string;
    sourceKind: string;
    ownerRole: string | null;
    ownerEmail: string | null;
    requiredBy: string | null;
    expectedClearDate: string | null;
  }[];
  /** Empty unless the verdict is `stale`. Composed, never recomputed. */
  fieldReadinessGaps: FieldReadinessGap[];
  fieldReadinessAssessed: boolean;
  fieldReadinessAssessedAt: string | null;
  fieldReadinessRunId: string | null;
  fieldReadinessOutputs: Record<string, unknown> | null;
  fieldReadinessNote: string;
}

export interface ExecutionReadinessBoard {
  answered: boolean;
  refusal?: string;
  caseId?: string | null;
  packageCount?: number;
  awaitingRelease?: number;
  packages?: ExecutionReadinessPackage[];
  basis?: string;
  note?: string;
}

/**
 * D13.09 / D7.19: the Execution Readiness board — the packages a person must
 * act on, composed from recorded verdicts.
 */
export async function getExecutionReadinessBoard(
  caseId?: string | null,
): Promise<ExecutionReadinessBoard> {
  const { data, error } = await supabase.rpc("get_execution_readiness_board", {
    p_case_id: caseId ?? null,
  });
  return unwrap(data, error);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sync Develop Slice 7C — resources, competency readiness, workface metrics.
 *
 * EVERY PERCENTAGE HERE ARRIVES AS A `MetricRatio`, NOT AS A NUMBER, and that
 * is the whole shape of this section. `sync_metric_ratio` returns a refusal
 * for an empty denominator, an unassessed set, a non-finite input, a negative
 * count and a numerator larger than its denominator, and the type below makes
 * a caller destructure `answered` before it can reach `pct`. A screen cannot
 * accidentally render 0% over a window nobody planned work into, because
 * there is no number there to render.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The five ways `sync_metric_ratio` refuses, plus the one way it answers. */
export type MetricRatioKind =
  | "computed"
  | "empty_denominator"
  | "not_assessed"
  | "not_finite"
  | "negative"
  | "numerator_exceeds"
  | "not_projectable";

/**
 * A DISCRIMINATED UNION, not a bag with a nullable `pct`.
 *
 * The first draft was a plain interface whose comment claimed it made "a
 * caller destructure `answered` before it can reach `pct`" — which a plain
 * interface cannot do. `Ratio` checked anyway; the type did not, so the next
 * component to render one would have compiled while printing `null%`. Now the
 * compiler refuses: `pct` exists only on the answered branch.
 */
export interface MetricRatioAnswered {
  answered: true;
  kind: "computed";
  pct: number;
  numerator: number;
  denominator: number;
  refusal?: undefined;
}

export interface MetricRatioRefused {
  answered: false;
  kind: Exclude<MetricRatioKind, "computed">;
  /** Null on every refusal. There is no number to render. */
  pct: null;
  numerator: number | null;
  denominator: number | null;
  refusal: string;
}

export type MetricRatio = MetricRatioAnswered | MetricRatioRefused;

export interface CalculationRefusal {
  reason: string;
  scope: string;
}

/* ── D7.01 — ResourceDemand / ResourceCapacity ─────────────────────────── */

export interface ResourceBalanceCell {
  category: string;
  categoryOrder: number;
  pool: string;
  periodStart: string;
  periodEnd: string;
  demandHours: number;
  demandLines: number;
  approvedLines: number;
  /** Null when no capacity is recorded — NOT ASSESSABLE, never zero. */
  capacityHours: number | null;
  weeklyHours: number | null;
  /** The craft_capacity row this cell's capacity came from, so the close act has something to name. */
  capacityId: string | null;
  capacityEffectiveFrom: string | null;
  capacityBasis: string | null;
  deductionsItemised: { kind: string; weeklyHours: number; basis: string }[];
  state:
    "within_capacity" | "at_capacity" | "over_committed" | "not_assessable";
  shortfallHours: number | null;
  detail: string;
}

export interface CaseResourceBalance {
  answered: boolean;
  refusal?: string;
  caseId?: string;
  caseTitle?: string;
  asOf?: string;
  horizonWeeks?: number;
  horizonEnd?: string;
  demandLines?: number;
  liveDemandLines?: number;
  linesInWindow?: number;
  categoriesWithDemand?: number;
  categoriesInSpec?: number;
  cells?: ResourceBalanceCell[];
  overCommitted?: number;
  atCapacity?: number;
  withinCapacity?: number;
  notAssessable?: number;
  refusals?: CalculationRefusal[];
  basis?: string;
}

/**
 * D7.01: one project's demand set beside capacity, time-phased.
 *
 * Refuses over a case with no demand recorded. That refusal is the row: a
 * project nobody has resourced and a project with no resource problem look
 * identical on a screen, and only one of them is safe.
 */
export async function getCaseResourceBalance(
  caseId: string,
  horizonWeeks = 12,
): Promise<CaseResourceBalance> {
  const { data, error } = await supabase.rpc("get_case_resource_balance", {
    p_case_id: caseId,
    p_horizon_weeks: horizonWeeks,
  });
  return unwrap(data, error);
}

export interface ResourceDemandLine {
  demandId: number;
  category: string;
  categoryOrder: number;
  pool: string;
  periodStart: string;
  periodEnd: string;
  demandHours: number;
  sourceKind: string;
  basis: string;
  workPackageId: number | null;
  packageCode: string | null;
  approved: boolean;
  approvedAt: string | null;
  approvalNote: string | null;
  withdrawn: boolean;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
}

export async function getCaseResourceDemand(caseId: string): Promise<{
  answered: boolean;
  refusal?: string;
  demand?: ResourceDemandLine[];
}> {
  const { data, error } = await supabase.rpc("get_case_resource_demand", {
    p_case_id: caseId,
  });
  return unwrap(data, error);
}

export interface ResourceWriteResult {
  answered: boolean;
  refusal?: string;
  demandId?: number;
  capacityId?: string;
  deductionId?: number;
  approved?: boolean;
  withdrawn?: boolean;
  note?: string;
}

export async function recordResourceCapacity(payload: {
  category: string;
  pool: string;
  weeklyHours: string;
  basis: string;
  siteId?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string;
}): Promise<ResourceWriteResult> {
  const { data, error } = await supabase.rpc("record_resource_capacity", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function recordCapacityDeduction(payload: {
  category: string;
  pool: string;
  deductionKind: string;
  weeklyHours: string;
  basis: string;
  siteId?: string | null;
}): Promise<ResourceWriteResult> {
  const { data, error } = await supabase.rpc("record_capacity_deduction", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function recordResourceDemand(
  caseId: string,
  payload: {
    category: string;
    pool: string;
    demandHours: string;
    periodStart: string;
    periodEnd: string;
    sourceKind: string;
    basis: string;
    workPackageId?: string | null;
  },
): Promise<ResourceWriteResult> {
  const { data, error } = await supabase.rpc("record_resource_demand", {
    p_case_id: caseId,
    p_payload: payload,
  });
  return unwrap(data, error);
}

/**
 * §70: approving a roster is a human determination, and the AI-operator
 * identity is refused at the DATABASE rather than only here.
 */
export async function approveResourceDemand(
  demandId: number,
  note: string,
): Promise<ResourceWriteResult> {
  const { data, error } = await supabase.rpc("approve_resource_demand", {
    p_demand_id: demandId,
    p_note: note,
  });
  return unwrap(data, error);
}

export async function withdrawResourceDemand(
  demandId: number,
  reason: string,
): Promise<ResourceWriteResult> {
  const { data, error } = await supabase.rpc("withdraw_resource_demand", {
    p_demand_id: demandId,
    p_reason: reason,
  });
  return unwrap(data, error);
}

/* ── D7.02 — portfolio resource conflicts ──────────────────────────────── */

export interface PortfolioResourcePool {
  category: string;
  categoryOrder: number;
  pool: string;
  from: string;
  to: string;
  committedHours: number;
  capacityHours: number | null;
  largestSingleCaseHours: number | null;
  cases: number;
  contributions: {
    caseId: string;
    caseTitle: string;
    demandHours: number;
    demandLines: number;
  }[];
  /** `collective_only` is spec I.22's own case, computed rather than implied. */
  state:
    | "within_capacity"
    | "at_capacity"
    | "over_committed"
    | "collective_only"
    | "not_assessable";
  shortfallHours: number | null;
  detail: string;
}

export interface PortfolioResourceConflicts {
  answered: boolean;
  refusal?: string;
  asOf?: string;
  horizonWeeks?: number;
  from?: string;
  to?: string;
  approvedDemandLines?: number;
  draftDemandLines?: number;
  casesWithCommitments?: number;
  pools?: PortfolioResourcePool[];
  conflicts?: number;
  collectiveOnlyConflicts?: number;
  notAssessable?: number;
  basis?: string;
}

/**
 * D7.02: collective feasibility across every project in the organization.
 *
 * "All six projects are individually executable — collectively impossible
 * because all six require the same commissioning team in Q3" is a claim no
 * per-project view can make, and `collective_only` is where it is made.
 */
export async function getPortfolioResourceConflicts(
  horizonWeeks = 12,
): Promise<PortfolioResourceConflicts> {
  const { data, error } = await supabase.rpc(
    "get_portfolio_resource_conflicts",
    { p_horizon_weeks: horizonWeeks },
  );
  return unwrap(data, error);
}

/* ── D7.03 / D7.04 — competency requirement, availability, readiness ───── */

export interface CompetencyRequirementRow {
  requirementId: number;
  competencyId: number;
  competencyKey: string;
  competencyTitle: string;
  isStatutory: boolean;
  validityMonths: number | null;
  scope: "craft" | "package";
  craft: string | null;
  workPackageId: number | null;
  packageCode: string | null;
  minHolders: number;
  basis: string;
  retired: boolean;
  retiredAt: string | null;
  retirementReason: string | null;
}

export interface CompetencyCatalogue {
  answered: boolean;
  refusal?: string;
  requirements?: CompetencyRequirementRow[];
  competencies?: {
    competencyId: number;
    competencyKey: string;
    title: string;
    kind: string;
    isStatutory: boolean;
    validityMonths: number | null;
  }[];
  members?: {
    memberId: number;
    displayName: string;
    craft: string | null;
    employeeRef: string;
    /** Inactive members are listed and marked, so a leaver can be put back on. */
    active: boolean;
  }[];
  basis?: string;
}

export async function getCompetencyRequirements(): Promise<CompetencyCatalogue> {
  const { data, error } = await supabase.rpc("get_competency_requirements", {});
  return unwrap(data, error);
}

export interface CompetencyWriteResult {
  answered: boolean;
  refusal?: string;
  competencyId?: number;
  memberId?: number;
  memberCompetencyId?: number;
  requirementId?: number;
  shiftId?: number;
  retired?: boolean;
  note?: string;
}

export async function recordCompetency(payload: {
  competencyKey: string;
  title: string;
  kind: string;
  isStatutory?: string;
  validityMonths?: string;
  issuingBody?: string;
  description?: string;
}): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("record_competency", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function recordWorkforceMember(payload: {
  employeeRef: string;
  displayName: string;
  craft?: string;
  employmentType?: string;
  employer?: string;
  fte?: string;
  siteId?: string | null;
}): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("record_workforce_member", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

/**
 * D7.03 / §70: the customer write path onto `member_competencies`, which
 * until Slice 7C only the demo seed could write. Declaring a person competent
 * is refused for the AI-operator identity at the database.
 */
export async function recordMemberCompetency(payload: {
  memberId: number;
  competencyId: number;
  grantedOn?: string;
  expiresOn?: string;
  evidenceReference: string;
}): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("record_member_competency", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function recordShiftAssignment(payload: {
  memberId: number;
  startsAt: string;
  endsAt: string;
  shiftKind?: string;
}): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("record_shift_assignment", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function recordCompetencyRequirement(payload: {
  competencyId: number;
  craft?: string;
  workPackageId?: string;
  minHolders?: string;
  basis: string;
}): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("record_competency_requirement", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

export async function retireCompetencyRequirement(
  requirementId: number,
  reason: string,
): Promise<CompetencyWriteResult> {
  const { data, error } = await supabase.rpc("retire_competency_requirement", {
    p_requirement_id: requirementId,
    p_reason: reason,
  });
  return unwrap(data, error);
}

export interface CompetencyHolder {
  memberId: number;
  /** The HOLDING's id — null where the member does not hold it at all. What a renewal names. */
  memberCompetencyId: number | null;
  displayName: string;
  craft: string | null;
  expiresOn: string | null;
  /** The FUTURE-TENSE classification. `expires_during_window` is the row. */
  whenNeeded:
    | "qualified_through"
    | "expires_during_window"
    | "already_expired"
    | "not_held";
  rosteredHoursInWindow: number;
  rostered: boolean;
  qualifiedWhenNeeded: boolean;
}

export interface CompetencyRequirementReadiness {
  requirementId: number;
  competencyKey: string;
  competencyTitle: string;
  isStatutory: boolean;
  validityMonths: number | null;
  scope: "craft" | "package";
  craft: string | null;
  minHolders: number;
  holdersQualifiedWhenNeeded: number;
  holdersQualifiedAndRostered: number;
  holdersExpiringInWindow: number;
  basis: string;
  state:
    | "met"
    | "short"
    | "qualified_but_not_rostered"
    | "roster_not_recorded"
    /**
     * NOBODY OF THAT CRAFT EXISTS. Distinct from `roster_not_recorded`, which
     * means they exist and none is rostered in this window — and both are
     * distinct from `short`, which means we looked and not enough qualify.
     */
    | "craft_not_staffed";
  /** Active members in the requirement's own craft scope, and how many are rostered. */
  candidatesInScope?: number;
  candidatesRostered?: number;
  holders: CompetencyHolder[];
  detail: string;
}

export interface CompetencyReadiness {
  answered: boolean;
  refusal?: string;
  packageId?: number;
  packageCode?: string;
  windowStart?: string;
  windowEnd?: string;
  windowFrom?: string;
  workOrders?: number;
  craftsRequired?: string[];
  requirementsInScope?: number;
  requirementsMet?: number;
  requirementsShort?: number;
  requirementsNotAssessable?: number;
  holdingsExpiringInWindow?: number;
  rosteredMembersInWindow?: number;
  labourRules?: {
    ruleKey: string;
    title: string;
    source: string;
    limitKind: string;
    limitValue: number;
    appliesToCraft: string | null;
  }[];
  requirements?: CompetencyRequirementReadiness[];
  refusals?: CalculationRefusal[];
  readyToCrew?: boolean;
  calculationRunId?: string;
  codeVersion?: string;
  recorded?: boolean;
  recordNote?: string;
  basis?: string;
}

/**
 * D7.04 (spec I.23): "14 QUALIFIED people available WHEN NEEDED".
 *
 * Asked about the WORK WINDOW, not about today. A ticket that lapses before
 * the work happens makes its holder not qualified when needed, and the server
 * says so by name rather than folding it into "not qualified".
 */
export async function getCompetencyReadiness(
  packageId: number,
  windowStart?: string | null,
  windowEnd?: string | null,
): Promise<CompetencyReadiness> {
  const { data, error } = await supabase.rpc("get_competency_readiness", {
    p_package_id: packageId,
    p_window_start: windowStart ?? null,
    p_window_end: windowEnd ?? null,
  });
  return unwrap(data, error);
}

/** The same predicate, plus an immutable lineage row (D11.29). */
export async function computeCompetencyReadiness(
  packageId: number,
  windowStart?: string | null,
  windowEnd?: string | null,
): Promise<CompetencyReadiness> {
  const { data, error } = await supabase.rpc("compute_competency_readiness", {
    p_package_id: packageId,
    p_window_start: windowStart ?? null,
    p_window_end: windowEnd ?? null,
  });
  return unwrap(data, error);
}

/* ── D7.08 + D7.20 — ONE calculation, two register rows ────────────────── */

export interface ConstraintFreePackage {
  packageId: number;
  packageCode: string;
  packageType: string;
  title: string;
  area: string | null;
  requiredBy: string;
  verdict: string;
  /** Verbatim from the ONE verdict. The screen writes no readiness sentence. */
  readiness: string;
  openHard: number;
  constraintsRecorded: number;
  forward:
    | "ready_now"
    | "forecast_clear_in_time"
    | "forecast_clear_too_late"
    /** LATE, which is a fact about the calendar rather than a gap in the
     *  constraint register — the two used to read identically. */
    | "overdue"
    | "not_projectable"
    | "unassessed";
  /** False on the overdue list: that package is outside the window this index reports. */
  inWindow: boolean;
  daysOverdue: number | null;
  projectedConstraintFreeDate: string | null;
  projectionRefusal: string | null;
}

export interface ConstraintFreeWorkIndex {
  answered: boolean;
  refusal?: string;
  caseId?: string;
  caseTitle?: string;
  asOf?: string;
  horizonDays?: number;
  horizonEnd?: string;
  unreleasedPackages?: number;
  plannedPackages?: number;
  assessedPackages?: number;
  unassessedPackages?: number;
  readyPackages?: number;
  notReadyPackages?: number;
  stalePackages?: number;
  forecastClearInTime?: number;
  notProjectable?: number;
  overduePackages?: number;
  /** §49 (D7.20), today. */
  constraintFreeWorkIndex?: MetricRatio;
  /** I.28 (D7.08), forward. The SAME calculation, its other face. */
  forwardConstraintFreeWork?: MetricRatio;
  assessmentCoverage?: MetricRatio;
  packages?: ConstraintFreePackage[];
  /**
   * Draft packages needed on a date that has already passed. They are OUTSIDE
   * the stated window and are excluded from every denominator — a percentage
   * labelled "the next N days" computed from work due last year is a number
   * about a window it never looked at — but they are listed here loudly,
   * because late unreleased work is the most actionable thing on this payload.
   */
  overdue?: ConstraintFreePackage[];
  refusals?: CalculationRefusal[];
  calculationRunId?: string;
  codeVersion?: string;
  recorded?: boolean;
  recordNote?: string;
  basis?: string;
}

/**
 * D7.08 (spec I.28) AND D7.20 (spec III.§49) — ONE calculation.
 *
 * The specification names the same quantity twice and the register's own
 * D7.20 gap statement says so: "Duplicate spec reference of the I.28 forward
 * metric — one calc, two rows." Both faces come back in one payload, and
 * neither recomputes readiness: the verdict is
 * `sync_work_package_release_verdict`'s and the projection is
 * `get_package_constraint_burndown`'s.
 */
export async function getConstraintFreeWorkIndex(
  caseId: string,
  horizonDays = 90,
): Promise<ConstraintFreeWorkIndex> {
  const { data, error } = await supabase.rpc("get_constraint_free_work_index", {
    p_case_id: caseId,
    p_horizon_days: horizonDays,
  });
  return unwrap(data, error);
}

export async function computeConstraintFreeWorkIndex(
  caseId: string,
  horizonDays = 90,
): Promise<ConstraintFreeWorkIndex> {
  const { data, error } = await supabase.rpc(
    "compute_constraint_free_work_index",
    { p_case_id: caseId, p_horizon_days: horizonDays },
  );
  return unwrap(data, error);
}

/* ── D7.13 + D7.14 — the workface metrics ──────────────────────────────── */

export interface WorkfaceWorkOrder {
  workOrderId: string;
  woNumber: string | null;
  title: string;
  packageId: number;
  packageCode: string;
  packageCount: number;
  requiredBy: string;
  executionStatus: string | null;
  /**
   * `package_unassessed` is the state the first draft did not have: the ONE
   * release verdict reports NO constraint recorded for the job's package, so
   * nothing is known about the ten §28 package constraints and the job is
   * excluded from both percentages rather than counted ready on its elements
   * alone.
   */
  fieldReady: "ready" | "blocked" | "not_assessable" | "package_unassessed";
  /** The ONE verdict for the job's earliest-dated package, read verbatim. */
  packageVerdict: string;
  /** That verdict's own sentence. This screen writes none of its own. */
  packageReadiness: string | null;
  blockedElements: number | null;
  unverifiableElements: number | null;
  executed: boolean;
  detail: string;
}

export interface WorkfaceExecutionMetrics {
  answered: boolean;
  refusal?: string;
  caseId?: string;
  caseTitle?: string;
  windowStart?: string;
  windowEnd?: string;
  plannedWorkOrders?: number;
  assessableWorkOrders?: number;
  notAssessableWorkOrders?: number;
  /** Jobs whose work package has no constraint recorded against it at all. */
  packageUnassessedWorkOrders?: number;
  /** Jobs field-ready on every element and still held back by their package. */
  packageBlockedWorkOrders?: number;
  readyWorkOrders?: number;
  blockedWorkOrders?: number;
  executedReadyWorkOrders?: number;
  readyNotStarted?: number;
  unverifiableElementPositions?: number;
  /** D7.13. */
  plannedWorkReady?: MetricRatio;
  /** D7.14. Its denominator is the previous numerator. */
  readyWorkExecuted?: MetricRatio;
  /**
   * How much of the planned set the two percentages are actually about. The
   * index has carried this since it was written; these two shipped without it,
   * so "100% — 1 of 1" could sit over ten planned jobs with nine unassessable.
   */
  assessmentCoverage?: MetricRatio;
  workOrders?: WorkfaceWorkOrder[];
  refusals?: CalculationRefusal[];
  calculationRunId?: string;
  codeVersion?: string;
  recorded?: boolean;
  recordNote?: string;
  basis?: string;
}

/**
 * D7.13 + D7.14 (spec II.5). Measured on the WORK ORDER, which is the crew's
 * unit — the Constraint-Free Work Index is the package-level position, and
 * the two never divide the same set.
 */
export async function getWorkfaceExecutionMetrics(
  caseId: string,
  windowStart?: string | null,
  windowEnd?: string | null,
): Promise<WorkfaceExecutionMetrics> {
  const { data, error } = await supabase.rpc("get_workface_execution_metrics", {
    p_case_id: caseId,
    p_window_start: windowStart ?? null,
    p_window_end: windowEnd ?? null,
  });
  return unwrap(data, error);
}

export async function computeWorkfaceExecutionMetrics(
  caseId: string,
  windowStart?: string | null,
  windowEnd?: string | null,
): Promise<WorkfaceExecutionMetrics> {
  const { data, error } = await supabase.rpc(
    "compute_workface_execution_metrics",
    {
      p_case_id: caseId,
      p_window_start: windowStart ?? null,
      p_window_end: windowEnd ?? null,
    },
  );
  return unwrap(data, error);
}

/* ── The acts the refusals promise ─────────────────────────────────────── */

/**
 * D7.01: close a standing capacity figure so the next one supersedes it
 * instead of being summed beside it. This is the act
 * `record_resource_capacity`'s collision refusal instructs, and which had no
 * path in the product until now.
 */
export async function closeResourceCapacity(payload: {
  capacityId: string;
  effectiveTo: string;
}): Promise<{ answered: boolean; refusal?: string; note?: string }> {
  const { data, error } = await supabase.rpc("close_resource_capacity", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

/**
 * D7.03/D7.04: supersede an existing competency holding in place. One member
 * holds one competency once, so a renewal moves the dates rather than adding a
 * second row — the act `record_member_competency`'s unique-violation refusal
 * instructs. Declaring competency, so §70-walled at the database.
 */
export async function renewMemberCompetency(payload: {
  memberCompetencyId: number;
  evidenceReference: string;
  grantedOn?: string;
  expiresOn?: string;
}): Promise<{ answered: boolean; refusal?: string; note?: string }> {
  const { data, error } = await supabase.rpc("renew_member_competency", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

/**
 * D7.03: take a leaver off the roster, or put a returner back on.
 * `workforce_members.active` gates every readiness count and could previously
 * only be set at INSERT, so a departed person stayed qualified forever.
 */
export async function setWorkforceMemberActive(payload: {
  memberId: number;
  active: boolean;
  reason: string;
}): Promise<{ answered: boolean; refusal?: string; note?: string }> {
  const { data, error } = await supabase.rpc("set_workforce_member_active", {
    p_payload: payload,
  });
  return unwrap(data, error);
}

/* ── D7.16 — the composed Sync Field module ────────────────────────────── */

export interface SyncFieldModule {
  answered: boolean;
  refusal?: string;
  caseId?: string;
  caseTitle?: string;
  asOf?: string;
  /** The window every figure on this payload is about. */
  horizonDays?: number;
  horizonWeeks?: number;
  /** The workface look-ahead, derived from the horizon rather than pinned at 14 days. */
  workfaceWindowEnd?: string;
  packages?: CaseWorkPackages;
  constraintFreeWork?: ConstraintFreeWorkIndex;
  workface?: WorkfaceExecutionMetrics;
  resourceBalance?: CaseResourceBalance;
  portfolioConflicts?: PortfolioResourceConflicts;
  executionReadiness?: ExecutionReadinessBoard;
  composition?: { part: string; row: string; source: string }[];
  /** The parts still open. A composition is not more complete than its pieces. */
  openParts?: { row: string; gap: string }[];
  basis?: string;
}

/**
 * D7.16: Sync Field, composed. Every figure is the owning function's own
 * answer returned verbatim — this makes one round trip instead of six and
 * recomputes nothing.
 */
export async function getSyncFieldModule(
  caseId: string,
  horizonDays = 90,
): Promise<SyncFieldModule> {
  const { data, error } = await supabase.rpc("get_sync_field_module", {
    p_case_id: caseId,
    p_horizon_days: horizonDays,
  });
  return unwrap(data, error);
}

// ---------------------------------------------------------------------------
// D9.02 / D9.03 / D9.04 / D9.11 / D9.13 — Realize / Learn.
// Warranty is ram_targets. Checkpoints are value_metrics. Lessons are
// learning_events. Every write is a definer RPC; verification stays
// verify_value_metric (imported by the panel from operatingLoopService).
// ---------------------------------------------------------------------------

export interface WarrantyMetricPayload {
  key: string;
  target: number | null;
  unit: string | null;
}

export interface OperationalWarrantyRow {
  id: number;
  systemLabel: string;
  survivesHandover: boolean;
  startupAt: string | null;
  basis: string | null;
  assetId: string | null;
  metrics: WarrantyMetricPayload[];
}

export interface CaseOperationalWarranty {
  caseId: string;
  available: boolean;
  reason?: string;
  capitalProjectId?: number;
  warranties: OperationalWarrantyRow[];
}

export interface RealizationCheckpointRow {
  id: string;
  label: string;
  horizonDays: number;
  dueOn: string | null;
  warrantedMetric: string | null;
  kind: "warranty" | "benefit";
  designValue: number | null;
  observedValue: number | null;
  observedAt: string | null;
  observationMethod: string | null;
  status: string;
  unit: string | null;
  verifiedAt: string | null;
}

export interface CaseRealizationCheckpoints {
  caseId: string;
  checkpoints: RealizationCheckpointRow[];
}

export interface ProjectLessonRow {
  id: string;
  title: string;
  failureModeKey: string;
  cause: string;
  correctiveAction: string;
  applicability: string;
  detail: string | null;
  createdAt: string;
  capitalProjectId: number | null;
}

export interface CaseProjectLessons {
  caseId: string;
  lessons: ProjectLessonRow[];
}

export async function getCaseOperationalWarranty(
  caseId: string,
): Promise<CaseOperationalWarranty> {
  const { data, error } = await supabase.rpc("get_case_operational_warranty", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the operational warranty");
}

export async function getCaseRealizationCheckpoints(
  caseId: string,
): Promise<CaseRealizationCheckpoints> {
  const { data, error } = await supabase.rpc(
    "get_case_realization_checkpoints",
    { p_case_id: caseId },
  );
  return unwrapRpc(data, error, "Could not load realization checkpoints");
}

export async function getCaseProjectLessons(
  caseId: string,
): Promise<CaseProjectLessons> {
  const { data, error } = await supabase.rpc("get_case_project_lessons", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load project lessons");
}

export async function recordOperationalWarranty(input: {
  caseId: string;
  systemLabel: string;
  targetAvailability: number;
  warrantyBasis: string;
  assetId?: string | null;
  metrics?: Record<string, { target: number; unit: string }>;
}): Promise<{ ram_target_id: number }> {
  const { data, error } = await supabase.rpc("record_operational_warranty", {
    p_case_id: input.caseId,
    p_system_label: input.systemLabel,
    p_target_availability: input.targetAvailability,
    p_warranty_basis: input.warrantyBasis,
    p_asset_id: input.assetId ?? null,
    p_metrics: input.metrics ?? {},
  });
  return unwrapRpc(data, error, "Could not record the operational warranty");
}

export async function openRealizationWindow(input: {
  caseId: string;
  startupOn: string;
}): Promise<{ case_id: string; startup_at: string }> {
  const { data, error } = await supabase.rpc("open_realization_window", {
    p_case_id: input.caseId,
    p_startup: input.startupOn,
  });
  return unwrapRpc(data, error, "Could not open the realization window");
}

export async function recordCheckpointObservation(input: {
  metricId: string;
  observedValue: number;
  method: string;
  evidence: string;
}): Promise<{ metric_id: string; status: string }> {
  const { data, error } = await supabase.rpc("record_checkpoint_observation", {
    p_metric_id: input.metricId,
    p_observed_value: input.observedValue,
    p_method: input.method,
    p_evidence: input.evidence,
  });
  return unwrapRpc(data, error, "Could not record the observation");
}

export async function recordProjectLesson(input: {
  caseId: string;
  failureModeKey: string;
  title: string;
  cause: string;
  correctiveAction: string;
  applicability: string;
  detail?: string | null;
}): Promise<{ lesson_id: string }> {
  const { data, error } = await supabase.rpc("record_project_lesson", {
    p_case_id: input.caseId,
    p_failure_mode_key: input.failureModeKey,
    p_title: input.title,
    p_cause: input.cause,
    p_corrective_action: input.correctiveAction,
    p_applicability: input.applicability,
    p_detail: input.detail ?? null,
  });
  return unwrapRpc(data, error, "Could not record the project lesson");
}

// ---------------------------------------------------------------------------
// D9.12 / D9.14 / D9.16 / D9.01 — screening, VR ratio, success score,
// per-phase success. Reads plus the existing approveCaseBaseline write
// (the BENEFITS snapshot rides that human act). No new authorization door.
// ---------------------------------------------------------------------------

export interface ApplicableProjectLesson {
  id: string;
  title: string;
  failureModeKey: string;
  cause: string;
  correctiveAction: string;
  applicability: string;
  sourceCaseId: string;
  sourceLifecycleType: string | null;
  matchReason: string;
  createdAt: string;
}

export interface ApplicableProjectLessons {
  caseId: string;
  lifecycleType: string;
  count: number;
  lessons: ApplicableProjectLesson[];
  emptyReason?: string | null;
  basis?: string;
}

export interface CaseValueRealization {
  caseId: string;
  evaluable: boolean;
  refusal?: string;
  reason?: string;
  ratio?: number;
  unit?: string;
  approvedExpectedBenefit?: number;
  realizedBenefit?: number;
  unverifiedBenefitCount?: number;
  baselineId?: string;
  baselineVersion?: number;
  formula?: string;
  note?: string;
}

export interface ValueTrajectoryRow {
  point: string;
  value: number | null;
  unit: string | null;
  status: "verified" | "derived" | "missing" | "unit_mismatch";
}

export interface ValueLeakageAttributionRow {
  id: string;
  bucket: string;
  kind: "causal" | "contributing";
  value: number;
  basis: string;
  evidenceItemId: string;
}

export interface CaseValueLeakage {
  caseId: string;
  leakageEvaluable: boolean;
  reason?: string;
  unit?: string;
  approvedValue?: number;
  realizedValue?: number;
  approvedToRealizedLeakage?: number;
  originalToRealizedChange?: number | null;
  trajectory?: ValueTrajectoryRow[];
  trajectoryComplete?: boolean;
  missingPoints?: string[];
  attributions?: ValueLeakageAttributionRow[];
  attributedValue?: number;
  unattributedResidual?: number;
  attributionValid?: boolean;
  missingActualBenefits?: number;
  pendingVerificationCount?: number;
  pendingVerification?: Array<{
    id: string;
    metricType: string;
    label: string;
    value: number;
    unit: string;
    basis: string;
    point: string | null;
    bucket: string | null;
    kind: string | null;
    evidenceItemId: string;
    recordedBy: string;
    createdAt: string;
  }>;
  formula?: string;
  decisionBoundary?: string;
}

export interface BenefitScreenRow {
  id: string;
  label: string;
  expected: number;
  unit: string;
  expectedDate: string;
  ownerId: string;
  owner: string;
  basis: string;
  currentForecast: number | null;
  forecastStatus: string;
  actual: number | null;
  actualHorizonDays: number | null;
  variance: number | null;
}

export interface CaseBenefitsScreen {
  caseId: string;
  benefits: BenefitScreenRow[];
  valueLeakage: CaseValueLeakage;
  basis: string;
}

export interface ProjectSuccessSlot {
  key: string;
  label: string;
  verdict: "met" | "not_met" | "incomplete" | "missing";
  source: string;
  value: string | null;
  missingReason: string | null;
}

export interface CaseProjectSuccess {
  caseId: string;
  dimensions: ProjectSuccessSlot[];
  missingCount: number;
  notMetCount: number;
  headline: string;
  basis?: string;
}

export interface LifecycleSuccessPhase {
  stageKey: string;
  displayName: string;
  sequence: number;
  isCurrent: boolean;
  gateCount: number;
  reviewedCount: number;
  gateVerdict: string;
  costVerdict: string;
  ramVerdict: string;
  costScope: string;
  ramScope: string;
  verdict: "success" | "not_success" | "incomplete";
  onBudgetUnreliable: boolean;
}

export interface CaseLifecycleSuccess {
  caseId: string;
  available: boolean;
  reason?: string;
  frameworkId?: string;
  phases?: LifecycleSuccessPhase[];
  rule?: string;
}

export async function screenApplicableProjectLessons(
  caseId: string,
): Promise<ApplicableProjectLessons> {
  const { data, error } = await supabase.rpc(
    "screen_applicable_project_lessons",
    { p_case_id: caseId },
  );
  return unwrapRpc(data, error, "Could not screen applicable project lessons");
}

export async function getCaseValueRealization(
  caseId: string,
): Promise<CaseValueRealization> {
  const { data, error } = await supabase.rpc("get_case_value_realization", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load value realization");
}

export async function getCaseValueLeakage(
  caseId: string,
): Promise<CaseValueLeakage> {
  const { data, error } = await supabase.rpc("get_case_value_leakage", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load value leakage");
}

export async function getCaseBenefitsScreen(
  caseId: string,
): Promise<CaseBenefitsScreen> {
  const { data, error } = await supabase.rpc("get_case_benefits_screen", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the benefits screen");
}

export async function recordCaseValueTrajectoryPoint(input: {
  caseId: string;
  point: string;
  value: number;
  unit: string;
  basis: string;
  evidenceItemId: string;
}): Promise<{ metricId: string; point: string; status: string }> {
  const { data, error } = await supabase.rpc(
    "record_case_value_trajectory_point",
    {
      p_case_id: input.caseId,
      p_point: input.point,
      p_value: input.value,
      p_unit: input.unit,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrapRpc(data, error, "Could not record the trajectory point");
}

export async function recordCaseValueLeakageAttribution(input: {
  caseId: string;
  bucket: string;
  value: number;
  attributionKind: "causal" | "contributing";
  basis: string;
  evidenceItemId: string;
}): Promise<{ metricId: string; bucket: string; status: string }> {
  const { data, error } = await supabase.rpc(
    "record_case_value_leakage_attribution",
    {
      p_case_id: input.caseId,
      p_bucket: input.bucket,
      p_value: input.value,
      p_attribution_kind: input.attributionKind,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrapRpc(data, error, "Could not record leakage attribution");
}

export async function getCaseProjectSuccess(
  caseId: string,
): Promise<CaseProjectSuccess> {
  const { data, error } = await supabase.rpc("get_case_project_success", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load the project success score");
}

export async function getCaseLifecycleSuccess(
  caseId: string,
): Promise<CaseLifecycleSuccess> {
  const { data, error } = await supabase.rpc("get_case_lifecycle_success", {
    p_case_id: caseId,
  });
  return unwrapRpc(data, error, "Could not load lifecycle success");
}

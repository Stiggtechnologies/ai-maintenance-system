import { supabase } from "../lib/supabase";
import { evaluateValueOfInformation } from "../lib/risk-operating-system";
import type {
  EnterpriseRiskArchitecture,
  RiskAnalysisPreview,
  RiskAssessmentDraft,
  RiskCockpit,
  RiskDecisionOperations,
  RiskDecisionPreviewContext,
  RiskImplementationState,
  RiskParticipant,
} from "../types/risk";

type RpcResult = Record<string, unknown> & { error?: string };

export interface RiskUncertaintyEvidence {
  id: string;
  description: string;
  sourceSystem: string;
  sourceReference: string | null;
  verificationStatus: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  evidenceClass: string | null;
  qualityGrade: string | null;
  applicabilityGrade: string | null;
}

export interface RiskUncertaintySensitivityInput {
  name: string;
  basis: string;
  low_input: number;
  base_input: number;
  high_input: number;
  low_output: number;
  base_output: number;
  high_output: number;
}

export interface RiskUncertaintySensitivityResult {
  name: string;
  basis: string;
  lowInput: number;
  baseInput: number;
  highInput: number;
  lowOutput: number;
  baseOutput: number;
  highOutput: number;
  swing: number;
}

export interface RiskUncertaintyAnalysis {
  id: string;
  version: number;
  validationStatus: "pending_review" | "validated" | "rejected" | "stale";
  method: string;
  basis: string;
  probability: { lower: number; central: number; upper: number };
  confidence: { level: number; lower: number; upper: number };
  lossCases: {
    best: number;
    expected: number;
    worst: number;
    currency: string;
  };
  sensitivityInputs: RiskUncertaintySensitivityInput[];
  sensitivityResults: RiskUncertaintySensitivityResult[];
  thresholdProfileId: string;
  decisionThresholds: Record<string, unknown>;
  reassessmentTriggers: string[];
  reviewDueAt: string;
  valueOfInformation: {
    action: string;
    informationCost: number;
    decisionCostIfWrong: number;
    uncertaintyReduction: number;
    probabilityDecisionChanges: number;
    expectedValue: number;
    netValue: number;
    recommendation: "GATHER_INFORMATION" | "DECIDE_WITH_CURRENT_INFORMATION";
  };
  analysisDigest: string;
  currentDigest: string;
  authorId: string;
  createdAt: string;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  approvalId: string | null;
  derivedEvidenceItemId: string | null;
  evidenceItemIds: string[];
  operationalAuthorization: false;
}

export interface RiskUncertaintyWorkspace {
  risk: { id: string; title: string; status: string; currency: string };
  criteria: {
    id: string;
    name: string;
    version: number;
    status: string;
    decisionThresholds: Record<string, unknown>;
  } | null;
  evidence: RiskUncertaintyEvidence[];
  analyses: RiskUncertaintyAnalysis[];
  boundary: string;
  operationalAuthorization: false;
}

export interface RiskUncertaintySubmission {
  method: string;
  basis: string;
  probability_lower: number;
  probability_central: number;
  probability_upper: number;
  confidence_level: number;
  confidence_interval_lower: number;
  confidence_interval_upper: number;
  best_case_loss: number;
  expected_case_loss: number;
  worst_case_loss: number;
  currency: string;
  sensitivity: RiskUncertaintySensitivityInput[];
  reassessment_triggers: string[];
  review_due_at: string;
  voi_action: string;
  voi_information_cost: number;
  voi_decision_cost_if_wrong: number;
  voi_uncertainty_reduction: number;
  voi_probability_decision_changes: number;
}

export interface RiskUncertaintyReviewContext {
  riskId: string;
  analysisDigest: string;
}

/** Dispatch may have committed. Never translate this into permission to resend. */
export class RiskUncertaintyOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true;

  constructor() {
    super(
      "Uncertainty action outcome is unknown. Reconcile the canonical packet before resubmitting.",
    );
    this.name = "RiskUncertaintyOutcomeUnknownError";
  }
}

function uncertaintyUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function uncertaintyDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function uncertaintyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function uncertaintyMutation(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response;
  try {
    response = await supabase.rpc(name, args);
  } catch {
    throw new RiskUncertaintyOutcomeUnknownError();
  }
  const { data, error } = response;
  if (error || !uncertaintyRecord(data)) {
    throw new RiskUncertaintyOutcomeUnknownError();
  }
  if (Object.hasOwn(data, "error")) {
    if (
      Object.keys(data).length === 1 &&
      typeof data.error === "string" &&
      data.error.trim()
    ) {
      fail(`Uncertainty action refused: ${data.error}`);
    }
    throw new RiskUncertaintyOutcomeUnknownError();
  }
  return data;
}

function fail(message: string, error?: { message: string } | null): never {
  throw new Error(error ? `${message}: ${error.message}` : message);
}

function unwrap<T extends RpcResult>(
  data: T | null,
  error: { message: string } | null,
  message: string,
): T {
  if (error) fail(message, error);
  if (!data) fail(`${message}: no response`);
  if (typeof data.error === "string" && data.error)
    fail(`${message}: ${data.error}`);
  return data;
}

export async function getRiskOperatingCockpit(): Promise<RiskCockpit> {
  const { data, error } = await supabase.rpc(
    "get_sensitive_risk_operating_cockpit",
  );
  if (error) fail("Could not load the risk operating cockpit", error);
  return data as RiskCockpit;
}

export async function getRiskUncertaintyWorkspace(
  riskId: string,
): Promise<RiskUncertaintyWorkspace> {
  const { data, error } = await supabase.rpc("get_risk_uncertainty_workspace", {
    p_risk_id: riskId,
  });
  return unwrap(
    data as (RiskUncertaintyWorkspace & RpcResult) | null,
    error,
    "Could not load the governed uncertainty workspace",
  );
}

export async function submitRiskUncertaintyAnalysis(
  riskId: string,
  analysis: RiskUncertaintySubmission,
  evidenceItemIds: string[],
): Promise<RpcResult> {
  if (!uncertaintyUuid(riskId)) fail("A canonical risk identifier is required");
  if (!uncertaintyRecord(analysis))
    fail(
      "Finite bounded value-of-information inputs are required before submission",
    );
  const proposal = { ...analysis };
  const voiInputs = {
    informationCost: proposal.voi_information_cost,
    decisionCostIfWrong: proposal.voi_decision_cost_if_wrong,
    uncertaintyReduction: proposal.voi_uncertainty_reduction,
    probabilityDecisionChanges: proposal.voi_probability_decision_changes,
  };
  if (
    !Object.values(voiInputs).every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    voiInputs.informationCost < 0 ||
    voiInputs.decisionCostIfWrong < 0 ||
    voiInputs.uncertaintyReduction < 0 ||
    voiInputs.uncertaintyReduction > 1 ||
    voiInputs.probabilityDecisionChanges < 0 ||
    voiInputs.probabilityDecisionChanges > 1
  )
    fail(
      "Finite bounded value-of-information inputs are required before submission",
    );
  // The canonical calculator classifies the exact unrounded decimal fraction,
  // independently of its rounded displays. Capture this basis before dispatch.
  const expected = evaluateValueOfInformation(voiInputs);
  if (
    !Number.isFinite(expected.expectedValue) ||
    !Number.isFinite(expected.netValue)
  )
    fail(
      "Value-of-information calculation must have finite representable displays before submission",
    );
  const data = await uncertaintyMutation("submit_risk_uncertainty_analysis", {
    p_risk_id: riskId,
    p_analysis: proposal,
    p_evidence_item_ids: evidenceItemIds,
  });
  const voi = data.valueOfInformation;
  if (
    data.riskId !== riskId ||
    !uncertaintyUuid(data.analysisId) ||
    !uncertaintyDigest(data.analysisDigest) ||
    !Number.isSafeInteger(data.version) ||
    (data.version as number) <= 0 ||
    data.validationStatus !== "pending_review" ||
    data.operationalAuthorization !== false ||
    !uncertaintyRecord(voi) ||
    voi.informationCost !== voiInputs.informationCost ||
    voi.decisionCostIfWrong !== voiInputs.decisionCostIfWrong ||
    voi.uncertaintyReduction !== voiInputs.uncertaintyReduction ||
    voi.probabilityDecisionChanges !== voiInputs.probabilityDecisionChanges ||
    typeof voi.expectedValue !== "number" ||
    !Number.isFinite(voi.expectedValue) ||
    voi.expectedValue < 0 ||
    typeof voi.netValue !== "number" ||
    !Number.isFinite(voi.netValue) ||
    voi.netValue > voi.expectedValue ||
    voi.expectedValue !== expected.expectedValue ||
    voi.netValue !== expected.netValue ||
    voi.recommendation !== expected.recommendation
  ) {
    throw new RiskUncertaintyOutcomeUnknownError();
  }
  return data;
}

export async function reviewRiskUncertaintyAnalysis(
  analysisId: string,
  decision: "validated" | "rejected",
  note: string,
  context: RiskUncertaintyReviewContext,
): Promise<RpcResult> {
  if (
    !uncertaintyUuid(analysisId) ||
    !uncertaintyUuid(context?.riskId) ||
    !uncertaintyDigest(context?.analysisDigest) ||
    !["validated", "rejected"].includes(decision)
  ) {
    fail(
      "The selected canonical risk and frozen packet digest are required for review",
    );
  }
  const data = await uncertaintyMutation("review_risk_uncertainty_analysis", {
    p_analysis_id: analysisId,
    p_decision: decision,
    p_review_note: note,
  });
  if (
    data.riskId !== context.riskId ||
    data.analysisId !== analysisId ||
    data.analysisDigest !== context.analysisDigest ||
    data.decision !== decision ||
    !uncertaintyUuid(data.approvalId) ||
    data.operationalAuthorization !== false ||
    (decision === "validated"
      ? !uncertaintyUuid(data.derivedEvidenceItemId)
      : data.derivedEvidenceItemId !== null)
  ) {
    throw new RiskUncertaintyOutcomeUnknownError();
  }
  return data;
}

export async function getIso31000ImplementationState(): Promise<RiskImplementationState | null> {
  const { data, error } = await supabase.rpc(
    "get_iso31000_implementation_state",
  );
  if (error) fail("Could not load ISO 31000 implementation state", error);
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    fail(`Could not load ISO 31000 implementation state: ${data.error}`);
  }
  return (data as RiskImplementationState | null) ?? null;
}

export async function getRiskParticipants(): Promise<RiskParticipant[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, role")
    .order("full_name")
    .returns<RiskParticipant[]>();
  if (error) fail("Could not load risk participants", error);
  return data ?? [];
}

export interface AdoptedObjectiveOption {
  id: string;
  description: string;
  objective_level: string;
}

/**
 * Adopted objectives, for the risk-creation objective link (spec §2 /
 * D11.16: a risk always links to an objective). RLS scopes the read.
 */
export async function listAdoptedObjectives(): Promise<
  AdoptedObjectiveOption[]
> {
  const { data, error } = await supabase
    .from("risk_objectives")
    .select("id, description, objective_level")
    .eq("status", "adopted")
    .order("objective_level")
    .order("description")
    .returns<AdoptedObjectiveOption[]>();
  if (error) fail("Could not load adopted objectives", error);
  return data ?? [];
}

export async function createRiskAssessment(
  assessment: RiskAssessmentDraft,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("create_risk_assessment", {
    p_assessment: assessment,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not create risk assessment",
  );
}

export async function recordRiskAnalysis(
  riskId: string,
  analysis: Record<string, unknown>,
): Promise<RpcResult> {
  const proposal = qualifiedAnalysisProposal(riskId, analysis);
  let response;
  try {
    response = await supabase.rpc("record_risk_analysis", {
      p_risk_id: riskId,
      p_analysis: proposal,
    });
  } catch {
    throw new RiskAnalysisOutcomeUnknownError();
  }
  const { data, error, status } = response;
  if (error || !Number.isInteger(status) || status < 200 || status >= 300)
    throw new RiskAnalysisOutcomeUnknownError();
  if (
    isRecord(data) &&
    typeof data.error === "string" &&
    data.error.trim() &&
    Object.keys(data).every((key) => key === "error" || key === "gaps") &&
    (!("gaps" in data) ||
      (Array.isArray(data.gaps) &&
        data.gaps.every((gap) => typeof gap === "string")))
  )
    fail(`Analysis recording refused: ${data.error}`);
  if (
    !isRecord(data) ||
    "error" in data ||
    data.risk_id !== riskId ||
    data.status !== "analyzed" ||
    !qualifiedAnalysisScores(data, [
      "inherent_score",
      "current_score",
      "opportunity_score",
    ]) ||
    typeof data.authoritative !== "boolean"
  )
    throw new RiskAnalysisOutcomeUnknownError();
  return data;
}

/** Read-only, exact-input, risk-bound advisory projection. No client risk arithmetic. */
export async function getRiskAnalysisPreview(
  riskId: string,
  analysis: Record<string, unknown>,
): Promise<RiskAnalysisPreview> {
  const proposal = qualifiedAnalysisProposal(riskId, analysis);
  const { data, error } = await supabase.rpc("get_risk_analysis_preview", {
    p_risk_id: riskId,
    p_analysis: proposal,
  });
  if (error) fail("Could not load canonical risk analysis preview", error);
  if (isRecord(data) && typeof data.error === "string" && data.error.trim())
    fail(`Could not load canonical risk analysis preview: ${data.error}`);
  if (
    !isRecord(data) ||
    "error" in data ||
    data.risk_id !== riskId ||
    !isUuid(data.criteria_id) ||
    typeof data.criteria_version !== "number" ||
    !Number.isSafeInteger(data.criteria_version) ||
    data.criteria_version <= 0 ||
    typeof data.criteria_status !== "string" ||
    !["draft", "adopted", "superseded"].includes(data.criteria_status) ||
    !sameJson(data.analysis, proposal) ||
    !isInstant(data.generated_at) ||
    data.advisory_only !== true ||
    data.human_decision_required !== true ||
    !qualifiedAnalysisScores(data, [
      "inherent_score",
      "controlled_score",
      "current_score",
      "opportunity_score",
      "time_pressure",
    ]) ||
    data.authoritative !== (data.criteria_status === "adopted")
  )
    fail(
      "Could not load canonical risk analysis preview: malformed or unbound advisory result",
    );
  return data as unknown as RiskAnalysisPreview;
}

export class RiskAnalysisOutcomeUnknownError extends Error {
  constructor() {
    super(
      "Analysis recording outcome is unknown. Reconcile the risk analysis and audit evidence before starting another recording; do not retry this write blindly.",
    );
    this.name = "RiskAnalysisOutcomeUnknownError";
  }
}

function qualifiedAnalysisProposal(
  riskId: string,
  analysis: Record<string, unknown>,
): Record<string, unknown> {
  const numeric = [
    "likelihood",
    "control_effectiveness",
    "uncertainty",
    "confidence",
    "complexity",
    "connectivity",
    "exposure",
    "capacity_load",
    "velocity",
    "opportunity_value",
  ];
  if (
    !isUuid(riskId) ||
    !numeric.every(
      (key) =>
        typeof analysis[key] === "number" && Number.isFinite(analysis[key]),
    ) ||
    typeof analysis.analysis_level !== "string" ||
    !["qualitative", "semi_quantitative", "quantitative"].includes(
      analysis.analysis_level,
    ) ||
    typeof analysis.analysis_method !== "string" ||
    !analysis.analysis_method.trim() ||
    (analysis.analysis_model_reference !== null &&
      typeof analysis.analysis_model_reference !== "string") ||
    !isRecord(analysis.consequences) ||
    Object.keys(analysis.consequences).length === 0 ||
    !Object.values(analysis.consequences).every(
      (score) => typeof score === "number" && Number.isFinite(score),
    ) ||
    (analysis.time_to_unacceptable_days !== null &&
      (typeof analysis.time_to_unacceptable_days !== "number" ||
        !Number.isFinite(analysis.time_to_unacceptable_days)))
  )
    fail(
      "Valid complete analysis numeric inputs, level and method are required before preview or recording",
    );
  return { ...analysis, consequences: { ...analysis.consequences } };
}

function qualifiedAnalysisScores(
  data: Record<string, unknown>,
  keys: string[],
): boolean {
  return (
    keys.every(
      (key) =>
        typeof data[key] === "number" &&
        Number.isFinite(data[key]) &&
        data[key] >= 0 &&
        data[key] <= 100,
    ) &&
    typeof data.level === "string" &&
    ["Very Low", "Low", "Medium", "High", "Critical"].includes(data.level) &&
    typeof data.recommended_action === "string" &&
    ["ACCEPT", "MONITOR", "INVESTIGATE", "TREAT", "ESCALATE", "STOP"].includes(
      data.recommended_action,
    ) &&
    (data.authoritative !== false || data.recommended_action === "INVESTIGATE")
  );
}

// JSONB may reorder object keys. Compare values, never serialized key ordering.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length &&
      a.every((value, index) => sameJson(value, b[index]))
    );
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

export async function getRiskDecisionPreviewContext(
  riskId: string,
): Promise<RiskDecisionPreviewContext> {
  const { data, error } = await supabase.rpc(
    "get_risk_decision_preview_context",
    { p_risk_id: riskId },
  );
  if (error) fail("Could not load governed risk preview inputs", error);
  if (isRecord(data) && typeof data.error === "string" && data.error.trim())
    fail(`Could not load governed risk preview inputs: ${data.error}`);
  if (!isQualifiedPreviewContext(data, riskId))
    fail(
      "Could not load governed risk preview inputs: malformed or unbound advisory context",
    );
  return data;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}
function isInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return (
    Number.isFinite(calendar.getTime()) &&
    calendar.toISOString().slice(0, 10) === value.slice(0, 10)
  );
}
function isNumeric(value: unknown): boolean {
  return (
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" &&
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) &&
      Number.isFinite(Number(value)))
  );
}
function numericFields(value: unknown, keys: string[]): boolean {
  return (
    isRecord(value) &&
    keys.every((key) => !(key in value) || isNumeric(value[key]))
  );
}
function isQualifiedPreviewContext(
  value: unknown,
  riskId: string,
): value is RiskDecisionPreviewContext {
  if (
    !isRecord(value) ||
    "error" in value ||
    !isUuid(riskId) ||
    value.risk_id !== riskId ||
    value.advisory_only !== true ||
    value.human_decision_required !== true ||
    !isInstant(value.generated_at) ||
    !Array.isArray(value.active_competencies) ||
    !value.active_competencies.every(
      (key) => typeof key === "string" && key.trim().length > 0,
    ) ||
    !isRecord(value.criteria)
  )
    return false;
  const c = value.criteria;
  return (
    isUuid(c.id) &&
    typeof c.name === "string" &&
    c.name.trim().length > 0 &&
    typeof c.status === "string" &&
    ["draft", "adopted", "superseded"].includes(c.status) &&
    typeof c.version === "number" &&
    Number.isSafeInteger(c.version) &&
    c.version > 0 &&
    Array.isArray(c.consequence_dimensions) &&
    c.consequence_dimensions.every(
      (entry) =>
        (typeof entry === "string" && entry.trim().length > 0) ||
        isRecord(entry),
    ) &&
    Array.isArray(c.likelihood_scale) &&
    c.likelihood_scale.every((entry) =>
      typeof entry === "number"
        ? Number.isFinite(entry)
        : isRecord(entry) && isNumeric(entry.score),
    ) &&
    numericFields(c.thresholds, ["low", "medium", "high", "critical"]) &&
    numericFields(c.scoring_weights, [
      "inherent",
      "exposure",
      "uncertainty",
      "connectivity",
      "velocity",
      "capacity",
    ]) &&
    numericFields(c.decision_thresholds, [
      "accept",
      "monitor",
      "investigate",
      "treat",
      "escalate",
    ]) &&
    numericFields(c.risk_capacity, ["capacity_limit"]) &&
    numericFields(c.time_factors, ["weight"])
  );
}

/** An unqualified response is not proof that this append-only evidence write failed. */
export class RiskInformationOutcomeUnknownError extends Error {
  constructor() {
    super(
      "Information recording outcome is unknown. Reconcile the risk's value-of-information evidence before starting another recording; do not retry this write blindly.",
    );
    this.name = "RiskInformationOutcomeUnknownError";
  }
}

export async function recordRiskValueOfInformation(
  riskId: string,
  analysis: Record<string, unknown>,
): Promise<RpcResult> {
  const keys = [
    "information_cost",
    "decision_cost_if_wrong",
    "uncertainty_reduction",
    "probability_decision_changes",
  ] as const;
  if (
    !isUuid(riskId) ||
    !keys.every(
      (key) =>
        typeof analysis[key] === "number" && Number.isFinite(analysis[key]),
    ) ||
    (analysis.information_cost as number) < 0 ||
    (analysis.decision_cost_if_wrong as number) < 0 ||
    (analysis.uncertainty_reduction as number) < 0 ||
    (analysis.uncertainty_reduction as number) > 1 ||
    (analysis.probability_decision_changes as number) < 0 ||
    (analysis.probability_decision_changes as number) > 1 ||
    typeof analysis.information_action !== "string" ||
    analysis.information_action.trim().length < 10 ||
    typeof analysis.currency !== "string" ||
    !analysis.currency.trim()
  )
    fail(
      "Valid information inputs and a described enquiry are required before recording",
    );
  const proposal: Record<string, unknown> & { information_action: string } = {
    ...analysis,
    information_action: analysis.information_action.trim(),
  };
  const expected = evaluateValueOfInformation({
    informationCost: proposal.information_cost as number,
    decisionCostIfWrong: proposal.decision_cost_if_wrong as number,
    uncertaintyReduction: proposal.uncertainty_reduction as number,
    probabilityDecisionChanges: proposal.probability_decision_changes as number,
  });
  if (
    !Number.isFinite(expected.expectedValue) ||
    !Number.isFinite(expected.netValue)
  )
    fail(
      "Information calculation must have finite representable values before recording",
    );
  let response;
  try {
    response = await supabase.rpc("record_risk_value_of_information", {
      p_risk_id: riskId,
      p_analysis: proposal,
    });
  } catch {
    throw new RiskInformationOutcomeUnknownError();
  }
  const { data, error, status } = response;
  if (error || !Number.isInteger(status) || status < 200 || status >= 300)
    throw new RiskInformationOutcomeUnknownError();
  // Only the canonical error-only response proves a noncommitting refusal.
  // Partial evidence identities/results must remain unknown, even with an error.
  if (
    isRecord(data) &&
    Object.keys(data).length === 1 &&
    typeof data.error === "string" &&
    data.error.trim()
  )
    fail(`Information recording refused: ${data.error}`);
  if (
    !isRecord(data) ||
    "error" in data ||
    data.risk_id !== riskId ||
    !isUuid(data.evidence_id) ||
    data.human_decision_required !== true ||
    data.advisory_only !== true ||
    !isInstant(data.recorded_at) ||
    data.information_action !== proposal.information_action ||
    data.currency !== proposal.currency ||
    !keys.every((key) => data[key] === proposal[key]) ||
    typeof data.expected_value !== "number" ||
    !Number.isFinite(data.expected_value) ||
    typeof data.net_value !== "number" ||
    !Number.isFinite(data.net_value) ||
    data.expected_value !== expected.expectedValue ||
    data.net_value !== expected.netValue ||
    data.recommendation !== expected.recommendation
  )
    throw new RiskInformationOutcomeUnknownError();
  return data;
}

export async function configureRiskControl(
  riskId: string,
  control: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("configure_risk_control", {
    p_risk_id: riskId,
    p_control: control,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not configure risk control",
  );
}

export async function configureRiskIndicator(
  riskId: string,
  indicator: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("configure_risk_indicator", {
    p_risk_id: riskId,
    p_indicator: indicator,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not configure risk indicator",
  );
}

export async function linkRisks(input: {
  sourceRiskId: string;
  targetRiskId: string;
  relationship: string;
  dependencyKey?: string;
  strength?: number;
  rationale: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("link_risks", {
    p_source_risk_id: input.sourceRiskId,
    p_target_risk_id: input.targetRiskId,
    p_relationship: input.relationship,
    p_dependency_key: input.dependencyKey ?? null,
    p_strength: input.strength ?? null,
    p_rationale: input.rationale,
  });
  return unwrap(data as RpcResult | null, error, "Could not link risks");
}

export async function ingestRiskEvidence(
  riskId: string,
  evidence: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("ingest_risk_evidence", {
    p_risk_id: riskId,
    p_evidence: evidence,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record risk evidence",
  );
}

export async function recordStakeholderView(
  riskId: string,
  view: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_stakeholder_view", {
    p_risk_id: riskId,
    p_view: view,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record stakeholder view",
  );
}

export async function recordRiskIndicatorObservation(input: {
  indicatorId: string;
  value: number;
  observedAt: string;
  dataQuality?: string;
  sourceReference?: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_risk_indicator_observation",
    {
      p_indicator_id: input.indicatorId,
      p_value: input.value,
      p_observed_at: input.observedAt,
      p_data_quality: input.dataQuality ?? "good",
      p_source_reference: input.sourceReference ?? null,
    },
  );
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record indicator observation",
  );
}

export async function recordRiskControlTest(
  controlId: string,
  test: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_risk_control_test", {
    p_control_id: controlId,
    p_test: test,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record control test",
  );
}

/**
 * D5.24 (spec §14): the assessment history of a control with DESIGN and
 * OPERATING effectiveness carried separately — "the control exists" and "the
 * control works" as two columns, plus the last real judgement when the latest
 * assessment declined to make one.
 */
export async function getControlAssessmentHistory(
  controlId: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("get_control_assessment_history", {
    p_control_id: controlId,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not load the control assessment history",
  );
}

/**
 * D5.25 (spec §15 new_risk_created): the risks this risk's treatments
 * created, and the risk whose treatment created this one.
 */
export async function getRiskSecondaryRisks(
  riskId: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("get_risk_secondary_risks", {
    p_risk_id: riskId,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not load the secondary risks",
  );
}

export async function createRiskTreatment(
  riskId: string,
  option: Record<string, unknown>,
  select = false,
): Promise<RpcResult> {
  const requestedChildren =
    option.new_risk_created === undefined ? [] : option.new_risk_created;
  if (
    !isUuid(riskId) ||
    typeof select !== "boolean" ||
    !Array.isArray(requestedChildren) ||
    !requestedChildren.every(isRecord)
  )
    fail(
      "A canonical risk identity, boolean selection and secondary-risk object array are required before recording treatment",
    );
  const children = requestedChildren.map((child) => ({ ...child }));
  const proposal = {
    ...option,
    ...(option.new_risk_created === undefined
      ? {}
      : { new_risk_created: children }),
  };
  let response;
  try {
    response = await supabase.rpc("create_risk_treatment", {
      p_risk_id: riskId,
      p_option: proposal,
      p_select: select,
    });
  } catch {
    throw new RiskTreatmentOutcomeUnknownError();
  }
  const { data, error, status } = response;
  if (error || !Number.isInteger(status) || status < 200 || status >= 300)
    throw new RiskTreatmentOutcomeUnknownError();
  if (isRecord(data) && typeof data.error === "string" && data.error.trim()) {
    const keys = Object.keys(data);
    const prewriteError = keys.length === 1 && keys[0] === "error";
    const prewriteReadiness =
      select === true &&
      keys.length === 3 &&
      keys.every((key) =>
        ["error", "selected", "readiness_gaps"].includes(key),
      ) &&
      data.selected === false &&
      Array.isArray(data.readiness_gaps) &&
      data.readiness_gaps.length > 0 &&
      data.readiness_gaps.every((gap) => typeof gap === "string" && gap.trim());
    if (prewriteError || prewriteReadiness)
      fail(`Treatment recording refused: ${data.error}`);
    // Some canonical refusals follow scenario/child inserts. Never retry those.
    throw new RiskTreatmentOutcomeUnknownError();
  }
  if (
    !isRecord(data) ||
    "error" in data ||
    data.risk_id !== riskId ||
    !isUuid(data.scenario_id) ||
    data.selected !== select ||
    typeof data.executable !== "boolean" ||
    !Array.isArray(data.readiness_gaps) ||
    !data.readiness_gaps.every(
      (gap) => typeof gap === "string" && gap.trim().length > 0,
    ) ||
    data.executable !== (data.readiness_gaps.length === 0) ||
    data.human_approval_required !== select ||
    data.advisory_only !== true ||
    data.human_decision_required !== true ||
    typeof data.net_risk_change !== "number" ||
    !Number.isFinite(data.net_risk_change) ||
    (select
      ? data.executable !== true ||
        !isUuid(data.recommendation_id) ||
        !isUuid(data.approval_id)
      : data.recommendation_id !== null || data.approval_id !== null) ||
    !qualifiedTreatmentChildren(data.secondary_risks, children, riskId)
  )
    throw new RiskTreatmentOutcomeUnknownError();
  return data;
}

/** Unknown is not rollback: scenarios and secondary risks may already exist. */
export class RiskTreatmentOutcomeUnknownError extends Error {
  constructor() {
    super(
      "Treatment recording outcome is unknown. Reconcile the scenario, recommendation, approval and secondary-risk evidence before another recording; do not retry this write blindly.",
    );
    this.name = "RiskTreatmentOutcomeUnknownError";
  }
}

function qualifiedTreatmentChildren(
  value: unknown,
  requested: Record<string, unknown>[],
  parentRiskId: string,
): boolean {
  if (!Array.isArray(value) || value.length !== requested.length) return false;
  const ids = new Set<string>();
  return value.every((entry, index) => {
    if (
      !isRecord(entry) ||
      !isUuid(entry.risk_id) ||
      entry.risk_id === parentRiskId ||
      ids.has(entry.risk_id) ||
      typeof entry.title !== "string" ||
      entry.title.trim().length < 5 ||
      typeof entry.score !== "number" ||
      !Number.isFinite(entry.score) ||
      entry.score < 0 ||
      entry.score > 100 ||
      typeof entry.level !== "string" ||
      !["Very Low", "Low", "Medium", "High", "Critical"].includes(entry.level)
    )
      return false;
    ids.add(entry.risk_id);
    const child = requested[index];
    return (
      typeof child.title === "string" &&
      entry.title === child.title.trim() &&
      isNumeric(child.current_risk_score) &&
      entry.score === Number(child.current_risk_score) &&
      entry.level === child.current_risk_level
    );
  });
}

export async function recordRiskDecision(input: {
  riskId: string;
  action: string;
  rationale: string;
  residualRiskScore?: number | null;
  residualRiskLevel?: string | null;
  reviewDate?: string | null;
  reassessmentTrigger?: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_risk_decision", {
    p_risk_id: input.riskId,
    p_action: input.action,
    p_rationale: input.rationale,
    p_residual_risk_score: input.residualRiskScore ?? null,
    p_residual_risk_level: input.residualRiskLevel ?? null,
    p_review_date: input.reviewDate ?? null,
    p_reassessment_trigger: input.reassessmentTrigger ?? null,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record risk decision",
  );
}

export async function decideRiskDecision(
  decisionId: string,
  approve: boolean,
  note: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("decide_risk_decision", {
    p_decision_id: decisionId,
    p_approve: approve,
    p_note: note,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not decide risk decision",
  );
}

export async function acceptResidualRisk(input: {
  riskId: string;
  riskLevel: string;
  rationale: string;
  compensatingControls: string;
  expiresAt: string;
  reassessmentTrigger: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("accept_risk", {
    p_subject_type: "risk",
    p_subject_id: input.riskId,
    p_risk_level: input.riskLevel,
    p_rationale: input.rationale,
    p_compensating_controls: input.compensatingControls,
    p_expires_at: input.expiresAt,
    p_reassessment_trigger: input.reassessmentTrigger,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not accept residual risk",
  );
}

export async function recordRiskOutcome(
  riskId: string,
  outcome: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_risk_outcome", {
    p_risk_id: riskId,
    p_outcome: outcome,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record risk outcome",
  );
}

export async function startIso31000Implementation(
  answers: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("start_iso31000_implementation", {
    p_answers: answers,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not start implementation setup",
  );
}

export async function adoptRiskCriteria(
  criteriaId: string,
  note: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("adopt_risk_criteria", {
    p_criteria_id: criteriaId,
    p_note: note,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not adopt risk criteria",
  );
}

export async function configureRiskCriteria(
  criteriaId: string,
  config: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("update_risk_criteria_draft", {
    p_criteria_id: criteriaId,
    p_config: config,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not configure risk criteria",
  );
}

export async function createRiskCriteriaVersion(
  sourceId: string,
  name?: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("create_risk_criteria_version", {
    p_source_id: sourceId,
    p_name: name ?? null,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not create criteria version",
  );
}

export async function upsertRiskContext(
  context: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("upsert_risk_context", {
    p_context: context,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not create risk context",
  );
}

export async function configureRiskAuthorityRequirements(
  authorityLimitId: string,
  config: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "configure_risk_authority_requirements",
    { p_authority_limit_id: authorityLimitId, p_config: config },
  );
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not configure risk authority requirements",
  );
}

export async function adoptRiskContext(
  contextId: string,
  note: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("adopt_risk_context", {
    p_context_id: contextId,
    p_note: note,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not adopt risk context",
  );
}

export async function recordRiskMaturityAssessment(
  assessment: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_risk_maturity_assessment",
    { p_assessment: assessment },
  );
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record maturity assessment",
  );
}

export async function recordRiskFrameworkReview(
  review: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_risk_framework_review", {
    p_review: review,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record framework review",
  );
}

export async function getRiskAudienceView(
  riskId: string,
  audience: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("get_risk_audience_view", {
    p_risk_id: riskId,
    p_audience: audience,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not load audience view",
  );
}

export async function refreshRiskGovernanceState(): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("refresh_risk_governance_state");
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not refresh expiring risk governance records",
  );
}

export async function getRiskEnterpriseArchitecture(): Promise<EnterpriseRiskArchitecture> {
  await refreshRiskGovernanceState();
  const { data, error } = await supabase.rpc(
    "get_risk_enterprise_architecture",
  );
  if (error) fail("Could not load enterprise risk architecture", error);
  return data as EnterpriseRiskArchitecture;
}

export async function getRiskDecisionOperations(): Promise<RiskDecisionOperations> {
  const { data, error } = await supabase.rpc("get_risk_decision_operations");
  if (error) fail("Could not load risk decision operations", error);
  return data as RiskDecisionOperations;
}

async function controlledRiskRpc(
  name: string,
  args: Record<string, unknown>,
  message: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(name, args);
  return unwrap(data as RpcResult | null, error, message);
}

export interface ObjectiveTreeNode {
  id: string;
  parentId: string | null;
  depth: number;
  level: string;
  description: string;
  target: string;
  targetValue: number | null;
  unit: string | null;
  targetDate: string | null;
  tolerance: string | null;
  status: string;
  version: number;
  owner: string | null;
  linkedRisks: number;
  linkedCases: number;
}

/**
 * The recursive objective hierarchy (D11.15, spec §2): depth-ordered nodes
 * with typed targets and per-node risk/case link counts, straight from
 * get_objective_tree. RLS scopes the read to the caller's organization.
 */
export async function getObjectiveTree(): Promise<ObjectiveTreeNode[]> {
  const { data, error } = await supabase.rpc("get_objective_tree");
  if (error) fail("Could not load the objective hierarchy", error);
  return (data ?? []) as ObjectiveTreeNode[];
}

export const upsertRiskObjective = (objective: Record<string, unknown>) =>
  controlledRiskRpc(
    "upsert_risk_objective",
    { p_objective: objective },
    "Could not save risk objective",
  );

export const adoptRiskObjective = (objectiveId: string, note: string) =>
  controlledRiskRpc(
    "adopt_risk_objective",
    { p_objective_id: objectiveId, p_note: note },
    "Could not adopt risk objective",
  );

export const createRiskObjectiveVersion = (
  objectiveId: string,
  changes: Record<string, unknown>,
  reason: string,
) =>
  controlledRiskRpc(
    "create_risk_objective_version",
    {
      p_objective_id: objectiveId,
      p_changes: changes,
      p_reason: reason,
    },
    "Could not create objective version",
  );

export const linkRiskObjective = (riskId: string, objectiveId: string) =>
  controlledRiskRpc(
    "link_risk_objective",
    { p_risk_id: riskId, p_objective_id: objectiveId },
    "Could not link objective to risk",
  );

export const upsertRiskStakeholder = (stakeholder: Record<string, unknown>) =>
  controlledRiskRpc(
    "upsert_risk_stakeholder",
    { p_stakeholder: stakeholder },
    "Could not save risk stakeholder",
  );

export const recordRiskObligation = (obligation: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_obligation",
    { p_obligation: obligation },
    "Could not record risk obligation",
  );

export const adoptRiskObligation = (obligationId: string, note: string) =>
  controlledRiskRpc(
    "adopt_risk_obligation",
    { p_obligation_id: obligationId, p_note: note },
    "Could not adopt risk obligation",
  );

export const createRiskObligationVersion = (
  obligationId: string,
  changes: Record<string, unknown>,
  reason: string,
) =>
  controlledRiskRpc(
    "create_risk_obligation_version",
    {
      p_obligation_id: obligationId,
      p_changes: changes,
      p_reason: reason,
    },
    "Could not create obligation version",
  );

export const linkRiskObligation = (
  riskId: string,
  obligationId: string,
  applicability: string,
) =>
  controlledRiskRpc(
    "link_risk_obligation",
    {
      p_risk_id: riskId,
      p_obligation_id: obligationId,
      p_applicability: applicability,
    },
    "Could not link risk obligation",
  );

export const recordRiskAssumption = (
  riskId: string,
  assumption: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "record_risk_assumption",
    { p_risk_id: riskId, p_assumption: assumption },
    "Could not record risk assumption",
  );

export const invalidateRiskAssumption = (
  assumptionId: string,
  reason: string,
) =>
  controlledRiskRpc(
    "invalidate_risk_assumption",
    { p_assumption_id: assumptionId, p_reason: reason },
    "Could not invalidate risk assumption",
  );

export const recordRiskAnalysisElement = (
  riskId: string,
  kind: "source" | "consequence",
  element: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "record_risk_analysis_element",
    { p_risk_id: riskId, p_kind: kind, p_element: element },
    "Could not record analysis element",
  );

export const verifyRiskConsequence = (
  consequenceId: string,
  decision: "verified" | "superseded",
  note: string,
) =>
  controlledRiskRpc(
    "verify_risk_consequence",
    {
      p_consequence_id: consequenceId,
      p_decision: decision,
      p_note: note,
    },
    "Could not review consequence assessment",
  );

export const recordRiskLikelihoodEstimate = (
  riskId: string,
  estimate: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "record_risk_likelihood_estimate",
    { p_risk_id: riskId, p_estimate: estimate },
    "Could not record likelihood estimate",
  );

export const recordRiskEventScenario = (scenario: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_event_scenario",
    { p_scenario: scenario },
    "Could not record risk event scenario",
  );

export const recordRiskStressTest = (test: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_stress_test",
    { p_test: test },
    "Could not record risk stress test",
  );

export const linkRiskTreatmentDependency = (
  dependency: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "link_risk_treatment_dependency",
    { p_dependency: dependency },
    "Could not link treatment dependency",
  );

export const configureRiskControlLifecycle = (
  controlId: string,
  config: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "configure_risk_control_lifecycle",
    { p_control_id: controlId, p_config: config },
    "Could not configure control lifecycle",
  );

export const recordRiskChallenge = (challenge: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_challenge",
    { p_challenge: challenge },
    "Could not record risk challenge",
  );

export const resolveRiskChallenge = (
  challengeId: string,
  outcome: string,
  resolution: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "resolve_risk_challenge",
    {
      p_challenge_id: challengeId,
      p_outcome: outcome,
      p_resolution: resolution,
    },
    "Could not resolve risk challenge",
  );

export const recordRiskAssuranceReview = (review: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_assurance_review",
    { p_review: review },
    "Could not record assurance review",
  );

export const recordRiskCommunication = (
  communication: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "record_risk_communication",
    { p_communication: communication },
    "Could not record risk communication",
  );

export const recordRiskLearningTransfer = (transfer: Record<string, unknown>) =>
  controlledRiskRpc(
    "record_risk_learning_transfer",
    { p_transfer: transfer },
    "Could not propose risk learning transfer",
  );

export const decideRiskLearningTransfer = (
  transferId: string,
  adopt: boolean,
  note: string,
) =>
  controlledRiskRpc(
    "decide_risk_learning_transfer",
    { p_transfer_id: transferId, p_adopt: adopt, p_note: note },
    "Could not decide risk learning transfer",
  );

export const recordRiskOutcomeAttribution = (
  learningEventId: string,
  attribution: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "record_risk_outcome_attribution",
    { p_learning_event_id: learningEventId, p_attribution: attribution },
    "Could not record outcome attribution",
  );

export const transitionRiskLifecycle = (
  riskId: string,
  nextStatus: string,
  reason: string,
) =>
  controlledRiskRpc(
    "transition_risk_lifecycle",
    { p_risk_id: riskId, p_next_status: nextStatus, p_reason: reason },
    "Could not transition risk lifecycle",
  );

export const configureRiskAuthorityScope = (
  authorityLimitId: string,
  scope: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "configure_risk_authority_scope",
    { p_authority_limit_id: authorityLimitId, p_scope: scope },
    "Could not configure authority scope",
  );

export const configureRiskIntegrationBinding = (
  integrationId: string,
  binding: Record<string, unknown>,
) =>
  controlledRiskRpc(
    "configure_risk_integration_binding",
    { p_integration_id: integrationId, p_binding: binding },
    "Could not configure risk integration",
  );

export const configureRiskAgentBinding = (
  agentId: string,
  engineKey: string,
  basis: string,
) =>
  controlledRiskRpc(
    "configure_risk_agent_binding",
    { p_agent_id: agentId, p_engine_key: engineKey, p_basis: basis },
    "Could not configure risk agent boundary",
  );

export const provisionRiskAdvisoryAgents = () =>
  controlledRiskRpc(
    "provision_risk_advisory_agents",
    {},
    "Could not provision advisory risk agents",
  );

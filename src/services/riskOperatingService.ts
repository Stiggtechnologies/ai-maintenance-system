import { supabase } from "../lib/supabase";
import type {
  EnterpriseRiskArchitecture,
  RiskAssessmentDraft,
  RiskCockpit,
  RiskDecisionOperations,
  RiskParticipant,
} from "../types/risk";

type RpcResult = Record<string, unknown> & { error?: string };

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

export async function getRiskParticipants(): Promise<RiskParticipant[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, role")
    .order("full_name")
    .returns<RiskParticipant[]>();
  if (error) fail("Could not load risk participants", error);
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
  const { data, error } = await supabase.rpc("record_risk_analysis", {
    p_risk_id: riskId,
    p_analysis: analysis,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record risk analysis",
  );
}

export async function recordRiskValueOfInformation(
  riskId: string,
  analysis: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_risk_value_of_information",
    { p_risk_id: riskId, p_analysis: analysis },
  );
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not record value-of-information analysis",
  );
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

export async function createRiskTreatment(
  riskId: string,
  option: Record<string, unknown>,
  select = false,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("create_risk_treatment", {
    p_risk_id: riskId,
    p_option: option,
    p_select: select,
  });
  return unwrap(
    data as RpcResult | null,
    error,
    "Could not create risk treatment",
  );
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

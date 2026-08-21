import { supabase } from "../lib/supabase";
import type { EvidenceGrade } from "./riaAssessment";

export type RiaAuthoringSource = {
  id: string;
  file_name: string;
  category: string;
  status: string;
  quality_grade: string;
};

export type RiaAuthoringFinding = {
  id: string;
  title: string;
  severity: string;
  review_state: string;
};

export type BaselineMetricDraft = {
  assessmentId: string;
  metricKey: string;
  label: string;
  valueText: string | null;
  unit: string | null;
  method: string;
  population: string;
  sourceFields: string[];
  exclusions: string | null;
  evidenceGrade: EvidenceGrade;
  evidenceSourceIds: string[];
};

export type CriticalityDraft = {
  assessmentId: string;
  assetRef: string | null;
  assetName: string;
  criticality: "critical" | "high" | "medium" | "low";
  rationale: string;
};

export type FindingEvidenceDraft = {
  dataSourceId: string;
  recordReference: string | null;
  note: string | null;
  provenance: string | null;
  confidence: "high" | "medium" | "low";
};

export type FindingDraft = {
  assessmentId: string;
  title: string;
  statement: string;
  severity: "critical" | "high" | "moderate" | "low";
  confidence: "high" | "medium" | "low";
  evidenceGrade: EvidenceGrade;
  decisionBoundary: string;
  evidence: FindingEvidenceDraft[];
};

export type OpportunityDraft = {
  assessmentId: string;
  findingId: string | null;
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  rationale: string;
  effort: "low" | "medium" | "high" | null;
  recommendedAction: string | null;
  owner: string | null;
  valueLow: number | null;
  valueHigh: number | null;
  valueCurrency: string | null;
  method: string | null;
  valueSource: string | null;
  assumptions: string | null;
  confidence: "high" | "medium" | "low";
};

export type DecisionDraft = {
  assessmentId: string;
  findingId: string | null;
  decisionRequired: string;
  recommendation: string;
  evidenceSummary: string;
  uncertainty: string | null;
  authorityRole: string;
  boundary: string;
  verification: string;
  dueOn: string | null;
};

export type ActionDraft = {
  assessmentId: string;
  findingId: string | null;
  horizon: "day_30" | "day_60" | "day_90";
  action: string;
  owner: string | null;
  dueOn: string | null;
  verificationMetric: string | null;
  authorityRole: string | null;
  boundary: string | null;
};

export type VerificationDraft = {
  assessmentId: string;
  checkpoint: "day_30" | "day_60" | "day_90";
  metric: string;
  baseline: string | null;
  observed: string | null;
  method: string;
  evidenceSourceIds: string[];
  status: "pending" | "supported" | "partially_supported" | "unsupported";
};

export type AssessmentPhase =
  | "active"
  | "analysis"
  | "customer_review"
  | "verification"
  | "complete"
  | "closed";

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

function isMissingFunction(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    MISSING_FUNCTION_CODES.has(error.code ?? "") ||
    /could not find the function|function .* does not exist/i.test(
      error.message ?? "",
    )
  );
}

async function governedRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (isMissingFunction(error)) {
    throw new Error(
      `This RIA authoring action is not deployed yet (${name}). The governed server contract must land before this write is available.`,
    );
  }
  if (error) throw new Error(error.message);
  return data;
}

function idFromRpc(data: unknown, label: string): string {
  const row = Array.isArray(data) ? data[0] : data;
  const id =
    typeof row === "string"
      ? row
      : row && typeof row === "object"
        ? String(
            (row as Record<string, unknown>).id ??
              (row as Record<string, unknown>)[`${label}_id`] ??
              "",
          )
        : "";
  if (!id) throw new Error(`${label} save completed without an identifier.`);
  return id;
}

export async function listRiaAuthoringSources(
  assessmentId: string,
): Promise<RiaAuthoringSource[]> {
  const { data, error } = await supabase
    .from("ria_data_sources")
    .select("id,file_name,category,status,quality_grade")
    .eq("assessment_id", assessmentId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RiaAuthoringSource[];
}

export async function listRiaAuthoringFindings(
  assessmentId: string,
): Promise<RiaAuthoringFinding[]> {
  const { data, error } = await supabase
    .from("ria_findings")
    .select("id,title,severity,review_state")
    .eq("assessment_id", assessmentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RiaAuthoringFinding[];
}

export async function saveBaselineMetric(
  draft: BaselineMetricDraft,
): Promise<string> {
  const data = await governedRpc("upsert_ria_baseline_metric", {
    p_assessment_id: draft.assessmentId,
    p_metric_key: draft.metricKey,
    p_label: draft.label,
    p_value_text: draft.valueText,
    p_unit: draft.unit,
    p_method: draft.method,
    p_population: draft.population,
    p_source_fields: draft.sourceFields,
    p_exclusions: draft.exclusions,
    p_evidence_grade: draft.evidenceGrade,
    p_evidence_source_ids: draft.evidenceSourceIds,
  });
  return idFromRpc(data, "metric");
}

export async function createCriticalityDraft(
  draft: CriticalityDraft,
): Promise<string> {
  const data = await governedRpc("create_ria_criticality_draft", {
    p_assessment_id: draft.assessmentId,
    p_asset_ref: draft.assetRef,
    p_asset_name: draft.assetName,
    p_criticality: draft.criticality,
    p_rationale: draft.rationale,
  });
  return idFromRpc(data, "criticality");
}

export async function createFindingDraft(
  draft: FindingDraft,
): Promise<string> {
  const data = await governedRpc("create_ria_finding_draft", {
    p_assessment_id: draft.assessmentId,
    p_title: draft.title,
    p_statement: draft.statement,
    p_severity: draft.severity,
    p_confidence: draft.confidence,
    p_evidence_grade: draft.evidenceGrade,
    p_decision_boundary: draft.decisionBoundary,
    p_evidence: draft.evidence.map((item) => ({
      data_source_id: item.dataSourceId,
      record_reference: item.recordReference,
      note: item.note,
      provenance: item.provenance,
      confidence: item.confidence,
    })),
  });
  return idFromRpc(data, "finding");
}

export async function createOpportunityDraft(
  draft: OpportunityDraft,
): Promise<string> {
  const data = await governedRpc("create_ria_opportunity_draft", {
    p_assessment_id: draft.assessmentId,
    p_finding_id: draft.findingId,
    p_title: draft.title,
    p_priority: draft.priority,
    p_rationale: draft.rationale,
    p_effort: draft.effort,
    p_recommended_action: draft.recommendedAction,
    p_owner: draft.owner,
    p_value_low: draft.valueLow,
    p_value_high: draft.valueHigh,
    p_value_currency: draft.valueCurrency,
    p_method: draft.method,
    p_value_source: draft.valueSource,
    p_assumptions: draft.assumptions,
    p_confidence: draft.confidence,
  });
  return idFromRpc(data, "opportunity");
}

export async function createDecisionDraft(
  draft: DecisionDraft,
): Promise<string> {
  const data = await governedRpc("create_ria_decision_draft", {
    p_assessment_id: draft.assessmentId,
    p_finding_id: draft.findingId,
    p_decision_required: draft.decisionRequired,
    p_recommendation: draft.recommendation,
    p_evidence_summary: draft.evidenceSummary,
    p_uncertainty: draft.uncertainty,
    p_authority_role: draft.authorityRole,
    p_boundary: draft.boundary,
    p_verification: draft.verification,
    p_due_on: draft.dueOn,
  });
  return idFromRpc(data, "decision");
}

export async function createActionDraft(draft: ActionDraft): Promise<string> {
  const data = await governedRpc("create_ria_action_draft", {
    p_assessment_id: draft.assessmentId,
    p_finding_id: draft.findingId,
    p_horizon: draft.horizon,
    p_action: draft.action,
    p_owner: draft.owner,
    p_due_on: draft.dueOn,
    p_verification_metric: draft.verificationMetric,
    p_authority_role: draft.authorityRole,
    p_boundary: draft.boundary,
  });
  return idFromRpc(data, "action");
}

export async function recordVerification(
  draft: VerificationDraft,
): Promise<string> {
  const data = await governedRpc("record_ria_verification", {
    p_assessment_id: draft.assessmentId,
    p_checkpoint: draft.checkpoint,
    p_metric: draft.metric,
    p_baseline: draft.baseline,
    p_observed: draft.observed,
    p_method: draft.method,
    p_evidence_source_ids: draft.evidenceSourceIds,
    p_status: draft.status,
  });
  return idFromRpc(data, "verification");
}

export async function transitionAssessmentPhase(
  assessmentId: string,
  phase: AssessmentPhase,
): Promise<void> {
  await governedRpc("transition_ria_assessment_phase", {
    p_assessment_id: assessmentId,
    p_status: phase,
  });
}

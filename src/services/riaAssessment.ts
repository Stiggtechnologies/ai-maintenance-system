import { supabase } from "../lib/supabase";

export type EvidenceGrade = "supported" | "partially_supported" | "unsupported";
export type RiaAssessment = {
  id: string;
  organization_id: string;
  name: string;
  scope_label: string;
  status: string;
  commercial_model: string;
  started_on: string | null;
  target_end_on: string | null;
  source_retention_until: string | null;
  notes: string | null;
  created_at: string;
};
export type RiaDataSource = {
  id: string;
  assessment_id: string;
  organization_id: string;
  category: string;
  file_name: string;
  object_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  record_count: number | null;
  status: string;
  quality_grade: string;
  notes: string | null;
  created_at: string;
};
export type RiaBaselineMetric = {
  id: string;
  metric_key: string;
  label: string;
  value_text: string | null;
  unit: string | null;
  method: string | null;
  evidence_grade: EvidenceGrade;
  evidence_refs: string[];
};
export type RiaCriticalityItem = {
  id: string;
  asset_ref: string | null;
  asset_name: string;
  criticality: string;
  rationale: string;
  review_state: string;
  approved_at: string | null;
};
/**
 * evidence_refs (uuid[]) was retired by 20260920000000. It had no referential
 * integrity, so a cross-tenant uuid, a deleted source and a uuid that never
 * existed all rendered identically in the Evidence Explorer. Links now come
 * from ria_finding_evidence, whose foreign keys make each one resolvable.
 */
export type RiaFinding = {
  id: string;
  title: string;
  statement: string;
  severity: string;
  confidence: string;
  evidence_grade: EvidenceGrade;
  decision_boundary: string;
  review_state: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
};
export type RiaFindingEvidence = {
  id: string;
  finding_id: string;
  data_source_id: string;
  record_reference: string | null;
  note: string | null;
};
export type RiaOpportunity = {
  id: string;
  title: string;
  priority: string;
  rationale: string;
  method: string | null;
  value_low: number | null;
  value_high: number | null;
  value_currency: string | null;
  confidence: string;
  owner: string | null;
  status: string;
};
export type RiaDecision = {
  id: string;
  decision_required: string;
  recommendation: string;
  evidence_summary: string;
  uncertainty: string | null;
  authority_role: string;
  boundary: string;
  verification: string;
  due_on: string | null;
  status: string;
  decided_at: string | null;
};
export type RiaAction = {
  id: string;
  horizon: "day_30" | "day_60" | "day_90";
  action: string;
  owner: string | null;
  due_on: string | null;
  verification_metric: string | null;
  status: string;
};
export type RiaVerification = {
  id: string;
  checkpoint: "day_30" | "day_60" | "day_90";
  metric: string;
  baseline: string | null;
  observed: string | null;
  method: string;
  evidence_refs: string[];
  status: string;
  verified_at: string | null;
};

export type RiaWorkspaceData = {
  assessment: RiaAssessment;
  sources: RiaDataSource[];
  metrics: RiaBaselineMetric[];
  criticality: RiaCriticalityItem[];
  findings: RiaFinding[];
  findingEvidence: RiaFindingEvidence[];
  opportunities: RiaOpportunity[];
  decisions: RiaDecision[];
  actions: RiaAction[];
  verifications: RiaVerification[];
};

async function rows<T>(table: string, assessmentId: string): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("assessment_id", assessmentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as T[];
}

export async function loadRiaWorkspace(
  organizationId: string,
): Promise<RiaWorkspaceData | null> {
  const { data: assessment, error } = await supabase
    .from("ria_assessments")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === "42P01")
      throw new Error("The RIA workspace schema has not been deployed yet.");
    throw new Error(error.message);
  }
  if (!assessment) return null;
  const id = String(assessment.id);
  const [
    sources,
    metrics,
    criticality,
    findings,
    opportunities,
    decisions,
    actions,
    verifications,
  ] = await Promise.all([
    rows<RiaDataSource>("ria_data_sources", id),
    rows<RiaBaselineMetric>("ria_baseline_metrics", id),
    rows<RiaCriticalityItem>("ria_criticality_items", id),
    rows<RiaFinding>("ria_findings", id),
    rows<RiaOpportunity>("ria_opportunities", id),
    rows<RiaDecision>("ria_decisions", id),
    rows<RiaAction>("ria_actions", id),
    rows<RiaVerification>("ria_verifications", id),
  ]);
  // Evidence links are keyed by finding, not by assessment, so they are read
  // against the findings just loaded. RLS still scopes them to the org.
  const findingIds = findings.map((f) => f.id);
  let findingEvidence: RiaFindingEvidence[] = [];
  if (findingIds.length > 0) {
    const { data: links, error: linkError } = await supabase
      .from("ria_finding_evidence")
      .select("id,finding_id,data_source_id,record_reference,note")
      .in("finding_id", findingIds);
    if (linkError) throw new Error(linkError.message);
    findingEvidence = (links || []) as RiaFindingEvidence[];
  }
  return {
    assessment: assessment as RiaAssessment,
    sources,
    metrics,
    criticality,
    findings,
    findingEvidence,
    opportunities,
    decisions,
    actions,
    verifications,
  };
}

/**
 * uploadRiaSource() was removed. It counted records by splitting the file on
 * newlines, which over-counts every export with a quoted line break in it, and
 * it treated an RLS refusal (zero rows, no error) as a successful upload. The
 * Data Room's uploadSource() in riaDataRoom.ts replaces both behaviours.
 */

export async function publishRiaFinding(id: string): Promise<void> {
  const { error } = await supabase.rpc("publish_ria_finding", {
    p_finding_id: id,
  });
  if (error) throw new Error(error.message);
}

export async function approveRiaCriticalityItem(id: string): Promise<void> {
  const { error } = await supabase.rpc("approve_ria_criticality_item", {
    p_item_id: id,
  });
  if (error) throw new Error(error.message);
}

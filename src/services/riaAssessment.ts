import { supabase } from "../lib/supabase";

export type EvidenceGrade = "supported" | "partially_supported" | "unsupported";
export type RiaAssessment = { id:string; organization_id:string; name:string; scope_label:string; status:string; commercial_model:string; started_on:string|null; target_end_on:string|null; source_retention_until:string|null; notes:string|null; created_at:string; };
export type RiaDataSource = { id:string; assessment_id:string; organization_id:string; category:string; file_name:string; object_path:string; mime_type:string|null; size_bytes:number|null; record_count:number|null; status:string; quality_grade:string; notes:string|null; created_at:string; };
export type RiaBaselineMetric = { id:string; metric_key:string; label:string; value_text:string|null; unit:string|null; method:string|null; evidence_grade:EvidenceGrade; evidence_refs:string[]; };
export type RiaCriticalityItem = { id:string; asset_ref:string|null; asset_name:string; criticality:string; rationale:string; review_state:string; approved_at:string|null; };
export type RiaFinding = { id:string; title:string; statement:string; severity:string; confidence:string; evidence_grade:EvidenceGrade; decision_boundary:string; evidence_refs:string[]; review_state:string; reviewed_at:string|null; };
export type RiaOpportunity = { id:string; title:string; priority:string; rationale:string; method:string|null; value_low:number|null; value_high:number|null; value_currency:string|null; confidence:string; owner:string|null; status:string; };
export type RiaDecision = { id:string; decision_required:string; recommendation:string; evidence_summary:string; uncertainty:string|null; authority_role:string; boundary:string; verification:string; due_on:string|null; status:string; decided_at:string|null; };
export type RiaAction = { id:string; horizon:"day_30"|"day_60"|"day_90"; action:string; owner:string|null; due_on:string|null; verification_metric:string|null; status:string; };
export type RiaVerification = { id:string; checkpoint:"day_30"|"day_60"|"day_90"; metric:string; baseline:string|null; observed:string|null; method:string; evidence_refs:string[]; status:string; verified_at:string|null; };

export type RiaWorkspaceData = { assessment:RiaAssessment; sources:RiaDataSource[]; metrics:RiaBaselineMetric[]; criticality:RiaCriticalityItem[]; findings:RiaFinding[]; opportunities:RiaOpportunity[]; decisions:RiaDecision[]; actions:RiaAction[]; verifications:RiaVerification[]; };

async function rows<T>(table:string, assessmentId:string):Promise<T[]> {
  const { data, error } = await supabase.from(table).select("*").eq("assessment_id", assessmentId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as T[];
}

export async function loadRiaWorkspace(organizationId:string):Promise<RiaWorkspaceData|null> {
  const { data: assessment, error } = await supabase.from("ria_assessments").select("*").eq("organization_id", organizationId).order("created_at", { ascending:false }).limit(1).maybeSingle();
  if (error) {
    if (error.code === "42P01") throw new Error("The RIA workspace schema has not been deployed yet.");
    throw new Error(error.message);
  }
  if (!assessment) return null;
  const id = String(assessment.id);
  const [sources,metrics,criticality,findings,opportunities,decisions,actions,verifications] = await Promise.all([
    rows<RiaDataSource>("ria_data_sources",id), rows<RiaBaselineMetric>("ria_baseline_metrics",id), rows<RiaCriticalityItem>("ria_criticality_items",id), rows<RiaFinding>("ria_findings",id), rows<RiaOpportunity>("ria_opportunities",id), rows<RiaDecision>("ria_decisions",id), rows<RiaAction>("ria_actions",id), rows<RiaVerification>("ria_verifications",id),
  ]);
  return { assessment: assessment as RiaAssessment, sources, metrics, criticality, findings, opportunities, decisions, actions, verifications };
}

export async function uploadRiaSource(organizationId:string, assessmentId:string, category:string, file:File):Promise<void> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,140);
  const path = `${organizationId}/${assessmentId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from("ria-source-files").upload(path,file,{ upsert:false, contentType:file.type || undefined });
  if (uploadError) throw new Error(uploadError.message);
  let recordCount:number|null = null;
  if ((file.type.includes("csv") || file.name.toLowerCase().endsWith(".csv")) && file.size <= 10_000_000) {
    try { const text = await file.text(); recordCount = Math.max(0,text.split(/\r?\n/).filter(Boolean).length - 1); } catch { recordCount = null; }
  }
  const { data:{ user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("ria_data_sources").insert({ assessment_id:assessmentId, organization_id:organizationId, category, file_name:file.name, object_path:path, mime_type:file.type || null, size_bytes:file.size, record_count:recordCount, status:recordCount === null ? "uploaded" : "profiled", uploaded_by:user?.id || null });
  if (error) {
    await supabase.storage.from("ria-source-files").remove([path]);
    throw new Error(error.message);
  }
}

export async function publishRiaFinding(id:string):Promise<void> {
  const { error } = await supabase.rpc("publish_ria_finding", { p_finding_id:id });
  if (error) throw new Error(error.message);
}

export async function approveRiaCriticalityItem(id:string):Promise<void> {
  const { error } = await supabase.rpc("approve_ria_criticality_item", { p_item_id:id });
  if (error) throw new Error(error.message);
}

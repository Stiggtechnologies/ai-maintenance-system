import { supabase } from "../lib/supabase";

export type ServiceCommitmentType =
  | "availability_guarantee"
  | "response_time_guarantee"
  | "reliability_guarantee"
  | "punctuality_target"
  | "service_standard"
  | "maintenance_contract"
  | "performance_based_logistics"
  | "warranty"
  | "concession_requirement";

export interface ServiceContractObligation {
  id: string;
  source_type: "contract" | "oem_requirement";
  source_reference: string;
  requirement: string;
  applicable_scope: string;
  responsible_role: string;
  service_commitment_type: ServiceCommitmentType;
  asset_id: string | null;
  metric_name: string | null;
  target_value: number | null;
  target_unit: string | null;
  measurement_window: string | null;
  measurement_basis: string;
  remedy: string | null;
  penalty_value: number | null;
  incentive_value: number | null;
  commercial_currency: string | null;
  evidence_item_ids: string[];
  status: "draft" | "adopted" | "superseded" | "expired";
  created_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface RecommendationContractRisk {
  id: string;
  recommendation_id: string;
  recommendation_title: string;
  obligation_id: string;
  source_reference: string;
  commitment_type: ServiceCommitmentType;
  breach_state: "compliant" | "at_risk" | "breached" | "unknown";
  risk_rating: "low" | "medium" | "high" | "critical" | "unknown";
  exposure_basis: string;
  actual_value: number | null;
  actual_unit: string | null;
  estimated_penalty_exposure: number | null;
  currency: string | null;
  evidence_item_ids: string[];
  missing_evidence: string[];
  status: "draft" | "verified";
  recorded_by: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
}

export interface ServiceContractRiskWorkspace {
  commitment_types: ServiceCommitmentType[];
  obligations: ServiceContractObligation[];
  assessments: RecommendationContractRisk[];
  basis: string;
}

export interface ServiceContractReferences {
  assets: { id: string; name: string }[];
  serviceLevels: { asset_id: string; service_name: string }[];
  contracts: { id: number; package_code: string; title: string }[];
  suppliers: { id: number; supplier_code: string; name: string }[];
  warranties: { id: number; asset_id: string | null; ends_on: string | null }[];
  recommendations: { id: string; title: string; status: string }[];
  evidence: { id: string; description: string; asset_id: string | null }[];
}

function rpcResult(data: unknown) {
  const value = data as Record<string, unknown> & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function getServiceContractRiskWorkspace(): Promise<ServiceContractRiskWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_service_contract_risk_workspace",
  );
  if (error) throw new Error(error.message);
  return rpcResult(data) as unknown as ServiceContractRiskWorkspace;
}

export async function getServiceContractReferences(): Promise<ServiceContractReferences> {
  const [
    assets,
    serviceLevels,
    contracts,
    suppliers,
    warranties,
    recommendations,
    evidence,
  ] = await Promise.all([
    supabase.from("assets").select("id,name").order("name"),
    supabase
      .from("asset_service_levels")
      .select("asset_id,service_name")
      .order("service_name"),
    supabase
      .from("contract_packages")
      .select("id,package_code,title")
      .order("package_code"),
    supabase.from("suppliers").select("id,supplier_code,name").order("name"),
    supabase
      .from("warranty_terms")
      .select("id,asset_id,ends_on")
      .order("ends_on", { ascending: true }),
    supabase
      .from("recommendations")
      .select("id,title,status")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("evidence_items")
      .select("id,description,asset_id")
      .eq("verification_status", "verified")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  for (const result of [
    assets,
    serviceLevels,
    contracts,
    suppliers,
    warranties,
    recommendations,
    evidence,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    assets: assets.data ?? [],
    serviceLevels: serviceLevels.data ?? [],
    contracts: contracts.data ?? [],
    suppliers: suppliers.data ?? [],
    warranties: warranties.data ?? [],
    recommendations: recommendations.data ?? [],
    evidence: evidence.data ?? [],
  } as ServiceContractReferences;
}

export async function recordServiceContractObligation(
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(
    "record_service_contract_obligation",
    {
      p_obligation: input,
    },
  );
  if (error) throw new Error(error.message);
  return rpcResult(data);
}

export async function adoptServiceContractObligation(id: string, note: string) {
  const { data, error } = await supabase.rpc(
    "adopt_service_contract_obligation",
    {
      p_obligation_id: id,
      p_note: note,
    },
  );
  if (error) throw new Error(error.message);
  return rpcResult(data);
}

export async function recordRecommendationContractRisk(
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(
    "record_recommendation_contract_risk",
    {
      p_assessment: input,
    },
  );
  if (error) throw new Error(error.message);
  return rpcResult(data);
}

export async function verifyRecommendationContractRisk(
  id: string,
  note: string,
) {
  const { data, error } = await supabase.rpc(
    "verify_recommendation_contract_risk",
    {
      p_assessment_id: id,
      p_note: note,
    },
  );
  if (error) throw new Error(error.message);
  return rpcResult(data);
}

import { supabase } from "../lib/supabase";

export const CLIMATE_EXPOSURE_HAZARDS = [
  "heat",
  "cold",
  "flood",
  "wildfire",
  "wind",
  "ice",
  "drought",
  "sea_level",
  "permafrost",
  "seismic",
  "landslide",
  "storm_surge",
  "water_scarcity",
] as const;

export const CLIMATE_DECISION_FAMILIES = [
  "design",
  "maintenance_interval",
  "spares",
  "emergency_plan",
  "renewal",
] as const;

export type ClimateExposureHazard = (typeof CLIMATE_EXPOSURE_HAZARDS)[number];
export type ClimateDecisionFamily = (typeof CLIMATE_DECISION_FAMILIES)[number];

export interface ClimateHazardRow {
  id: number;
  hazard: ClimateExposureHazard;
  future_condition: string;
  exposure_statement: string;
  design_response: string;
  residual_gap: string;
  decision_effects: Record<ClimateDecisionFamily, string>;
  evidence_item_id: string;
  geospatial_feature_ids: string[];
  missing_evidence: string[];
}

export interface ClimateExposureAssessment {
  id: string;
  assessment_ref: string;
  revision: number;
  asset_id: string | null;
  site_id: string | null;
  risk_id: string | null;
  recommendation_id: string | null;
  future_conditions_basis: string;
  source_as_of: string;
  valid_until: string | null;
  evidence_item_ids: string[];
  geospatial_feature_ids: string[];
  missing_evidence: string[];
  status: "draft" | "reviewed" | "superseded";
  reviewed_at: string | null;
  review_note: string | null;
  hazards: ClimateHazardRow[];
  missing_hazards: ClimateExposureHazard[];
}

export interface ClimateExposureWorkspace {
  hazards: ClimateExposureHazard[];
  decision_families: ClimateDecisionFamily[];
  assessments: ClimateExposureAssessment[];
  basis: string;
}

export interface ClimateExposureReferences {
  assets: { id: string; name: string; site_id: string | null }[];
  sites: { id: string; name: string }[];
  evidence: { id: string; description: string; asset_id: string | null }[];
  features: {
    id: string;
    name: string;
    feature_type: string;
    status: string;
  }[];
}

function checked(data: unknown) {
  const value = data as Record<string, unknown> & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function getClimateExposureWorkspace(): Promise<ClimateExposureWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_climate_hazard_exposure_workspace",
  );
  if (error) throw new Error(error.message);
  return checked(data) as unknown as ClimateExposureWorkspace;
}

export async function getClimateExposureReferences(): Promise<ClimateExposureReferences> {
  const [assets, sites, evidence, features] = await Promise.all([
    supabase.from("assets").select("id,name,site_id").order("name"),
    supabase.from("sites").select("id,name").order("name"),
    supabase
      .from("evidence_items")
      .select("id,description,asset_id")
      .eq("verification_status", "verified")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("geospatial_features")
      .select("id,name,feature_type,status")
      .eq("status", "verified")
      .order("name"),
  ]);
  for (const result of [assets, sites, evidence, features]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    assets: assets.data ?? [],
    sites: sites.data ?? [],
    evidence: evidence.data ?? [],
    features: features.data ?? [],
  } as ClimateExposureReferences;
}

export async function createClimateExposure(input: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("create_climate_hazard_exposure", {
    p_assessment: input,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function recordClimateHazard(
  assessmentId: string,
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("record_climate_hazard_exposure", {
    p_assessment_id: assessmentId,
    p_hazard: input,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function reviewClimateExposure(id: string, note: string) {
  const { data, error } = await supabase.rpc("review_climate_hazard_exposure", {
    p_assessment_id: id,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

import { supabase } from "../lib/supabase";

export type GeospatialFeatureType =
  | "site"
  | "asset"
  | "linear_route"
  | "access_route"
  | "hazard_zone"
  | "weather_cell"
  | "receptor"
  | "logistics_hub"
  | "spares_region"
  | "failure_cluster";

export type GeospatialAssessmentType =
  | "weather_hazard_exposure"
  | "access_route"
  | "crew_travel"
  | "remote_logistics"
  | "regional_spares"
  | "failure_clustering"
  | "hazard_overlay"
  | "linear_reference";

export interface GeospatialFeature {
  id: string;
  feature_key: string;
  feature_type: GeospatialFeatureType;
  name: string;
  geometry_type: string;
  geometry: { type: string; coordinates: unknown[] };
  source_system: string;
  source_reference: string;
  observed_at: string;
  valid_until: string | null;
  data_quality: string;
  evidence_item_ids: string[];
  missing_evidence: string[];
  status: "draft" | "verified";
  recorded_by: string;
  verified_by: string | null;
}

export interface GeospatialAssessment {
  id: string;
  assessment_type: GeospatialAssessmentType;
  title: string;
  asset_id: string | null;
  site_id: string | null;
  recommendation_id: string | null;
  exposure_rating: "none" | "low" | "medium" | "high" | "critical" | "unknown";
  basis: string;
  conclusion: string;
  evidence_item_ids: string[];
  missing_evidence: string[];
  status: "draft" | "verified";
  recorded_by: string;
  verified_by: string | null;
}

export interface RegionalStockContext {
  material_id: string;
  material_code: string;
  description: string;
  site_id: string | null;
  site_name: string | null;
  qty_on_hand: number;
  qty_reserved: number;
  qty_on_order: number;
  last_counted_at: string | null;
  source_system: string | null;
}

export interface GeospatialWorkspace {
  feature_types: GeospatialFeatureType[];
  assessment_types: GeospatialAssessmentType[];
  features: GeospatialFeature[];
  links: Record<string, unknown>[];
  assessments: GeospatialAssessment[];
  regional_stock: RegionalStockContext[];
  linear_routes: Record<string, unknown>[];
  weather_signals: Record<string, unknown>[];
  basis: string;
}

export interface GeospatialReferences {
  assets: { id: string; name: string; site_id: string | null }[];
  sites: { id: string; name: string }[];
  recommendations: { id: string; title: string; asset_id: string | null }[];
  crews: { id: number; title: string }[];
  materials: { id: string; material_code: string; description: string }[];
  evidence: { id: string; description: string; asset_id: string | null }[];
}

function checked(data: unknown) {
  const value = data as Record<string, unknown> & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function getGeospatialOperationalWorkspace(): Promise<GeospatialWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_geospatial_operational_workspace",
  );
  if (error) throw new Error(error.message);
  return checked(data) as unknown as GeospatialWorkspace;
}

export async function getGeospatialReferences(): Promise<GeospatialReferences> {
  const [assets, sites, recommendations, crews, materials, evidence] =
    await Promise.all([
      supabase.from("assets").select("id,name,site_id").order("name"),
      supabase.from("sites").select("id,name").order("name"),
      supabase
        .from("recommendations")
        .select("id,title,asset_id")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("crew_templates").select("id,title").order("title"),
      supabase
        .from("materials")
        .select("id,material_code,description")
        .eq("is_template", false)
        .order("material_code"),
      supabase
        .from("evidence_items")
        .select("id,description,asset_id")
        .eq("verification_status", "verified")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
  for (const result of [
    assets,
    sites,
    recommendations,
    crews,
    materials,
    evidence,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  return {
    assets: assets.data ?? [],
    sites: sites.data ?? [],
    recommendations: recommendations.data ?? [],
    crews: crews.data ?? [],
    materials: materials.data ?? [],
    evidence: evidence.data ?? [],
  } as GeospatialReferences;
}

export async function recordGeospatialFeature(input: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("record_geospatial_feature", {
    p_feature: input,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function verifyGeospatialFeature(id: string, note: string) {
  const { data, error } = await supabase.rpc("verify_geospatial_feature", {
    p_feature_id: id,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function linkGeospatialSubject(input: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("link_geospatial_subject", {
    p_link: input,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function recordGeospatialOperationalAssessment(
  input: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(
    "record_geospatial_operational_assessment",
    { p_assessment: input },
  );
  if (error) throw new Error(error.message);
  return checked(data);
}

export async function verifyGeospatialOperationalAssessment(
  id: string,
  note: string,
) {
  const { data, error } = await supabase.rpc(
    "verify_geospatial_operational_assessment",
    { p_assessment_id: id, p_note: note },
  );
  if (error) throw new Error(error.message);
  return checked(data);
}

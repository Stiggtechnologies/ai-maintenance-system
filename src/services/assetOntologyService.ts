import { supabase } from "../lib/supabase";
import type { LinearDefect } from "../lib/asset-ontology";

export interface OntologyAssetOption {
  id: string;
  name: string;
  tag: string | null;
  asset_class: string | null;
  assignment: {
    class_key: string;
    basis: string | null;
    evidence_item_id: string | null;
    assigned_at: string;
  } | null;
}

export interface OntologyEvidenceOption {
  id: string;
  asset_id: string | null;
  description: string;
  evidence_class: string | null;
  source_system: string | null;
  ts: string;
}

export interface LinearRouteOption {
  id: number;
  asset_id: string;
  route_code: string;
  measure_unit: "km" | "m" | "mi" | "ft" | "chain";
  start_measure: number;
  end_measure: number;
  description: string | null;
  basis: string | null;
  evidence_item_id: string | null;
}

interface AssetRow {
  id: string;
  name: string;
  tag: string | null;
  asset_class: string | null;
}

interface AssignmentRow {
  asset_id: string;
  class_key: string;
  basis: string | null;
  evidence_item_id: string | null;
  assigned_at: string;
}

type RpcResult = Record<string, unknown> & { error?: string };

export async function listOntologyAssets(): Promise<OntologyAssetOption[]> {
  const [assetsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id,name,tag,asset_class")
      .order("name")
      .returns<AssetRow[]>(),
    supabase
      .from("asset_class_assignments")
      .select("asset_id,class_key,basis,evidence_item_id,assigned_at")
      .returns<AssignmentRow[]>(),
  ]);

  if (assetsResult.error) {
    throw new Error(
      `Could not load ontology assets: ${assetsResult.error.message}`,
    );
  }
  if (assignmentsResult.error) {
    throw new Error(
      `Could not load asset classifications: ${assignmentsResult.error.message}`,
    );
  }

  const assignments = new Map(
    (assignmentsResult.data ?? []).map((row) => [row.asset_id, row]),
  );
  return (assetsResult.data ?? []).map((asset) => ({
    ...asset,
    assignment: assignments.get(asset.id) ?? null,
  }));
}

export async function listOntologyEvidence(
  assetId: string,
): Promise<OntologyEvidenceOption[]> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select(
      "id,asset_id,description,evidence_class,source_system,ts,verification_status",
    )
    .eq("verification_status", "verified")
    .in("evidence_class", [
      "MEASURED",
      "INSPECTED",
      "DOCUMENTED",
      "EXPERT_JUDGEMENT",
    ])
    .or(`asset_id.eq.${assetId},asset_id.is.null`)
    .order("ts", { ascending: false })
    .limit(50)
    .returns<
      (OntologyEvidenceOption & { verification_status: "verified" })[]
    >();
  if (error) {
    throw new Error(`Could not load classification evidence: ${error.message}`);
  }
  return (data ?? []) as OntologyEvidenceOption[];
}

export async function assignAssetClassProfile(input: {
  assetId: string;
  classKey: string;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("assign_asset_class_profile", {
    p_asset_id: input.assetId,
    p_class_key: input.classKey,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
  });
  if (error) {
    throw new Error(`Could not assign asset class: ${error.message}`);
  }
  const result = data as RpcResult | null;
  if (!result) throw new Error("Could not assign asset class: no response");
  if (typeof result.error === "string" && result.error) {
    throw new Error(`Could not assign asset class: ${result.error}`);
  }
  return result;
}

export async function listLinearAssetRoutes(): Promise<LinearRouteOption[]> {
  const { data, error } = await supabase
    .from("linear_asset_routes")
    .select(
      "id,asset_id,route_code,measure_unit,start_measure,end_measure,description,basis,evidence_item_id",
    )
    .order("route_code")
    .returns<LinearRouteOption[]>();
  if (error) {
    throw new Error(`Could not load linear routes: ${error.message}`);
  }
  return (data ?? []).map((route) => ({
    ...route,
    start_measure: Number(route.start_measure),
    end_measure: Number(route.end_measure),
  }));
}

export async function listLinearRouteDefects(
  routeId: number,
): Promise<LinearDefect[]> {
  const { data, error } = await supabase
    .from("linear_defects")
    .select("at_measure,defect_type,severity,repaired_at")
    .eq("route_id", routeId)
    .order("at_measure")
    .returns<
      {
        at_measure: number;
        defect_type: string;
        severity: string | null;
        repaired_at: string | null;
      }[]
    >();
  if (error) {
    throw new Error(`Could not load route defects: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    atMeasure: Number(row.at_measure),
    defectType: row.defect_type,
    severity: row.severity,
    repairedAt: row.repaired_at,
  }));
}

async function requireRpcResult(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
): Promise<RpcResult> {
  if (result.error) {
    throw new Error(`${operation}: ${result.error.message}`);
  }
  const data = result.data as RpcResult | null;
  if (!data) throw new Error(`${operation}: no response`);
  if (typeof data.error === "string" && data.error) {
    throw new Error(`${operation}: ${data.error}`);
  }
  return data;
}

export async function recordLinearAssetRoute(input: {
  assetId: string;
  routeCode: string;
  measureUnit: LinearRouteOption["measure_unit"];
  startMeasure: number;
  endMeasure: number;
  description: string;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  return requireRpcResult(
    "Could not record linear route",
    await supabase.rpc("record_linear_asset_route", {
      p_asset_id: input.assetId,
      p_route_code: input.routeCode,
      p_measure_unit: input.measureUnit,
      p_start_measure: input.startMeasure,
      p_end_measure: input.endMeasure,
      p_description: input.description,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    }),
  );
}

export async function recordLinearSegment(input: {
  routeId: number;
  fromMeasure: number;
  toMeasure: number;
  attributes: Record<string, string>;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  return requireRpcResult(
    "Could not record linear section",
    await supabase.rpc("record_linear_segment", {
      p_route_id: input.routeId,
      p_from_measure: input.fromMeasure,
      p_to_measure: input.toMeasure,
      p_attributes: input.attributes,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    }),
  );
}

export async function recordLinearDefect(input: {
  routeId: number;
  atMeasure: number;
  defectType: string;
  severity: "minor" | "moderate" | "major" | "critical" | null;
  detectionMethod: string;
  detectedAt: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  return requireRpcResult(
    "Could not record linear defect",
    await supabase.rpc("record_linear_defect", {
      p_route_id: input.routeId,
      p_at_measure: input.atMeasure,
      p_defect_type: input.defectType,
      p_severity: input.severity,
      p_detection_method: input.detectionMethod,
      p_detected_at: input.detectedAt
        ? new Date(input.detectedAt).toISOString()
        : null,
      p_evidence_item_id: input.evidenceItemId,
    }),
  );
}

import { supabase } from "../lib/supabase";

export interface ProductionPlanLineInput {
  assetId: string;
  plannedQuantity: number;
  unitOfMeasure: string;
  windowStart: string;
  windowEnd: string;
  sourceExternalId?: string | null;
  material?: string | null;
  plant?: string | null;
}

export interface ProductionPlanLineView {
  lineNo: number;
  assetId: string;
  assetName: string | null;
  assetTag: string | null;
  plannedQuantity: number;
  unitOfMeasure: string;
  windowStart: string;
  windowEnd: string;
  sourceExternalId: string | null;
  material: string | null;
  plant: string | null;
}

export interface ForecastLineView {
  lineNo: number;
  assetId: string;
  assetName: string | null;
  assetTag: string | null;
  plannedQuantity: number;
  unitOfMeasure: string;
  windowStart: string;
  windowEnd: string;
  status: "forecast" | "not_assessable";
  refusal: string | null;
  stateCoveragePct: number | null;
  demonstratedRate: number | null;
  unplannedShare: number | null;
  expectedUnitsAtRisk: number | null;
  expectedAttainableUnits: number | null;
  historicalEventLossP50: number | null;
  historicalEventLossP80: number | null;
  percentileSample: number;
  productionRecordCount: number;
  unplannedEvents: number;
}

export interface UnitForecastView {
  unitOfMeasure: string;
  forecastedLines: number;
  refusedLines: number;
  plannedQuantityForecast: number | null;
  expectedUnitsAtRisk: number | null;
  complete: boolean;
}

export interface ForecastReviewView {
  reviewId: string;
  note: string;
  reviewedAt: string;
  reviewedBy: string;
}

export interface ForecastVerificationView {
  verificationId: string;
  verifiedAt: string;
  verifiedBy: string;
  comparison: Record<string, unknown>;
}

export interface ProductionPlanForecastView {
  forecastId: string;
  generatedAt: string;
  generatedBy: string;
  historyDays: number;
  frozenVerificationState: "counterfactual";
  verificationState: "counterfactual" | "verified";
  planStatus: "forecast" | "partial" | "not_assessable";
  byUnit: UnitForecastView[];
  lines: ForecastLineView[];
  basis: string;
  authority: string;
  rollupBasis: string;
  reviews: ForecastReviewView[];
  verification: ForecastVerificationView | null;
}

export interface ProductionPlanView {
  planId: string;
  planKey: string;
  title: string;
  sourceKind: "human_record" | "sap_s4_planned_order";
  sourceSystem: string;
  payloadSha256: string | null;
  basis: string;
  siteId: string | null;
  recordedAt: string;
  supersedesPlanId: string | null;
  superseded: boolean;
  lines: ProductionPlanLineView[];
  forecast: ProductionPlanForecastView | null;
}

export interface ProductionPlanLossPayload {
  plans: ProductionPlanView[];
  basis: string;
  authority: string;
}

type RpcPayload = Record<string, unknown> & { error?: string };

async function governedRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcPayload> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload | null;
  if (!payload)
    throw new Error("Production-plan forecast returned no response.");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function getProductionPlanLossForecast(): Promise<ProductionPlanLossPayload> {
  return (await governedRpc(
    "get_production_plan_loss_forecast",
    {},
  )) as unknown as ProductionPlanLossPayload;
}

export async function recordProductionPlan(input: {
  planKey: string;
  title: string;
  siteId?: string | null;
  sourceKind: "human_record" | "sap_s4_planned_order";
  payloadSha256?: string | null;
  basis: string;
  lines: ProductionPlanLineInput[];
  supersedesPlanId?: string | null;
}): Promise<RpcPayload> {
  return governedRpc("record_production_plan", {
    p_plan_key: input.planKey,
    p_title: input.title,
    p_site_id: input.siteId ?? null,
    p_source_kind: input.sourceKind,
    p_payload_sha256: input.payloadSha256 ?? null,
    p_basis: input.basis,
    p_lines: input.lines,
    p_supersedes_plan_id: input.supersedesPlanId ?? null,
  });
}

export async function forecastProductionPlanLoss(
  planId: string,
  historyDays = 180,
): Promise<RpcPayload> {
  return governedRpc("forecast_production_plan_loss", {
    p_plan_id: planId,
    p_history_days: historyDays,
  });
}

export async function reviewProductionPlanForecast(
  forecastId: string,
  note: string,
): Promise<RpcPayload> {
  return governedRpc("review_production_plan_forecast", {
    p_forecast_id: forecastId,
    p_note: note,
  });
}

export async function verifyProductionPlanForecast(
  forecastId: string,
): Promise<RpcPayload> {
  return governedRpc("verify_production_plan_forecast", {
    p_forecast_id: forecastId,
  });
}

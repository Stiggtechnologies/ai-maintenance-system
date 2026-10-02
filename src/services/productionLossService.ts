import { supabase } from "../lib/supabase";

export const DOWNTIME_CLASSIFICATIONS = [
  ["equipment_failure", "Equipment failure"],
  ["planned_maintenance", "Planned maintenance"],
  ["process_upset", "Process upset"],
  ["upstream_constraint", "Upstream constraint"],
  ["downstream_constraint", "Downstream constraint"],
  ["utility_constraint", "Utility constraint"],
  ["material_constraint", "Material constraint"],
  ["workforce_constraint", "Workforce constraint"],
  ["quality_hold", "Quality hold"],
  ["weather", "Weather"],
  ["regulatory", "Regulatory"],
  ["other", "Other"],
  ["unknown", "Unknown — evidence incomplete"],
] as const;

export type DowntimeClassification =
  (typeof DOWNTIME_CLASSIFICATIONS)[number][0];

export const CONSTRAINT_CLASSIFICATIONS = new Set<DowntimeClassification>([
  "upstream_constraint",
  "downstream_constraint",
  "utility_constraint",
  "material_constraint",
  "workforce_constraint",
  "quality_hold",
  "weather",
  "regulatory",
]);

export interface ProductionLossEvent {
  operatingStateId: number;
  assetId: string;
  assetTag: string | null;
  asset: string;
  state: "down_planned" | "down_unplanned" | "offline";
  reasonCode: string | null;
  sourceSystem: string | null;
  externalId: string | null;
  startedAt: string;
  endedAt: string | null;
  downHours: number;
  classification: DowntimeClassification | "unclassified";
  classificationBasis: string | null;
  classificationReviewId: number | null;
  supersedesId: number | null;
  classifiedAt: string | null;
  classifiedBy: string | null;
  workOrder: string | null;
  workOrderId: string | null;
  candidateWorkOrders: Array<{
    id: string;
    woNumber: string | null;
    title: string;
    status: string | null;
  }>;
  constraintSignalId: string | null;
  constraintKind: string | null;
  constraintKey: string | null;
  constraintState: string | null;
  constraintValidUntil: string | null;
  constraintBasis: string | null;
  measurementState: "demonstrated_rate" | "not_measurable";
  measurementRefusal: string | null;
  demonstratedRate: number | null;
  runningHours: number | null;
  productionUnits: number | null;
  productionRecordCount: number | null;
  unitOfMeasure: string | null;
  estimatedUnitsLost: number | null;
}

export interface ProductionConstraint {
  id: string;
  kind: string;
  key: string;
  state: "available" | "unavailable" | "unknown";
  assetId: string | null;
  siteId: string | null;
  observedAt: string;
  validUntil: string;
  current: boolean;
  sourceSystem: string;
  sourceRef: string | null;
  basis: string;
}

export interface ProductionLossPayload {
  windowDays: number;
  summary: {
    downEvents: number;
    downHours: number;
    classifiedHours: number;
    unclassifiedDownHours: number;
    classificationCoveragePct: number | null;
    measurableEvents: number;
    lossByUnit: Array<{
      unitOfMeasure: string;
      events: number;
      estimatedUnitsLost: number;
    }>;
  };
  events: ProductionLossEvent[];
  eventsReturned: number;
  eventsTruncated: boolean;
  categories: Array<{
    classification: DowntimeClassification | "unclassified";
    events: number;
    downHours: number;
    sharePct: number;
  }>;
  constraints: ProductionConstraint[];
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
    throw new Error("Production-loss service returned no response.");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function getProductionLossReconciliation(
  windowDays = 90,
): Promise<ProductionLossPayload> {
  return (await governedRpc("get_production_loss_reconciliation", {
    p_window_days: windowDays,
  })) as unknown as ProductionLossPayload;
}

export async function classifyDowntimeEvent(input: {
  operatingStateId: number;
  classification: DowntimeClassification;
  basis: string;
  expectedReviewId?: number | null;
  constraintSignalId?: string | null;
  workOrderId?: string | null;
}): Promise<RpcPayload> {
  return governedRpc("classify_downtime_event", {
    p_operating_state_id: input.operatingStateId,
    p_classification: input.classification,
    p_basis: input.basis,
    p_expected_review_id: input.expectedReviewId ?? null,
    p_work_order_id: input.workOrderId ?? null,
    p_constraint_signal_id: input.constraintSignalId ?? null,
  });
}

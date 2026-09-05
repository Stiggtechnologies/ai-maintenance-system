import { supabase } from "../lib/supabase";
import type {
  QualityMetricValue,
  QualityCostOfQuality,
} from "../lib/quality-management";

export interface QualityNcrRow {
  id: number;
  ncr_ref: string;
  title: string;
  severity: "minor" | "major" | "critical";
  status: string;
  detected_at: string;
  due_at: string;
  ageDays: number;
  overdue: boolean;
}

export interface QualityRequirementRow {
  id: number;
  requirement_ref: string;
  title: string;
  status: "draft" | "approved" | "superseded";
  severity: "minor" | "major" | "critical";
}

export interface QualityItpRow {
  id: number;
  itp_ref: string;
  title: string;
  revision: string;
  status: string;
}

export interface QualityItpPointRow {
  id: number;
  itp_id: number;
  sequence_no: number;
  control_type: "review" | "witness" | "hold";
  activity: string;
  status: string;
}

export interface QualityLedgerRow {
  id: number;
  [key: string]: unknown;
}

export interface QualityCockpit {
  metrics: QualityMetricValue[];
  ncrAging: {
    open: number;
    overdue: number;
    averageOpenAgeDays: number | null;
    oldestOpenAgeDays: number | null;
  };
  costByCurrency: QualityCostOfQuality[];
  requirements: QualityRequirementRow[];
  itps: QualityItpRow[];
  itpPoints: QualityItpPointRow[];
  ncrs: QualityNcrRow[];
  defects: QualityLedgerRow[];
  rework: QualityLedgerRow[];
  acceptanceTests: QualityLedgerRow[];
  basis: string;
}

export type QualityAction =
  | "record_requirement"
  | "approve_requirement"
  | "record_itp"
  | "approve_itp"
  | "inspect_itp_point"
  | "release_itp_point"
  | "open_ncr"
  | "transition_ncr"
  | "record_defect"
  | "record_rework"
  | "record_acceptance_test"
  | "release_acceptance_test"
  | "record_cost";

export async function getQualityCockpit(
  from: string | null = null,
  to: string | null = null,
): Promise<QualityCockpit> {
  const { data, error } = await supabase.rpc("get_quality_cockpit", {
    p_from: from,
    p_to: to,
  });
  if (error)
    throw new Error(`Could not load quality cockpit: ${error.message}`);
  const payload = data as (QualityCockpit & { error?: string }) | null;
  if (!payload) throw new Error("Could not load quality cockpit: no response");
  if (payload.error)
    throw new Error(`Could not load quality cockpit: ${payload.error}`);
  return payload;
}

async function rpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`Quality action failed: ${error.message}`);
  const payload = data as (Record<string, unknown> & { error?: string }) | null;
  if (!payload) throw new Error("Quality action failed: no response");
  if (payload.error) throw new Error(`Quality action failed: ${payload.error}`);
  return payload;
}

function requiredNumber(payload: Record<string, unknown>, key: string): number {
  const value = Number(payload[key]);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${key} must be a positive integer.`);
  return value;
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} is required.`);
  return value.trim();
}

export async function executeQualityAction(
  action: QualityAction,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (action) {
    case "record_requirement":
      return rpc("record_quality_requirement", { p_record: payload });
    case "approve_requirement":
      return rpc("approve_quality_requirement", {
        p_id: requiredNumber(payload, "id"),
        p_note: requiredString(payload, "note"),
      });
    case "record_itp":
      return rpc("record_quality_itp", { p_record: payload });
    case "approve_itp":
      return rpc("approve_quality_itp", {
        p_id: requiredNumber(payload, "id"),
        p_note: requiredString(payload, "note"),
      });
    case "inspect_itp_point":
      return rpc("record_quality_itp_point_result", {
        p_point_id: requiredNumber(payload, "pointId"),
        p_result: requiredString(payload, "result"),
        p_evidence_item_id: requiredString(payload, "evidenceItemId"),
        p_note: requiredString(payload, "note"),
      });
    case "release_itp_point":
      return rpc("release_quality_itp_point", {
        p_point_id: requiredNumber(payload, "pointId"),
        p_decision: requiredString(payload, "decision"),
        p_witness_attested: Boolean(payload.witnessAttested),
        p_note: requiredString(payload, "note"),
      });
    case "open_ncr":
      return rpc("record_quality_ncr", { p_record: payload });
    case "transition_ncr": {
      const detail = payload.detail;
      if (!detail || typeof detail !== "object" || Array.isArray(detail))
        throw new Error("detail must be an object.");
      return rpc("transition_quality_ncr", {
        p_id: requiredNumber(payload, "id"),
        p_transition: requiredString(payload, "transition"),
        p_detail: detail,
      });
    }
    case "record_defect":
      return rpc("record_quality_defect", { p_record: payload });
    case "record_rework":
      return rpc("record_quality_rework", { p_record: payload });
    case "record_acceptance_test":
      return rpc("record_quality_acceptance_test", { p_record: payload });
    case "release_acceptance_test":
      return rpc("release_quality_acceptance_test", {
        p_id: requiredNumber(payload, "id"),
        p_decision: requiredString(payload, "decision"),
        p_note: requiredString(payload, "note"),
      });
    case "record_cost":
      return rpc("record_quality_cost", { p_record: payload });
  }
}

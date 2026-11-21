import { supabase } from "../lib/supabase";

export interface ScheduleFreezeCheck {
  constraint: string;
  severity: string;
  passed: boolean | null;
  detail: string;
}

export interface ScheduleFreezeReceipt {
  audit_id: string;
  event_time: string;
  actor: string;
  option_id: string;
  week_start: string;
  label: string;
  actor_role: string;
  warnings_acknowledged: number;
  acknowledgement_supplied: boolean;
  feasibility_sha256: string;
  checks: ScheduleFreezeCheck[];
  boundary: string;
}

export interface ScheduleFreezeReceipts {
  organization_id: string;
  receipt_count: number;
  truncated: boolean;
  receipts: ScheduleFreezeReceipt[];
  boundary: string;
}

export async function getScheduleFreezeReceipts(): Promise<ScheduleFreezeReceipts> {
  const { data, error } = await supabase.rpc("get_schedule_freeze_receipts");
  if (error) throw new Error(error.message);
  const payload = data as (ScheduleFreezeReceipts & { error?: string }) | null;
  if (!payload)
    throw new Error("Schedule freeze receipts returned no payload.");
  if (payload.error) throw new Error(payload.error);
  return {
    organization_id: payload.organization_id,
    receipt_count: payload.receipt_count ?? 0,
    truncated: payload.truncated === true,
    receipts: payload.receipts ?? [],
    boundary:
      payload.boundary ?? "These receipts record weekly freezes already taken.",
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "../lib/supabase";

export type ShiftHandoverSite = { id: string; name: string };

export type ShiftHandoverPack = {
  id: string;
  siteId: string;
  siteName: string;
  agentRunId: string;
  windowStart: string;
  windowEnd: string;
  outgoingShiftLabel: string;
  incomingShiftLabel: string;
  sourceSnapshot: {
    asOf: string;
    workOrders: unknown[];
    processEvents: unknown[];
    equipmentCustody: unknown[];
    materialShortages: unknown[];
    recoveryBlockers: unknown[];
    operatorRounds: unknown[];
    dailyCoordination: unknown | null;
  };
  sourceFreshness: Record<
    string,
    | { count?: number; latestAt?: string | null; present?: boolean }
    | string
    | number
  >;
  limitations: string[];
  status: "draft" | "acknowledged";
  createdBy: string;
  createdAt: string;
  acknowledgedBy?: string | null;
  acknowledgedRole?: string | null;
  acknowledgedAt?: string | null;
  acknowledgementNote?: string | null;
};

export type SiteManagerRunResult = {
  pack_id?: string;
  run_id?: string;
  status?: string;
  error?: string;
};

export async function getShiftHandoverSites(): Promise<ShiftHandoverSite[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id,name")
    .order("name")
    .limit(100)
    .returns<ShiftHandoverSite[]>();
  if (error) throw new Error(`Could not load sites: ${error.message}`);
  return data ?? [];
}

export async function getShiftHandoverPacks(
  siteId?: string | null,
): Promise<ShiftHandoverPack[]> {
  const { data, error } = await (supabase as any).rpc(
    "get_shift_handover_packs",
    { p_site_id: siteId ?? null, p_limit: 20 },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as ShiftHandoverPack[];
}

export async function runSiteMaintenanceManager(input: {
  siteId: string;
  windowHours: number;
  outgoingShiftLabel: string;
  incomingShiftLabel: string;
}): Promise<SiteManagerRunResult> {
  const { data, error } = await (supabase as any).rpc(
    "run_site_maintenance_manager_agent",
    {
      p_site_id: input.siteId,
      p_window_hours: input.windowHours,
      p_outgoing_shift_label: input.outgoingShiftLabel,
      p_incoming_shift_label: input.incomingShiftLabel,
    },
  );
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as SiteManagerRunResult;
  if (result.error) throw new Error(result.error);
  return result;
}

export async function acknowledgeShiftHandoverPack(
  packId: string,
  note: string,
): Promise<void> {
  const { data, error } = await (supabase as any).rpc(
    "acknowledge_shift_handover_pack",
    { p_pack_id: packId, p_note: note },
  );
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

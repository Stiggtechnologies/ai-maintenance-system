/**
 * E3.03 callers. Counts are computed in the database from operating_states
 * and process_events. This module does not invent load, cycles, or excursions.
 */
import { supabase } from "../lib/supabase";

export interface DutyStateLoad {
  state: string;
  hours: number;
  load_known_hours: number;
  load_unknown_hours: number;
  load_pct_time_weighted: number | null;
}

export interface OperatingDutyPicture {
  asset_id: string;
  window_days: number;
  window_from: string;
  window_to: string;
  starts: number;
  stops: number;
  cycles_completed: number;
  running_open: number;
  source_start_events: number;
  source_stop_events: number;
  excursions: number;
  trips: number;
  alarms: number;
  interlocks: number;
  states: DutyStateLoad[];
  hours_covered: number;
  coverage_pct: number;
  source_digest: string;
  basis: string;
  condition_alerts_consulted: boolean;
}

export interface OperatingDutyReading extends OperatingDutyPicture {
  id: number;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

export interface RecordedOperatingDuty {
  reading: OperatingDutyReading;
  replayed: boolean;
}

async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (data == null || typeof data !== "object") {
    throw new Error(`${name} returned nothing`);
  }
  return data as T;
}

export async function previewOperatingDuty(
  assetId: string,
  windowDays: number,
): Promise<OperatingDutyPicture> {
  return callRpc<OperatingDutyPicture>("preview_operating_duty", {
    p_asset_id: assetId,
    p_window_days: windowDays,
  });
}

export async function recordOperatingDutyReading(
  assetId: string,
  windowDays: number,
  note: string,
): Promise<RecordedOperatingDuty> {
  return callRpc<RecordedOperatingDuty>("record_operating_duty_reading", {
    p_asset_id: assetId,
    p_window_days: windowDays,
    p_note: note.trim() ? note.trim() : null,
  });
}

export async function getOperatingDutyReadings(
  assetId: string,
): Promise<OperatingDutyReading[]> {
  const body = await callRpc<{ readings: OperatingDutyReading[] }>(
    "get_operating_duty_readings",
    { p_asset_id: assetId, p_limit: 10 },
  );
  return body.readings ?? [];
}

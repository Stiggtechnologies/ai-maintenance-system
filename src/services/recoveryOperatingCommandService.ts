import { supabase } from "../lib/supabase";

export const RECOVERY_OPERATING_MODES = [
  "normal",
  "elevated_risk",
  "emergency_response",
  "business_continuity",
  "damage_assessment",
  "restoration",
  "recovery",
  "post_event_learning",
] as const;
export type RecoveryOperatingMode = (typeof RECOVERY_OPERATING_MODES)[number];
export interface ModeTransition {
  id: string;
  from_mode: RecoveryOperatingMode;
  to_mode: RecoveryOperatingMode;
  status: "pending" | "authorized" | "rejected";
  basis: string;
  missing_evidence: string[];
  requested_at: string;
  review_note: string | null;
}
export interface OperatingCommand {
  id: string;
  command_ref: string;
  current_mode: RecoveryOperatingMode;
  asset_name: string | null;
  site_name: string | null;
  event_code: string | null;
  mode_started_at: string;
  transitions: ModeTransition[];
}
export interface OperatingCommandWorkspace {
  modes: RecoveryOperatingMode[];
  commands: OperatingCommand[];
  authority_boundary: string;
}
function checked<T>(data: unknown): T {
  const value = data as { error?: string };
  if (value?.error) throw new Error(value.error);
  return value as T;
}
async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return checked<T>(data);
}
export const getOperatingCommandWorkspace = () =>
  rpc<OperatingCommandWorkspace>("get_recovery_operating_command_workspace");
export const createOperatingCommand = (command: Record<string, unknown>) =>
  rpc<{ command_id: string }>("create_recovery_operating_command", {
    p_command: command,
  });
export const requestOperatingMode = (
  commandId: string,
  toMode: RecoveryOperatingMode,
  basis: string,
  evidenceItemIds: string[],
  missingEvidence: string[],
) =>
  rpc("request_recovery_operating_mode", {
    p_command_id: commandId,
    p_to_mode: toMode,
    p_basis: basis,
    p_evidence_item_ids: evidenceItemIds,
    p_missing_evidence: missingEvidence,
  });
export const reviewOperatingMode = (
  transitionId: string,
  decision: "authorize" | "reject",
  note: string,
) =>
  rpc("review_recovery_operating_mode", {
    p_transition_id: transitionId,
    p_decision: decision,
    p_note: note,
  });

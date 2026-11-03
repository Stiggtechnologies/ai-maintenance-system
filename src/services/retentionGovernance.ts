/**
 * Customer write path for E4.08 records retention.
 *
 * The catalogue and the position report already existed. These three calls
 * are the operator's legal determination, the legal hold, and the review.
 * Each one is refused in the database for an AI identity, another tenant,
 * or a missing name. None of them deletes an operating record.
 */
import { supabase } from "../lib/supabase";

export interface RetentionCommandResult {
  outcome: string;
  policy_id?: string;
  record_class?: string;
  retain_years?: number;
  status?: string;
  legal_hold?: boolean;
  last_review_at?: string | null;
  replayed?: boolean;
}

interface RpcErrorShape {
  error?: unknown;
}

async function callRetention<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcErrorShape) | null;
  if (body && typeof body.error === "string" && body.error.length > 0) {
    throw new Error(body.error);
  }
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

function commandId(supplied?: string): string {
  return supplied ?? crypto.randomUUID();
}

export function adoptRetentionPolicy(input: {
  policyId: string;
  retainYears: number;
  basis: string;
  commandId?: string;
}): Promise<RetentionCommandResult> {
  return callRetention<RetentionCommandResult>("adopt_retention_policy", {
    p_policy_id: input.policyId,
    p_retain_years: input.retainYears,
    p_basis: input.basis,
    p_command_id: commandId(input.commandId),
  });
}

export function setRetentionLegalHold(input: {
  policyId: string;
  hold: boolean;
  reason: string;
  commandId?: string;
}): Promise<RetentionCommandResult> {
  return callRetention<RetentionCommandResult>("set_retention_legal_hold", {
    p_policy_id: input.policyId,
    p_hold: input.hold,
    p_reason: input.reason,
    p_command_id: commandId(input.commandId),
  });
}

export function recordRetentionReview(input: {
  policyId: string;
  note: string;
  commandId?: string;
}): Promise<RetentionCommandResult> {
  return callRetention<RetentionCommandResult>("record_retention_review", {
    p_policy_id: input.policyId,
    p_note: input.note,
    p_command_id: commandId(input.commandId),
  });
}

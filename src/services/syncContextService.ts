import { supabase } from "../lib/supabase";
import {
  CONTEXT_SOURCE_CLASSES,
  enforceAdapterSourceSupport,
  parseSyncContextSnapshot,
  type ContextSourceAdapter,
  type SyncContextSnapshot,
} from "../lib/sync-context/contracts";

export async function getSyncContextSnapshot(): Promise<SyncContextSnapshot> {
  const { data, error } = await supabase.rpc("get_sync_context_snapshot");
  if (error) throw new Error("Sync Context is temporarily unavailable.");
  return enforceAdapterSourceSupport(
    CONTEXT_SOURCE_CLASSES,
    parseSyncContextSnapshot(data),
  );
}

function checked(data: unknown): Record<string, unknown> {
  const result = data as Record<string, unknown> & { error?: string };
  if (result?.error)
    throw new Error(
      "The Sync Context request was refused by server governance.",
    );
  return result;
}

export async function registerContextSource(input: {
  connectorId: string;
  sourceClass:
    "live_external" | "simulated_industrial" | "customer_operational";
  authority: "context_only" | "tenant_authorized" | "source_asserted";
  purpose: string;
  rightsState: string;
  rightsReference?: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc("register_context_source", {
    p_connector_id: input.connectorId,
    p_source_class: input.sourceClass,
    p_authority: input.authority,
    p_purpose: input.purpose,
    p_rights_state: input.rightsState,
    p_rights_reference: input.rightsReference ?? null,
    p_basis: input.basis,
  });
  if (error) throw new Error("Unable to register the Context source.");
  return checked(data);
}

export async function recordContextSourceHealth(input: {
  connectorId: string;
  state: string;
  checkedAt: string;
  observedAt?: string;
  detail?: string;
}) {
  const { data, error } = await supabase.rpc("record_context_source_health", {
    p_connector_id: input.connectorId,
    p_state: input.state,
    p_checked_at: input.checkedAt,
    p_observed_at: input.observedAt ?? null,
    p_detail: input.detail ?? null,
  });
  if (error) throw new Error("Unable to record source health.");
  return checked(data);
}

export async function transitionContextSourceRights(input: {
  connectorId: string;
  rightsState: "blocked" | "expired";
  rightsReference: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc(
    "transition_context_source_rights",
    {
      p_connector_id: input.connectorId,
      p_rights_state: input.rightsState,
      p_rights_reference: input.rightsReference,
      p_basis: input.basis,
    },
  );
  if (error) throw new Error("Unable to change source rights.");
  return checked(data);
}

export const canonicalSyncContextAdapter: ContextSourceAdapter = {
  adapterKey: "canonical_sync_context_projection",
  supportedSourceClasses: CONTEXT_SOURCE_CLASSES,
  readSnapshot: getSyncContextSnapshot,
};

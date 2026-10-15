import { supabase } from "../lib/supabase";
import {
  CONTEXT_SOURCE_CLASSES,
  enforceAdapterSourceSupport,
  parseSyncContextSnapshot,
  type ContextSourceAdapter,
  type SyncContextSnapshot,
} from "../lib/sync-context/contracts";
import {
  parseSyncContextOperatingPicture,
  type SyncContextOperatingPicture,
} from "../lib/sync-context/operating-picture";
import {
  parseSyncContextSourceInventory,
  type SyncContextSourceInventory,
} from "../lib/sync-context/source-inventory";

/** Organization metadata only. Never substitutes for a scoped operating read. */
export async function getSyncContextSourceInventory(): Promise<SyncContextSourceInventory> {
  const { data, error } = await supabase.rpc("get_sync_context_source_inventory");
  if (error) throw new Error("Sync Context source inventory is temporarily unavailable.");
  checked(data);
  return parseSyncContextSourceInventory(data);
}

export interface SyncContextOperatingScope {
  siteId?: string | null;
  objectLimit?: number;
  eventLimit?: number;
}

/** No legacy fallback, client-side scope inference, direct table read or mutation. */
export async function getSyncContextOperatingPicture(
  input: SyncContextOperatingScope = {},
): Promise<SyncContextOperatingPicture> {
  const siteId =
    input.siteId === undefined || input.siteId === null ? null : input.siteId;
  const objectLimit = input.objectLimit === undefined ? 250 : input.objectLimit;
  const eventLimit = input.eventLimit === undefined ? 250 : input.eventLimit;
  if (
    (siteId !== null &&
      (typeof siteId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          siteId,
        ))) ||
    !Number.isSafeInteger(objectLimit) ||
    objectLimit < 1 ||
    objectLimit > 500 ||
    !Number.isSafeInteger(eventLimit) ||
    eventLimit < 0 ||
    eventLimit > 500
  )
    throw new Error("Malformed Sync Context operating scope.");
  const { data, error } = await supabase.rpc(
    "get_sync_context_operating_picture",
    {
      p_site_id: siteId,
      p_object_limit: objectLimit,
      p_event_limit: eventLimit,
    },
  );
  if (error) throw new Error("Sync Context is temporarily unavailable.");
  checked(data);
  const picture = parseSyncContextOperatingPicture(data);
  if (
    picture.scope.siteId?.toLowerCase() !== siteId?.toLowerCase() ||
    picture.scope.objectLimit !== objectLimit ||
    picture.scope.eventLimit !== eventLimit
  )
    throw new Error("Sync Context returned a different operating scope.");
  return picture;
}

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

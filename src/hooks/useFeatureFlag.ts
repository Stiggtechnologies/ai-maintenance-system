/**
 * useFeatureFlag — typed read of the tenant-scoped feature_flags table
 * (20260912130000_sync_feature_flags.sql).
 *
 * FAIL CLOSED. A missing row, a query error, or a timeout all read as
 * DISABLED. Feature flags gate capabilities that are not ready for a tenant
 * (spec §39), so the failure mode of the flag system must be "the capability
 * stays off", never "the capability leaks on". `error` is still surfaced
 * separately so a page that wants to distinguish "off" from "unknown" can.
 *
 * Tenancy comes from RLS, not from the client: the query carries no
 * organization filter because feature_flags_org_read already scopes rows to
 * app_current_org(). The hook cannot ask about another tenant's flags.
 */
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "./useAsyncData";

/** The §39 flag catalogue. Extend this union when a new flag is seeded. */
export const SYNC_FEATURE_FLAGS = [
  "sync_global_shell",
  "sync_voice_input",
  "sync_voice_output",
  "sync_agent_routing",
  "sync_tools",
  "sync_meeting_mode",
  "sync_field_mode",
] as const;

export type SyncFeatureFlag = (typeof SYNC_FEATURE_FLAGS)[number];

export interface FeatureFlagState {
  /** True only when a row for this flag exists and enabled = true. */
  enabled: boolean;
  loading: boolean;
  /** Non-null when the read failed; `enabled` is false in that case. */
  error: string | null;
  refetch: () => void;
}

const SYNC_FLAGS_CHANGED_EVENT = "syncai:feature-flags-changed";

/** Tell mounted flag readers that an audited rollout mutation just completed. */
export function announceSyncFeatureFlagsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SYNC_FLAGS_CHANGED_EVENT));
  }
}

/** One-shot read, exported for non-hook callers and for tests. */
export async function fetchFeatureFlag(
  flag: SyncFeatureFlag,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("flag_key", flag)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.enabled === true;
}

export function useFeatureFlag(flag: SyncFeatureFlag): FeatureFlagState {
  const { data, loading, error, refetch } = useAsyncData<boolean>(
    () => fetchFeatureFlag(flag),
    [flag],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => refetch();
    window.addEventListener(SYNC_FLAGS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SYNC_FLAGS_CHANGED_EVENT, refresh);
  }, [refetch]);

  return {
    // Fail closed: only an affirmative true from a successful read enables.
    enabled: data === true && error === null,
    loading,
    error,
    refetch,
  };
}

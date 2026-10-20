import { supabase } from "../lib/supabase";

export interface FailurePathQueryResult {
  rootCanonicalId: string;
  paths: { steps: Record<string, string>[] }[];
  truncated: boolean;
  grantsAuthority: false;
  grantsWorkRelease: false;
  grantsApproval: false;
  decisionBoundary: string;
  error?: string;
}

export async function queryFailureDetectionPaths(
  rootCanonicalId: string,
  maxDepth = 4,
) {
  const { data, error } = await supabase.rpc("query_failure_detection_paths", {
    p_root_canonical_id: rootCanonicalId,
    p_max_depth: maxDepth,
  });
  if (error) throw new Error(error.message);
  const payload = data as FailurePathQueryResult | null;
  if (!payload || payload.error)
    throw new Error(payload?.error ?? "Failure path query returned no result");
  if (
    payload.grantsAuthority !== false ||
    payload.grantsWorkRelease !== false ||
    payload.grantsApproval !== false
  ) {
    throw new Error("A failure path must not grant authority");
  }
  return payload;
}

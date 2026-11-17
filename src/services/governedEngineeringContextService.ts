import { supabase } from "../lib/supabase";
import type { GovernedEngineeringContext } from "../lib/engineering-knowledge/context-package";

export interface GovernedContextRequest {
  claimType: string;
  query?: string | null;
  assetClass?: string | null;
  assetTwinId?: string | null;
  componentCodes?: string[];
  failureModeCodes?: string[];
  physicsCapabilityCodes?: string[];
  retrievedChunkIds?: string[];
  physicsResults?: { capabilityCode: string; resultRef: string }[];
  evidenceIds?: string[];
}

export async function buildGovernedEngineeringContext(
  request: GovernedContextRequest,
) {
  const { data, error } = await supabase.rpc(
    "build_governed_engineering_context",
    {
      p_claim_type: request.claimType,
      p_query: request.query ?? null,
      p_asset_class: request.assetClass ?? null,
      p_asset_twin_id: request.assetTwinId ?? null,
      p_component_codes: request.componentCodes ?? [],
      p_failure_mode_codes: request.failureModeCodes ?? [],
      p_physics_capability_codes: request.physicsCapabilityCodes ?? [],
      p_retrieved_chunk_ids: request.retrievedChunkIds ?? [],
      p_physics_results: request.physicsResults ?? [],
      p_evidence_ids: request.evidenceIds ?? [],
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as
    (GovernedEngineeringContext & { error?: string }) | null;
  if (!payload || payload.error)
    throw new Error(
      payload?.error ?? "Governed context package returned no result",
    );
  if (
    payload.humanApprovalRequired !== true ||
    payload.autonomousOperationalActionAllowed !== false ||
    payload.grantsWorkRelease !== false ||
    payload.grantsApprovalAuthority !== false ||
    payload.grantsApproval !== false
  ) {
    throw new Error(
      "A context package must stay human-approved and must not grant authority",
    );
  }
  return payload;
}

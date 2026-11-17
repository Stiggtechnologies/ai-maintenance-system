import { supabase } from "../lib/supabase";

export type RecommendationAssumptionDisposition =
  "recorded" | "none_identified";

export interface RecommendationAssumptionItem {
  statement: string;
  basis: string;
  consequence_if_wrong: string;
  validation_method: string;
}

export interface RecommendationAssumptionPacket {
  disposition: RecommendationAssumptionDisposition;
  basis: string;
  items: RecommendationAssumptionItem[];
}

export interface RecommendationAssumptionWorkspace {
  recommendationId: string;
  recommendationTitle: string;
  recommendationStatus: string;
  packet: RecommendationAssumptionPacket | null;
  recordedBy: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
  storedContextDigest: string | null;
  currentContextDigest: string;
  valid: boolean;
  boundary: string;
  operationalAuthorization: false;
}

function unwrap<T>(
  data: T | { error?: string } | null,
  error: { message: string } | null,
  fallback: string,
): T {
  if (error) throw new Error(`${fallback}: ${error.message}`);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  if (!data) throw new Error(fallback);
  return data as T;
}

export async function getRecommendationAssumptionPacket(
  recommendationId: string,
): Promise<RecommendationAssumptionWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_recommendation_assumption_packet",
    { p_recommendation_id: recommendationId },
  );
  return unwrap<RecommendationAssumptionWorkspace>(
    data as RecommendationAssumptionWorkspace | { error?: string } | null,
    error,
    "Could not load recommendation assumptions",
  );
}

export async function recordRecommendationAssumptions(input: {
  recommendationId: string;
  packet: RecommendationAssumptionPacket;
  note: string;
}): Promise<{
  recommendationId: string;
  disposition: RecommendationAssumptionDisposition;
  packetSha256: string;
  contextSha256: string;
  recordedBy: string;
  recordedAt: string;
}> {
  const { data, error } = await supabase.rpc(
    "record_recommendation_assumptions",
    {
      p_recommendation_id: input.recommendationId,
      p_packet: input.packet,
      p_note: input.note,
    },
  );
  return unwrap(
    data as
      | {
          recommendationId: string;
          disposition: RecommendationAssumptionDisposition;
          packetSha256: string;
          contextSha256: string;
          recordedBy: string;
          recordedAt: string;
        }
      | { error?: string }
      | null,
    error,
    "Could not record recommendation assumptions",
  );
}

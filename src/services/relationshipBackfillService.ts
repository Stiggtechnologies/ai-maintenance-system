import { supabase } from "../lib/supabase";
import type { RelationshipEdgeInput } from "../lib/engineering-knowledge/relationship-backfill";

export interface RelationshipBackfillResult {
  organizationId: string;
  inserted: number;
  alreadyPresent: number;
  skipped?: number;
  reviewState: "draft";
  grantsAuthority: false;
  grantsWorkRelease: false;
  grantsApproval: false;
  decisionBoundary: string;
}

function readResult(
  data: unknown,
  error: { message: string } | null,
): RelationshipBackfillResult {
  if (error) throw new Error(error.message);
  const payload = data as RelationshipBackfillResult & { error?: string };
  if (!payload || payload.error)
    throw new Error(
      payload?.error ?? "Relationship backfill returned no result",
    );
  if (payload.reviewState !== "draft" || payload.grantsAuthority !== false) {
    throw new Error("Backfill must stay draft and must not grant authority");
  }
  return payload;
}

export async function backfillEngineeringRelationships(
  edges: RelationshipEdgeInput[],
) {
  const { data, error } = await supabase.rpc(
    "backfill_engineering_relationships",
    { p_edges: edges },
  );
  return readResult(data, error);
}

export async function backfillRelationshipsFromKnowledgeChunks() {
  const { data, error } = await supabase.rpc(
    "backfill_relationships_from_knowledge_chunks",
  );
  return readResult(data, error);
}

import { supabase } from "../lib/supabase";

export interface HybridEngineeringHit {
  chunk_id: string;
  title: string;
  content: string;
  documentClass: string;
  trustRank: number;
  isClientPrivate: boolean;
  lexicalRank: number;
  semanticSimilarity: number | null;
  combinedScore: number;
  governedSourceId: string | null;
  matchedCanonicalId: string | null;
}

export async function retrieveEngineeringKnowledgeHybrid(input: {
  claimType: string;
  query?: string;
  queryEmbedding?: number[] | string;
  entityType?: string;
  canonicalId?: string;
  assetClass?: string;
  minimumSemanticScore?: number;
  limit?: number;
}): Promise<HybridEngineeringHit[]> {
  const { data, error } = await supabase.rpc(
    "retrieve_engineering_knowledge_hybrid",
    {
      p_claim_type: input.claimType,
      p_query: input.query ?? null,
      p_query_embedding: input.queryEmbedding ?? null,
      p_entity_type: input.entityType ?? null,
      p_canonical_id: input.canonicalId ?? null,
      p_asset_class: input.assetClass ?? null,
      p_minimum_semantic_score: input.minimumSemanticScore ?? null,
      p_limit: input.limit ?? 8,
    },
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as HybridEngineeringHit[];
}

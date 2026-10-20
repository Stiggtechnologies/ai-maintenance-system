/**
 * Ranking blend shared with `retrieve_engineering_knowledge_hybrid`.
 * 0.55 / 0.45 matches the asset-aware retrieval plan. It is not an engineering limit.
 * Lexical rank is squashed into 0–1 so it can sit beside cosine similarity.
 */
export function combineHybridRetrievalScore(
  semantic: number | null,
  lexicalRank: number,
): number {
  const lexical =
    Number.isFinite(lexicalRank) && lexicalRank > 0
      ? lexicalRank / (lexicalRank + 1)
      : 0;
  if (semantic !== null && Number.isFinite(semantic) && lexicalRank > 0) {
    return semantic * 0.55 + lexical * 0.45;
  }
  if (semantic !== null && Number.isFinite(semantic)) return semantic;
  return lexical;
}

export interface HybridMetadataFilter {
  entityType?: string;
  canonicalId?: string;
  assetClass?: string;
}

export interface HybridFilterCandidate {
  entityType: string;
  canonicalId: string;
  assetClass?: string | null;
  reviewState: string;
  sourceReviewState: string;
  superseded: boolean;
}

/** Applicability filter only. It does not decide whether the caller may see the row. */
export function hybridCandidateMatchesFilter(
  candidate: HybridFilterCandidate,
  filter: HybridMetadataFilter,
): boolean {
  const wantsEntity = Boolean(filter.entityType || filter.canonicalId);
  const wantsClass = Boolean(filter.assetClass);
  if (!wantsEntity && !wantsClass) return true;
  if (
    candidate.reviewState !== "approved" ||
    candidate.sourceReviewState !== "approved" ||
    candidate.superseded
  ) {
    return false;
  }
  if (
    wantsEntity &&
    (filter.entityType !== candidate.entityType ||
      filter.canonicalId !== candidate.canonicalId)
  ) {
    if (!(wantsClass && !wantsEntity)) return false;
  }
  if (wantsClass) {
    const classHit =
      candidate.assetClass === filter.assetClass ||
      (candidate.entityType === "asset_class" &&
        candidate.canonicalId === filter.assetClass);
    if (!classHit) return false;
  }
  if (
    wantsEntity &&
    (candidate.entityType !== filter.entityType ||
      candidate.canonicalId !== filter.canonicalId)
  ) {
    return false;
  }
  return true;
}

import {
  isKnowledgeApplicable,
  rankKnowledgeAuthority,
  type EngineeringContextPackage,
  type EngineeringKnowledgeDocumentMetadata,
} from "./ontology";

export interface RetrievalCandidate {
  metadata: EngineeringKnowledgeDocumentMetadata;
  semanticScore: number;
  chunkIds: string[];
}

export interface RetrievalPolicy {
  minimumSemanticScore: number;
  maximumResults: number;
  requireApprovedSources: boolean;
  now?: string;
}

export interface RankedRetrievalCandidate extends RetrievalCandidate {
  authorityScore: number;
  freshnessScore: number;
  combinedScore: number;
  conflictFlags: string[];
}

export interface AssetAwareRetrievalPlan {
  context: EngineeringContextPackage;
  included: RankedRetrievalCandidate[];
  excluded: Array<{ sourceId: string; reasons: string[] }>;
  sourceConflictIds: string[];
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function freshnessScore(
  metadata: EngineeringKnowledgeDocumentMetadata,
  nowIso: string,
): number {
  if (!metadata.effectiveDate) return 0.5;
  const now = new Date(nowIso).getTime();
  const effective = new Date(metadata.effectiveDate).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(effective)) return 0.5;
  const ageYears = Math.max(0, now - effective) / (365.25 * 24 * 60 * 60 * 1000);
  return clamp(1 - ageYears / 20);
}

function findConflictFlags(
  candidate: RetrievalCandidate,
  candidates: RetrievalCandidate[],
): string[] {
  const flags: string[] = [];
  for (const other of candidates) {
    if (other.metadata.sourceId === candidate.metadata.sourceId) continue;
    const sameApplicability =
      other.metadata.assetClassCode === candidate.metadata.assetClassCode &&
      other.metadata.assetTwinId === candidate.metadata.assetTwinId &&
      other.metadata.componentCodes.some((code) =>
        candidate.metadata.componentCodes.includes(code),
      );
    if (!sameApplicability) continue;
    if (
      other.metadata.revision &&
      candidate.metadata.revision &&
      other.metadata.revision !== candidate.metadata.revision
    ) {
      flags.push(`revision_conflict:${other.metadata.sourceId}`);
    }
    if (
      other.metadata.reviewState === "approved" &&
      candidate.metadata.reviewState === "approved" &&
      other.metadata.authorityLevel !== candidate.metadata.authorityLevel
    ) {
      flags.push(`authority_conflict:${other.metadata.sourceId}`);
    }
  }
  return [...new Set(flags)];
}

export function buildAssetAwareRetrievalPlan(
  context: EngineeringContextPackage,
  candidates: RetrievalCandidate[],
  policy: RetrievalPolicy,
): AssetAwareRetrievalPlan {
  if (policy.minimumSemanticScore < 0 || policy.minimumSemanticScore > 1) {
    throw new Error("minimumSemanticScore must be between 0 and 1");
  }
  if (!Number.isInteger(policy.maximumResults) || policy.maximumResults <= 0) {
    throw new Error("maximumResults must be a positive integer");
  }

  const included: RankedRetrievalCandidate[] = [];
  const excluded: Array<{ sourceId: string; reasons: string[] }> = [];
  const nowIso = policy.now ?? new Date().toISOString();

  for (const candidate of candidates) {
    const reasons: string[] = [];
    if (!isKnowledgeApplicable(candidate.metadata, context)) {
      reasons.push("not_applicable_to_engineering_context");
    }
    if (candidate.semanticScore < policy.minimumSemanticScore) {
      reasons.push("semantic_score_below_policy");
    }
    if (candidate.chunkIds.length === 0) {
      reasons.push("missing_retrieval_provenance");
    }
    if (
      policy.requireApprovedSources &&
      candidate.metadata.reviewState !== "approved"
    ) {
      reasons.push("source_not_approved");
    }
    if (candidate.metadata.reviewState === "rejected") {
      reasons.push("source_rejected");
    }
    if (candidate.metadata.reviewState === "superseded") {
      reasons.push("source_superseded");
    }

    if (reasons.length > 0) {
      excluded.push({ sourceId: candidate.metadata.sourceId, reasons });
      continue;
    }

    const authorityScore = rankKnowledgeAuthority(
      candidate.metadata.authorityLevel,
    );
    const freshness = freshnessScore(candidate.metadata, nowIso);
    const conflictFlags = findConflictFlags(candidate, candidates);
    const combinedScore =
      candidate.semanticScore * 0.55 +
      (authorityScore / 100) * 0.35 +
      freshness * 0.1 -
      conflictFlags.length * 0.05;

    included.push({
      ...candidate,
      authorityScore,
      freshnessScore: freshness,
      combinedScore,
      conflictFlags,
    });
  }

  included.sort((a, b) => b.combinedScore - a.combinedScore);
  const limited = included.slice(0, policy.maximumResults);
  const sourceConflictIds = limited
    .filter((candidate) => candidate.conflictFlags.length > 0)
    .map((candidate) => candidate.metadata.sourceId);

  return {
    context,
    included: limited,
    excluded,
    sourceConflictIds,
  };
}

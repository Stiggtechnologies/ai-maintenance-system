import {
  getKnowledgeApplicabilityIssues,
  validateKnowledgeDocumentMetadata,
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
  // Explicit evaluation instant for repeatable filtering. This does NOT
  // reconstruct historical approval, source-access, or asset configuration.
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

/** Date-only UTC or an ISO timestamp with explicit timezone; no local-time guessing. */
function parseEvidenceTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    return NaN;
  }
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return NaN;
  }
  return Date.parse(value);
}

function sourceDateIssues(metadata: EngineeringKnowledgeDocumentMetadata, now: number): string[] {
  const issues: string[] = [];
  const start = metadata.effectiveDate === undefined ? undefined : parseEvidenceTime(metadata.effectiveDate);
  const end = metadata.supersededDate === undefined ? undefined : parseEvidenceTime(metadata.supersededDate);
  if (start !== undefined && !Number.isFinite(start)) issues.push("invalid_effective_date");
  if (end !== undefined && !Number.isFinite(end)) issues.push("invalid_superseded_date");
  if (start !== undefined && end !== undefined && end <= start) issues.push("invalid_source_validity_interval");
  if (start !== undefined && now < start) issues.push("source_not_yet_effective");
  if (end !== undefined && now >= end) issues.push("source_superseded_by_date");
  return issues;
}

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
  if (!Number.isFinite(policy.minimumSemanticScore) || policy.minimumSemanticScore < 0 || policy.minimumSemanticScore > 1) {
    throw new Error("minimumSemanticScore must be between 0 and 1");
  }
  if (!Number.isInteger(policy.maximumResults) || policy.maximumResults <= 0) {
    throw new Error("maximumResults must be a positive integer");
  }

  const eligible: RetrievalCandidate[] = [];
  const included: RankedRetrievalCandidate[] = [];
  const excluded: Array<{ sourceId: string; reasons: string[] }> = [];
  const nowIso = policy.now ?? new Date().toISOString();
  const now = parseEvidenceTime(nowIso);
  if (!Number.isFinite(now)) throw new Error("now must be a valid ISO date or timezone-qualified timestamp");

  for (const candidate of candidates) {
    const reasons: string[] = [];
    const applicabilityIssues = getKnowledgeApplicabilityIssues(candidate.metadata, context);
    if (applicabilityIssues.length > 0) {
      reasons.push("not_applicable_to_engineering_context", ...applicabilityIssues);
    }
    for (const issue of validateKnowledgeDocumentMetadata(candidate.metadata)) {
      reasons.push(`invalid_source_metadata:${issue.path}`);
    }
    reasons.push(...sourceDateIssues(candidate.metadata, now));
    if (!Number.isFinite(candidate.semanticScore) || candidate.semanticScore < 0 || candidate.semanticScore > 1) {
      reasons.push("invalid_semantic_score");
    }
    if (!Number.isFinite(rankKnowledgeAuthority(candidate.metadata.authorityLevel))) {
      reasons.push("invalid_authority_level");
    }
    if (!["draft", "in_review", "approved", "rejected", "superseded"].includes(candidate.metadata.reviewState)) {
      reasons.push("invalid_review_state");
    }
    if (candidate.semanticScore < policy.minimumSemanticScore) {
      reasons.push("semantic_score_below_policy");
    }
    if (candidate.chunkIds.length === 0 || candidate.chunkIds.some((id) => !id.trim())) {
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

    eligible.push(candidate);
  }

  // Never allow excluded/foreign/draft evidence to influence the admitted
  // candidates' ranking or leak its identity through their conflict flags.
  // Exclusion receipts still require server-side access control by the caller.
  for (const candidate of eligible) {
    const authorityScore = rankKnowledgeAuthority(
      candidate.metadata.authorityLevel,
    );
    const freshness = freshnessScore(candidate.metadata, nowIso);
    const conflictFlags = findConflictFlags(candidate, eligible);
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

  included.sort((a, b) => {
    const scoreOrder = b.combinedScore - a.combinedScore;
    if (scoreOrder !== 0) return scoreOrder;
    return a.metadata.sourceId < b.metadata.sourceId ? -1 : a.metadata.sourceId > b.metadata.sourceId ? 1 : 0;
  });
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

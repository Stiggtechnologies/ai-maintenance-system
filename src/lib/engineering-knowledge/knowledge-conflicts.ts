export type KnowledgeConflictKind =
  | "revision_conflict"
  | "authority_conflict"
  | "supersession_gap"
  | "superseded_mapping_still_approved"
  | "successor_not_applied";

export interface KnowledgeConflictSource {
  sourceId: string;
  revision?: string | null;
  authorityLevel: string;
  reviewState: string;
  supersededBySourceId?: string | null;
  mappingReviewState: string;
  replacementReviewState?: string | null;
  replacementInTenant?: boolean;
}

export interface KnowledgeConflictFinding {
  kind: KnowledgeConflictKind;
  sourceIds: string[];
  detail: string;
}

const unique = (ids: string[]) => [...new Set(ids)].sort();

/**
 * Names disagreements. It does not pick a winner or change review state.
 * A null revision is "not stated", not a conflicting value.
 */
export function detectKnowledgeConflicts(
  sources: KnowledgeConflictSource[],
): KnowledgeConflictFinding[] {
  const findings: KnowledgeConflictFinding[] = [];
  const active = sources.filter(
    (source) =>
      source.mappingReviewState === "approved" &&
      source.reviewState === "approved" &&
      !source.supersededBySourceId,
  );
  const revisions = unique(
    active
      .map((source) => source.revision?.trim() ?? "")
      .filter((revision) => revision.length > 0),
  );
  if (revisions.length > 1) {
    findings.push({
      kind: "revision_conflict",
      sourceIds: unique(active.map((source) => source.sourceId)),
      detail:
        "Approved sources name different revisions for the same canonical target.",
    });
  }
  const authorities = unique(active.map((source) => source.authorityLevel));
  if (active.length > 1 && authorities.length > 1) {
    findings.push({
      kind: "authority_conflict",
      sourceIds: unique(active.map((source) => source.sourceId)),
      detail:
        "Approved sources name different authority levels for the same canonical target.",
    });
  }

  const gaps = sources.filter((source) => {
    if (source.reviewState !== "superseded") return false;
    if (!source.supersededBySourceId) return true;
    return (
      source.replacementInTenant === false ||
      source.replacementReviewState !== "approved"
    );
  });
  if (gaps.length > 0) {
    findings.push({
      kind: "supersession_gap",
      sourceIds: unique(gaps.map((source) => source.sourceId)),
      detail: "A superseded source has no approved same-tenant replacement.",
    });
  }

  const stale = sources.filter(
    (source) =>
      source.mappingReviewState === "approved" &&
      (source.reviewState === "superseded" ||
        Boolean(source.supersededBySourceId)),
  );
  if (stale.length > 0) {
    findings.push({
      kind: "superseded_mapping_still_approved",
      sourceIds: unique(stale.map((source) => source.sourceId)),
      detail: "An approved mapping still points at a superseded source.",
    });
  }

  const dangling = sources.filter(
    (source) =>
      Boolean(source.supersededBySourceId) &&
      source.reviewState !== "superseded",
  );
  if (dangling.length > 0) {
    findings.push({
      kind: "successor_not_applied",
      sourceIds: unique(dangling.map((source) => source.sourceId)),
      detail:
        "A source names a replacement but is not itself marked superseded.",
    });
  }
  return findings;
}

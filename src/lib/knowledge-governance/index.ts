/**
 * Knowledge-base governance: what a retrieval was allowed to answer, and why.
 *
 * The permission matrix itself lives in `kb_document_classes` in the database,
 * NOT here. The enforcement point has to be server-side — the copilot retrieves
 * from an edge function, where a browser-side rule enforces nothing — and a
 * matrix written in two languages drifts the first time somebody edits one of
 * them. This module reads the matrix; it never restates it.
 *
 * What it does add is the distinction the database cannot express in a result
 * set: an empty retrieval has three completely different meanings.
 *
 *   absent           — nothing in the corpus matches. The question is open.
 *   refused_by_class — documents matched, and none of them had standing on this
 *                      kind of claim. The corpus knows something adjacent and is
 *                      declining to overreach.
 *   answered         — passages returned.
 *
 * Rendering all three as "no results" is how a brochure ends up sounding like
 * silence, and how silence ends up sounding like a clean bill of health.
 *
 * Pure functions. No database, no network.
 */

export type ClaimType =
  | "analysis_method"
  | "failure_behaviour"
  | "component_structure"
  | "maintenance_task"
  | "nameplate_spec";

export interface RetrievedChunk {
  title: string;
  documentClass: string;
  trustRank: number;
  isClientPrivate: boolean;
  redistributable: boolean;
}

export interface Exclusion {
  documentClass: string;
  label: string;
  chunksMatchedButExcluded: number;
  rationale: string;
}

export type RetrievalVerdict = "answered" | "refused_by_class" | "absent";

export interface RetrievalAssessment {
  verdict: RetrievalVerdict;
  citable: RetrievedChunk[];
  /** Highest trust rank among returned chunks; null when nothing returned. */
  strongestSource: number | null;
  /** True when any returned passage may not be quoted verbatim to a user. */
  containsNonRedistributable: boolean;
  /** True when any returned passage is the client's own material. */
  containsClientPrivate: boolean;
  reason: string;
}

const CLAIM_LABELS: Record<ClaimType, string> = {
  analysis_method: "how to analyse this",
  failure_behaviour: "how this fails",
  component_structure: "what this is made of",
  maintenance_task: "what maintenance this requires",
  nameplate_spec: "its rated figures",
};

export function assessRetrieval(
  chunks: RetrievedChunk[],
  exclusions: Exclusion[],
  claimType: ClaimType,
): RetrievalAssessment {
  const excludedTotal = exclusions.reduce(
    (n, e) => n + e.chunksMatchedButExcluded,
    0,
  );
  const claimLabel = CLAIM_LABELS[claimType] ?? claimType;

  if (chunks.length === 0) {
    if (excludedTotal > 0) {
      const named = exclusions
        .map((e) => `${e.label} (${e.chunksMatchedButExcluded})`)
        .join(", ");
      return {
        verdict: "refused_by_class",
        citable: [],
        strongestSource: null,
        containsNonRedistributable: false,
        containsClientPrivate: false,
        reason:
          `Nothing citable for "${claimLabel}", but the corpus is not silent: ` +
          `${excludedTotal} passage(s) matched and were excluded because their ` +
          `document class has no standing on this kind of claim — ${named}. ` +
          `That is a deliberate refusal, not an absence. ` +
          exclusions[0].rationale,
      };
    }
    return {
      verdict: "absent",
      citable: [],
      strongestSource: null,
      containsNonRedistributable: false,
      containsClientPrivate: false,
      reason: `Nothing in the corpus matches this question about "${claimLabel}". No document was excluded — the corpus simply does not cover it, which is a gap to fill rather than a judgement to trust.`,
    };
  }

  const strongest = Math.max(...chunks.map((c) => c.trustRank));
  const nonRedist = chunks.some((c) => !c.redistributable);
  const clientPrivate = chunks.some((c) => c.isClientPrivate);

  return {
    verdict: "answered",
    citable: [...chunks].sort((a, b) => b.trustRank - a.trustRank),
    strongestSource: strongest,
    containsNonRedistributable: nonRedist,
    containsClientPrivate: clientPrivate,
    reason:
      `${chunks.length} passage(s) with standing on "${claimLabel}".` +
      (excludedTotal > 0
        ? ` A further ${excludedTotal} matched and were excluded for lacking standing on this claim.`
        : "") +
      (clientPrivate
        ? ` Some passages are the client's own material and must not leave their tenant.`
        : "") +
      (nonRedist
        ? ` Some passages are not redistributable — cite and paraphrase them, do not reproduce them verbatim to an end user.`
        : ""),
  };
}

export interface CorpusClassRow {
  documentClass: string;
  label: string;
  trustRank: number;
  permittedClaims: string[];
  redistributable: boolean;
  mayBeGlobal: boolean;
  sharedChunks: number;
  clientChunks: number;
  sources: number;
}

export interface CorpusPosture {
  totalChunks: number;
  sharedChunks: number;
  clientChunks: number;
  /** Chunks that may be stored and cited in support of nothing. */
  unusableChunks: number;
  /** Claim types with no source of standing at all. */
  claimTypesWithNoSource: ClaimType[];
  /** Classes permitted to be global that are also non-redistributable. */
  policyConflicts: string[];
  rows: CorpusClassRow[];
  reason: string;
}

const ALL_CLAIMS: ClaimType[] = [
  "analysis_method",
  "failure_behaviour",
  "component_structure",
  "maintenance_task",
  "nameplate_spec",
];

export function assessCorpus(rows: CorpusClassRow[]): CorpusPosture {
  const shared = rows.reduce((n, r) => n + r.sharedChunks, 0);
  const client = rows.reduce((n, r) => n + r.clientChunks, 0);
  const total = shared + client;

  const unusable = rows
    .filter((r) => r.permittedClaims.length === 0)
    .reduce((n, r) => n + r.sharedChunks + r.clientChunks, 0);

  // A claim type is covered only by a class that both permits it AND holds
  // chunks. A permission with an empty shelf behind it is not coverage.
  const uncovered = ALL_CLAIMS.filter(
    (claim) =>
      !rows.some(
        (r) =>
          r.permittedClaims.includes(claim) &&
          r.sharedChunks + r.clientChunks > 0,
      ),
  );

  // Global AND non-redistributable is contradictory: a document every tenant
  // can retrieve, whose text may not be shown to any of them.
  const conflicts = rows
    .filter((r) => r.mayBeGlobal && !r.redistributable)
    .map((r) => r.label);

  return {
    totalChunks: total,
    sharedChunks: shared,
    clientChunks: client,
    unusableChunks: unusable,
    claimTypesWithNoSource: uncovered,
    policyConflicts: conflicts,
    rows: [...rows].sort((a, b) => b.trustRank - a.trustRank),
    reason:
      total === 0
        ? "The corpus is empty. Retrieval will return nothing for every question, which reads identically to a question the corpus has considered and declined."
        : `${total} chunk(s): ${shared} shared across tenants, ${client} private to this one. ` +
          (unusable > 0
            ? `${unusable} sit in a class with standing on nothing and can be cited in support of no claim — they are stored, not usable. `
            : "") +
          (uncovered.length > 0
            ? `No source of standing for: ${uncovered.map((c) => CLAIM_LABELS[c]).join(", ")}. Questions of that kind will return nothing, and the reason will be an empty shelf rather than a considered refusal. `
            : `Every claim type has at least one source of standing. `) +
          (conflicts.length > 0
            ? `POLICY CONFLICT: ${conflicts.join(", ")} may be placed in the shared corpus but may not be redistributed — every tenant can retrieve text none of them may be shown.`
            : ""),
  };
}

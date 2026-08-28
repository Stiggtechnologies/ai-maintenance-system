/**
 * Sync Develop — Evidence/Gap agent core (D12.07, spec §57 + §70).
 *
 * The deterministic half of the evidence agent, shared by the
 * develop-evidence-agent edge function and unit-tested by vitest (the
 * llm-provider precedent: the exact file that deploys to the edge runtime is
 * the file the tests exercise — DELIBERATELY DENO-FREE).
 *
 * WHAT THIS MODULE DECIDES, AND WHAT IT NEVER DECIDES.
 *
 * It matches recorded evidence_items and deliverables to a gate criterion by
 * term overlap and states the honest verdict, including the first-class
 * no-evidence answer — "no evidence found for this requirement" IS the
 * product ("14 requirements have no verification method" is the spec's own
 * example). The LLM, when a provider is configured, only narrates over these
 * deterministic matches; when none is configured, the gap analysis stands on
 * its own and says so.
 *
 * §70 IS ABSOLUTE AND STRUCTURAL: nothing here (or in the edge function)
 * writes a criterion status, a finding, a review, or a readiness input. The
 * output is advisory; the readiness calculation (get_gate_readiness)
 * consumes ONLY review findings, so this agent's output cannot move a
 * percentage, flip a blocker, or satisfy anything. Its only optional write —
 * performed by the edge function, never by this module — is an
 * evidence_items row born evidence_class='AI_INFERENCE', which the D11.18
 * guards keep out of 'verified' until a human acts.
 */

export interface AgentEvidenceRow {
  id: string;
  evidenceClass: string | null;
  verificationStatus: "unverified" | "verified" | "rejected";
  description: string | null;
  sourceSystem: string | null;
  applicability: string | null;
  revision: string | null;
  observedAt: string | null;
}

export interface AgentDeliverableRow {
  id: string;
  title: string;
  status: "planned" | "submitted" | "accepted" | "rejected";
  revision: string | null;
}

export interface EvidenceMatch {
  evidence: AgentEvidenceRow;
  /** Distinct criterion terms found in the row's text. Why it matched. */
  matchedTerms: string[];
  score: number;
}

export type GapVerdict =
  | "supported"
  | "unverified_only"
  | "ai_inference_only"
  | "no_matching_evidence"
  | "no_evidence_recorded";

export interface EvidenceGapAnalysis {
  verdict: GapVerdict;
  /** One honest sentence the panel renders verbatim. */
  statement: string;
  matches: EvidenceMatch[];
  verifiedMatches: number;
  acceptedDeliverables: number;
  totalCaseEvidence: number;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "are",
  "is",
  "its",
  "has",
  "have",
  "been",
  "from",
  "into",
  "against",
  "enough",
  "complete",
  "exists",
  "must",
  "will",
  "shall",
  "each",
  "every",
  "their",
  "carry",
  "carries",
  "record",
  "recorded",
  "stated",
  "states",
]);

/** Content-bearing terms of a criterion: lowercased, ≥4 chars, non-stopword. */
export function criterionTerms(criterion: string): string[] {
  const seen = new Set<string>();
  for (const raw of criterion.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) seen.add(raw);
  }
  return [...seen];
}

/**
 * Deterministic term-overlap matching. A row matches when at least TWO
 * distinct criterion terms appear in its text — one shared word ("estimate",
 * "risk") is coincidence at industrial-vocabulary density, and a match this
 * module cannot explain by naming its terms is a match it must not claim.
 * When the criterion itself carries fewer than two content terms, one
 * suffices (there is nothing else to require).
 */
export function matchEvidenceToCriterion(
  criterion: string,
  evidence: AgentEvidenceRow[],
): EvidenceMatch[] {
  const terms = criterionTerms(criterion);
  if (terms.length === 0) return [];
  const needed = Math.min(2, terms.length);

  const matches: EvidenceMatch[] = [];
  for (const row of evidence) {
    const text = [row.description, row.applicability, row.sourceSystem]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!text) continue;
    const matched = terms.filter((t) => text.includes(t));
    if (matched.length >= needed) {
      matches.push({
        evidence: row,
        matchedTerms: matched,
        score: matched.length / terms.length,
      });
    }
  }
  return matches.sort(
    (a, b) =>
      b.score - a.score ||
      // Verified evidence outranks unverified at equal relevance.
      Number(b.evidence.verificationStatus === "verified") -
        Number(a.evidence.verificationStatus === "verified"),
  );
}

/**
 * The honest verdict ladder. 'supported' requires a VERIFIED match — an
 * unverified row is a claim, not support; a rejected row supports nothing.
 * AI_INFERENCE rows only ever support a criterion after a human verified
 * them (at which point a human took them — D11.18), so a match set that is
 * entirely unverified AI inference is named as exactly that.
 */
export function analyzeGap(
  criterion: string,
  evidence: AgentEvidenceRow[],
  deliverables: AgentDeliverableRow[],
): EvidenceGapAnalysis {
  const matches = matchEvidenceToCriterion(criterion, evidence);
  const usable = matches.filter(
    (m) => m.evidence.verificationStatus !== "rejected",
  );
  const verified = usable.filter(
    (m) => m.evidence.verificationStatus === "verified",
  );
  const accepted = deliverables.filter((d) => d.status === "accepted").length;

  let verdict: GapVerdict;
  let statement: string;
  if (evidence.length === 0) {
    verdict = "no_evidence_recorded";
    statement =
      "No evidence is recorded on this case at all — nothing can support this requirement yet.";
  } else if (usable.length === 0) {
    verdict = "no_matching_evidence";
    statement = `No evidence found for this requirement: ${evidence.length} evidence item(s) exist on the case, none of them addresses it.`;
  } else if (verified.length > 0) {
    verdict = "supported";
    statement = `${verified.length} verified evidence item(s) address this requirement (${usable.length} match(es) in total).`;
  } else if (
    usable.every((m) => m.evidence.evidenceClass === "AI_INFERENCE")
  ) {
    verdict = "ai_inference_only";
    statement = `Only unverified AI inference addresses this requirement (${usable.length} item(s)) — an AI inference never counts as support until a human verifies it.`;
  } else {
    verdict = "unverified_only";
    statement = `${usable.length} evidence item(s) address this requirement but none is verified — unverified evidence is a claim, not support.`;
  }

  if (accepted > 0) {
    statement += ` ${accepted} accepted deliverable(s) are linked to this requirement.`;
  }

  return {
    verdict,
    statement,
    matches: usable,
    verifiedMatches: verified.length,
    acceptedDeliverables: accepted,
    totalCaseEvidence: evidence.length,
  };
}

export interface KbCitation {
  chunkId: string;
  title: string;
  pageRange: string;
  documentClass: string;
  label: string;
}

/**
 * Prompt for the optional narrative pass. The system prompt states the §70
 * boundary in the model's own instructions; the user content carries ONLY
 * deterministic matches and citations, so the narrative cannot introduce
 * evidence the gap analysis did not find.
 */
export function buildAgentPrompts(input: {
  criterion: string;
  guidance: string | null;
  analysis: EvidenceGapAnalysis;
  kbCitations: KbCitation[];
}): { systemPrompt: string; userContent: string } {
  const systemPrompt = [
    "You are the Sync Develop evidence agent. You answer one question: what recorded evidence supports this gate requirement, and what is missing?",
    "You are ADVISORY ONLY (spec §70): you cannot satisfy a requirement, flip a status, or make any determination. A gate decision is a human act.",
    "Ground every sentence in the supplied matches and citations. If the supplied analysis says no evidence was found, say exactly that — a gap named honestly is the product, and inventing support is the one failure that matters.",
    "Answer in at most 120 words: what supports the requirement (naming evidence items), what is missing, and what kind of evidence would close the gap.",
  ].join("\n");

  const lines: string[] = [
    `Requirement: ${input.criterion}`,
    input.guidance ? `Guidance: ${input.guidance}` : "",
    `Deterministic gap analysis: ${input.analysis.statement}`,
    "",
    "Matched evidence items:",
    ...(input.analysis.matches.length === 0
      ? ["(none)"]
      : input.analysis.matches.map(
          (m) =>
            `- [${m.evidence.evidenceClass ?? "unclassified"} | ${m.evidence.verificationStatus}] ${
              m.evidence.description ?? "(no description)"
            } (matched terms: ${m.matchedTerms.join(", ")})`,
        )),
    "",
    "Knowledge-base passages (tenant document intake):",
    ...(input.kbCitations.length === 0
      ? ["(none retrieved)"]
      : input.kbCitations.map((c) => `- ${c.label}`)),
  ].filter((line) => line !== null && line !== undefined);

  return { systemPrompt, userContent: lines.join("\n") };
}

export interface AgentResult {
  advisory: true;
  criterionId: number;
  criterion: string;
  analysis: EvidenceGapAnalysis;
  kbCitations: KbCitation[];
  /** Null when no provider is configured or the chain failed — never faked. */
  narrative: string | null;
  model: string | null;
  providerNote: string | null;
  disclaimer: string;
}

export const ADVISORY_DISCLAIMER =
  "Advisory only (spec §70): this output cannot satisfy a criterion, change a status, or feed the readiness calculation. Verification and gate decisions are human acts.";

export function buildAgentResult(input: {
  criterionId: number;
  criterion: string;
  analysis: EvidenceGapAnalysis;
  kbCitations: KbCitation[];
  narrative: string | null;
  model: string | null;
  providerNote: string | null;
}): AgentResult {
  return {
    advisory: true,
    criterionId: input.criterionId,
    criterion: input.criterion,
    analysis: input.analysis,
    kbCitations: input.kbCitations,
    narrative: input.narrative,
    model: input.model,
    providerNote: input.providerNote,
    disclaimer: ADVISORY_DISCLAIMER,
  };
}

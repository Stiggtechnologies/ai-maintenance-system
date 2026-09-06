/**
 * Evidence/Gap agent core (D12.07) — the deterministic half, tested where it
 * deploys from. The honest no-evidence answer is the product; these tests
 * pin that it stays first-class, that unverified AI inference never reads as
 * support, and that the §70 disclaimer is structural.
 */
import { describe, expect, it } from "vitest";
import {
  ADVISORY_DISCLAIMER,
  analyzeGap,
  buildAgentPrompts,
  buildAgentResult,
  criterionTerms,
  matchEvidenceToCriterion,
  type AgentEvidenceRow,
} from "./develop-evidence-core";

const row = (over: Partial<AgentEvidenceRow>): AgentEvidenceRow => ({
  id: "e1",
  evidenceClass: "MEASURED",
  verificationStatus: "unverified",
  description: null,
  sourceSystem: "historian",
  applicability: null,
  revision: null,
  observedAt: null,
  ...over,
});

const CRITERION =
  "An execution risk register exists and HIGH risks carry treatments";

describe("criterionTerms", () => {
  it("keeps content-bearing terms and drops stopwords and short words", () => {
    const terms = criterionTerms(CRITERION);
    expect(terms).toContain("execution");
    expect(terms).toContain("register");
    expect(terms).toContain("treatments");
    expect(terms).toContain("risk"); // 4 chars, content-bearing — kept
    expect(terms).not.toContain("and"); // short word
    expect(terms).not.toContain("exists"); // filler verb on the stopword list
  });
});

describe("matchEvidenceToCriterion", () => {
  it("requires at least two distinct matched terms — one shared word is coincidence", () => {
    const oneTerm = row({
      id: "weak",
      description: "A risk was mentioned once in a meeting",
    });
    const twoTerms = row({
      id: "real",
      description:
        "Execution risk register exported from the PMO tool, treatments attached",
    });
    const matches = matchEvidenceToCriterion(CRITERION, [oneTerm, twoTerms]);
    expect(matches.map((m) => m.evidence.id)).toEqual(["real"]);
    expect(matches[0].matchedTerms.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing for evidence with no text", () => {
    expect(
      matchEvidenceToCriterion(CRITERION, [
        row({ description: null, sourceSystem: null }),
      ]),
    ).toEqual([]);
  });
});

describe("analyzeGap — the honest verdict ladder", () => {
  it("no evidence on the case at all is a first-class result", () => {
    const g = analyzeGap(CRITERION, [], []);
    expect(g.verdict).toBe("no_evidence_recorded");
    expect(g.statement).toMatch(/No evidence is recorded on this case/);
    expect(g.matches).toEqual([]);
  });

  it("evidence exists but none matches → the gap is named with the count", () => {
    const g = analyzeGap(
      CRITERION,
      [row({ description: "Vibration trend on the crusher drive end" })],
      [],
    );
    expect(g.verdict).toBe("no_matching_evidence");
    expect(g.statement).toMatch(/No evidence found for this requirement/);
    expect(g.totalCaseEvidence).toBe(1);
  });

  it("unverified matches are claims, not support", () => {
    const g = analyzeGap(
      CRITERION,
      [
        row({
          description:
            "Execution risk register exported with treatments attached",
        }),
      ],
      [],
    );
    expect(g.verdict).toBe("unverified_only");
    expect(g.verifiedMatches).toBe(0);
  });

  it("a match set that is entirely unverified AI inference is named as exactly that", () => {
    const g = analyzeGap(
      CRITERION,
      [
        row({
          evidenceClass: "AI_INFERENCE",
          description:
            "Model-inferred execution risk register coverage with treatments",
        }),
      ],
      [],
    );
    expect(g.verdict).toBe("ai_inference_only");
    expect(g.statement).toMatch(/never counts as support until a human verifies/);
  });

  it("a HUMAN-verified AI inference does support — the human took it (D11.18)", () => {
    const g = analyzeGap(
      CRITERION,
      [
        row({
          evidenceClass: "AI_INFERENCE",
          verificationStatus: "verified",
          description:
            "Model-inferred execution risk register coverage with treatments",
        }),
      ],
      [],
    );
    expect(g.verdict).toBe("supported");
    expect(g.verifiedMatches).toBe(1);
  });

  it("rejected evidence supports nothing", () => {
    const g = analyzeGap(
      CRITERION,
      [
        row({
          verificationStatus: "rejected",
          description:
            "Execution risk register draft with treatments, rejected on review",
        }),
      ],
      [],
    );
    expect(g.verdict).toBe("no_matching_evidence");
  });

  it("accepted deliverables are counted beside the verdict, never as evidence", () => {
    const g = analyzeGap(CRITERION, [], [
      { id: "d1", title: "Risk register", status: "accepted", revision: "B" },
      { id: "d2", title: "Draft", status: "submitted", revision: "A" },
    ]);
    expect(g.acceptedDeliverables).toBe(1);
    expect(g.verdict).toBe("no_evidence_recorded");
    expect(g.statement).toMatch(/1 accepted deliverable/);
  });
});

describe("the advisory boundary is structural", () => {
  it("every result carries the §70 disclaimer and advisory flag", () => {
    const result = buildAgentResult({
      criterionId: 7,
      criterion: CRITERION,
      analysis: analyzeGap(CRITERION, [], []),
      kbCitations: [],
      narrative: null,
      model: null,
      providerNote: "no model provider is configured",
    });
    expect(result.advisory).toBe(true);
    expect(result.disclaimer).toBe(ADVISORY_DISCLAIMER);
    expect(result.disclaimer).toMatch(/cannot satisfy a criterion/);
    expect(result.narrative).toBeNull();
  });

  it("the prompt tells the model it is advisory and grounds it in the deterministic matches", () => {
    const prompts = buildAgentPrompts({
      criterion: CRITERION,
      guidance: null,
      analysis: analyzeGap(CRITERION, [], []),
      kbCitations: [],
    });
    expect(prompts.systemPrompt).toMatch(/ADVISORY ONLY/);
    expect(prompts.systemPrompt).toMatch(/cannot satisfy a requirement/);
    expect(prompts.userContent).toMatch(/No evidence is recorded/);
    expect(prompts.userContent).toMatch(/\(none\)/);
  });
});

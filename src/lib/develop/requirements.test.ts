import { describe, expect, it } from "vitest";
import {
  MEASURED_VERIFICATION_METHODS,
  agentModelNote,
  aiFindingsAsFindings,
  requirementGapLists,
  wbsClause,
  RELIABILITY_BY_DESIGN_CATEGORIES,
  SPEC10_REQUIREMENT_CATEGORIES,
  VERIFICATION_METHODS,
  coverageLabel,
  deferredChainLinks,
  findingsHeadline,
  hasAiGeneratedFindings,
  isSpec10Category,
  methodDemandsAcceptanceCriteria,
  orderedFindings,
  traceabilityHeadline,
  type RequirementFindings,
  type RequirementTraceability,
} from "./requirements";

const trace = (
  over: Partial<RequirementTraceability> = {},
): RequirementTraceability => ({
  caseId: "case-1",
  refused: false,
  requirementCount: 4,
  threadCoveragePct: 25,
  verifiedPct: 50,
  chain: [],
  gaps: {},
  ...over,
});

describe("the §10 and §11 vocabularies", () => {
  it("carries exactly the eleven §10 categories", () => {
    expect(SPEC10_REQUIREMENT_CATEGORIES).toHaveLength(11);
    expect(SPEC10_REQUIREMENT_CATEGORIES.map((c) => c.key)).toEqual([
      "functional",
      "performance",
      "safety",
      "reliability",
      "availability",
      "maintainability",
      "environmental",
      "cyber",
      "regulatory",
      "operability",
      "quality",
    ]);
  });

  it("carries exactly the five §11 methods, including OPERATIONAL_VALIDATION", () => {
    expect(VERIFICATION_METHODS.map((m) => m.key)).toEqual([
      "analysis",
      "inspection",
      "demonstration",
      "test",
      "operational_validation",
    ]);
  });

  it("keeps the five reliability-by-design categories out of the §10 set", () => {
    for (const c of RELIABILITY_BY_DESIGN_CATEGORIES) {
      expect(isSpec10Category(c.key)).toBe(false);
    }
    for (const c of SPEC10_REQUIREMENT_CATEGORIES) {
      expect(isSpec10Category(c.key)).toBe(true);
    }
  });

  it("demands acceptance criteria for the measured methods only", () => {
    expect(MEASURED_VERIFICATION_METHODS).toEqual([
      "test",
      "operational_validation",
    ]);
    expect(methodDemandsAcceptanceCriteria("test")).toBe(true);
    expect(methodDemandsAcceptanceCriteria("operational_validation")).toBe(
      true,
    );
    expect(methodDemandsAcceptanceCriteria("analysis")).toBe(false);
    expect(methodDemandsAcceptanceCriteria("inspection")).toBe(false);
  });
});

describe("coverageLabel — a refused percentage is never rendered as a number", () => {
  it("says the figure was refused when it is null", () => {
    const label = coverageLabel(null, "Thread coverage");
    expect(label).toMatch(/not stated/);
    expect(label).toMatch(/refused/);
    expect(label).not.toMatch(/0%/);
    expect(label).not.toMatch(/100%/);
  });

  it("says the figure was refused when it is undefined", () => {
    expect(coverageLabel(undefined, "Verified")).toMatch(/not stated/);
  });

  it("refuses a non-finite figure rather than printing NaN", () => {
    expect(coverageLabel(Number.NaN, "Verified")).toMatch(/non-finite/);
    expect(coverageLabel(Number.NaN, "Verified")).not.toMatch(/NaN%/);
    expect(coverageLabel(Number.POSITIVE_INFINITY, "Verified")).toMatch(
      /non-finite/,
    );
  });

  it("renders a real figure, including a real zero", () => {
    expect(coverageLabel(0, "Verified")).toBe("Verified: 0%");
    expect(coverageLabel(62.5, "Thread coverage")).toBe(
      "Thread coverage: 62.5%",
    );
  });
});

describe("traceabilityHeadline — refusal-first", () => {
  it("returns the server's refusal verbatim rather than softening it", () => {
    const refusal =
      "No requirement has been recorded on this case, so there is no traceability to report.";
    expect(
      traceabilityHeadline(
        trace({ refused: true, refusal, requirementCount: 0 }),
      ),
    ).toBe(refusal);
  });

  it("never manufactures a zero-orphan reading from a refused payload", () => {
    const headline = traceabilityHeadline(
      trace({
        refused: true,
        refusal: "refused because the set is empty",
        requirementCount: 0,
      }),
    );
    expect(headline).not.toMatch(/0 have no verification method/);
  });

  it("says nothing has been read when there is no payload at all", () => {
    expect(traceabilityHeadline(null)).toBe("Traceability has not been read.");
  });

  it("counts each gap family and carries the delegated WBS answer", () => {
    const headline = traceabilityHeadline(
      trace({
        gaps: {
          withoutVerificationMethod: [
            { requirementId: 1, requirementRef: "R-1" },
            { requirementId: 2, requirementRef: "R-2" },
          ],
          awaitingVerification: [{ requirementId: 1, requirementRef: "R-1" }],
          verificationFailed: [{ requirementId: 5, requirementRef: "R-5" }],
          withoutObjective: [{ requirementId: 3, requirementRef: "R-3" }],
        },
        scopeChain: {
          owner: "get_case_scope_traceability (D5.02)",
          answered: true,
          requirementsWithoutWbs: [{ requirementId: 4, requirementRef: "R-4" }],
          requirementsWithoutNeed: [],
          note: "one predicate",
        },
      }),
    );
    expect(headline).toMatch(/2 have no verification method/);
    expect(headline).toMatch(/1 are open with no result recorded/);
    expect(headline).toMatch(/1 trace to no objective/);
    expect(headline).toMatch(/1 do not appear in the WBS/);
  });

  /**
   * REPAIR. A requirement somebody looked at and REJECTED was in neither the
   * numerator nor any gap list: verifiedPct counted only `verified` and the
   * single unverified bucket was filtered to `open`. On the shipped smoke
   * case — 12 open, 1 verified, 1 failed of 14 — the headline accounted for
   * 13 of 14 and the missing one was the most consequential row there.
   */
  it("gives a verified-and-FAILED requirement its own clause so the buckets partition the count", () => {
    const headline = traceabilityHeadline(
      trace({
        requirementCount: 3,
        gaps: {
          awaitingVerification: [{ requirementId: 1, requirementRef: "R-1" }],
          verificationFailed: [{ requirementId: 2, requirementRef: "R-2" }],
        },
      }),
    );
    expect(headline).toMatch(/1 were verified and FAILED/);
    // and it is never counted as merely open
    expect(headline).toMatch(/1 are open with no result recorded/);
  });

  /**
   * REPAIR. `requirementsWithoutWbs.length` on a REFUSED delegate is 0, and
   * the headline printed "0 do not appear in the WBS" — an unanswered
   * question rendered as a clean answer in the one sentence a reader takes
   * away from the panel.
   */
  it("refuses the WBS clause rather than reporting zero when the delegate did not answer", () => {
    const headline = traceabilityHeadline(
      trace({
        scopeChain: {
          owner: "get_case_scope_traceability (D5.02)",
          answered: false,
          requirementsWithoutWbs: [],
          requirementsWithoutNeed: [],
          note: "one predicate",
        },
      }),
    );
    expect(headline).not.toMatch(/0 do not appear in the WBS/);
    expect(headline).toMatch(/was NOT answered/);
  });

  it("carries the refused percentages into the headline as refusals", () => {
    const headline = traceabilityHeadline(
      trace({ threadCoveragePct: null, verifiedPct: null }),
    );
    expect(headline).toMatch(/Thread coverage: not stated/);
    expect(headline).toMatch(/verified: not stated/);
  });
});

describe("deferredChainLinks — a named hole is rendered, never filtered away", () => {
  it("returns only the links that are not built, with their reason", () => {
    const links = deferredChainLinks(
      trace({
        chain: [
          { link: "objective", home: "risk_objectives", built: true, count: 2 },
          {
            link: "design object",
            home: "none",
            built: false,
            count: null,
            deferral: "no canonical store",
          },
          {
            link: "procurement specification",
            home: "contract_packages",
            built: false,
            count: null,
            deferral: "Slice 6",
          },
        ],
      }),
    );
    expect(links.map((l) => l.link)).toEqual([
      "design object",
      "procurement specification",
    ]);
    expect(links.every((l) => (l.deferral ?? "").length > 0)).toBe(true);
  });

  it("returns an empty list for a null payload rather than throwing", () => {
    expect(deferredChainLinks(null)).toEqual([]);
  });
});

const findings = (
  over: Partial<RequirementFindings> = {},
): RequirementFindings => ({
  caseId: "case-1",
  refused: false,
  requirementCount: 3,
  findingCount: 0,
  findings: [],
  ...over,
});

describe("findingsHeadline — zero findings only means something beside a denominator", () => {
  it("returns the refusal when the requirement set is empty", () => {
    const refusal =
      "This case has no requirements, so the Requirements Agent has nothing to check.";
    expect(
      findingsHeadline(
        findings({
          refused: true,
          refusal,
          requirementCount: 0,
          findingCount: null,
        }),
      ),
    ).toBe(refusal);
  });

  it("never reports a refused payload as a clean result", () => {
    const headline = findingsHeadline(
      findings({
        refused: true,
        refusal: "refused",
        requirementCount: 0,
        findingCount: null,
      }),
    );
    expect(headline).not.toMatch(/No findings/);
  });

  it("attaches the denominator to a genuine zero", () => {
    expect(findingsHeadline(findings({ findingCount: 0 }))).toMatch(
      /No findings across 3 requirement\(s\)/,
    );
  });

  it("says the agent has not run when there is no payload", () => {
    expect(findingsHeadline(null)).toBe(
      "The Requirements Agent has not been run.",
    );
  });

  it("prefers the server headline when findings exist", () => {
    expect(
      findingsHeadline(
        findings({
          findingCount: 2,
          headline: "2 requirements have no method.",
        }),
      ),
    ).toBe("2 requirements have no method.");
  });
});

describe("orderedFindings — a model's guess never outranks a query's fact", () => {
  it("sorts deterministic findings above AI-suggested ones whatever severity arrives", () => {
    const ordered = orderedFindings([
      {
        family: "inconsistent",
        subFamily: "semantic_inconsistency",
        severity: "blocking",
        source: "ai_suggestion",
        requirementRef: "R-9",
      },
      {
        family: "unowned",
        severity: "attention",
        source: "deterministic",
        requirementRef: "R-1",
      },
    ]);
    expect(ordered[0].source).toBe("deterministic");
    expect(ordered[1].source).toBe("ai_suggestion");
  });

  it("orders deterministic findings by severity then family then reference", () => {
    const ordered = orderedFindings([
      {
        family: "unowned",
        severity: "attention",
        source: "deterministic",
        requirementRef: "R-2",
      },
      {
        family: "missing_verification_method",
        severity: "blocking",
        source: "deterministic",
        requirementRef: "R-3",
      },
      {
        family: "unowned",
        severity: "attention",
        source: "deterministic",
        requirementRef: "R-1",
      },
    ]);
    expect(ordered.map((f) => f.requirementRef)).toEqual(["R-3", "R-1", "R-2"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      {
        family: "unowned",
        severity: "attention",
        source: "ai_suggestion",
        requirementRef: "R-2",
      },
      {
        family: "unowned",
        severity: "blocking",
        source: "deterministic",
        requirementRef: "R-1",
      },
    ];
    const copy = [...input];
    orderedFindings(input);
    expect(input).toEqual(copy);
  });
});

describe("hasAiGeneratedFindings", () => {
  it("is true when any finding came from a model", () => {
    expect(
      hasAiGeneratedFindings(
        findings({
          findingCount: 1,
          findings: [
            {
              family: "inconsistent",
              severity: "attention",
              source: "ai_suggestion",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false for a purely deterministic payload and for no payload", () => {
    expect(
      hasAiGeneratedFindings(
        findings({
          findingCount: 1,
          findings: [
            {
              family: "unowned",
              severity: "attention",
              source: "deterministic",
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(hasAiGeneratedFindings(null)).toBe(false);
  });
});

/* ────────────────────── the REPAIR surface helpers ────────────────────── */

describe("requirementGapLists — the gaps the server computed and nothing rendered", () => {
  it("returns every §10 gap family with its rows, so none is silently compliant", () => {
    const lists = requirementGapLists(
      trace({
        gaps: {
          outsideSpec10Taxonomy: [{ requirementId: 9, requirementRef: "R-9" }],
          withoutOwner: [{ requirementId: 8, requirementRef: "R-8" }],
          withoutAcceptanceCriteria: [
            { requirementId: 7, requirementRef: "R-7" },
          ],
          verificationFailed: [{ requirementId: 6, requirementRef: "R-6" }],
        },
      }),
    );
    const byKey = Object.fromEntries(lists.map((l) => [l.key, l]));
    // The three the panel could never show before, each with a record link.
    expect(byKey.outsideSpec10Taxonomy.rows[0].requirementRef).toBe("R-9");
    expect(byKey.withoutOwner.rows[0].requirementRef).toBe("R-8");
    expect(byKey.withoutAcceptanceCriteria.rows[0].requirementRef).toBe("R-7");
    // and the bucket that did not exist at all.
    expect(byKey.verificationFailed.rows[0].requirementRef).toBe("R-6");
    expect(byKey.verificationFailed.tone).toBe("blocking");
  });

  it("states an EMPTY family as a sentence rather than as a zero", () => {
    const lists = requirementGapLists(trace({ gaps: {} }));
    for (const l of lists) {
      expect(l.rows).toEqual([]);
      expect(l.emptyNote.length).toBeGreaterThan(20);
      expect(l.emptyNote).not.toMatch(/^0\b/);
    }
  });

  it("renders nothing at all over a REFUSED payload", () => {
    expect(
      requirementGapLists(trace({ refused: true, requirementCount: 0 })),
    ).toEqual([]);
  });
});

describe("wbsClause — a delegate that did not answer is not zero", () => {
  it("reports the count when the delegate answered", () => {
    expect(
      wbsClause(
        trace({
          scopeChain: {
            owner: "o",
            answered: true,
            requirementsWithoutWbs: [
              { requirementId: 1, requirementRef: "R-1" },
            ],
            requirementsWithoutNeed: [],
            note: "n",
          },
        }),
      ),
    ).toMatch(/1 do not appear in the WBS/);
  });

  it("refuses rather than printing 0 when the delegate did not answer", () => {
    const clause = wbsClause(
      trace({
        scopeChain: {
          owner: "o",
          answered: false,
          requirementsWithoutWbs: [],
          requirementsWithoutNeed: [],
          note: "n",
        },
      }),
    );
    expect(clause).not.toMatch(/\b0\b/);
    expect(clause).toMatch(/NOT answered/);
  });
});

describe("aiFindingsAsFindings — the model's half, labelled here and not by the model", () => {
  it("labels every candidate ai_suggestion and caps it at attention", () => {
    const out = aiFindingsAsFindings([
      {
        requirement_ref: "R-1",
        related_requirement_ref: "R-2",
        concern: "the availability target cannot be met by the stated sparing",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("ai_suggestion");
    expect(out[0].severity).toBe("attention");
    expect(out[0].aiGenerated).toBe(true);
  });

  it("sorts BELOW every deterministic finding once merged, whatever arrives", () => {
    const merged = orderedFindings([
      ...aiFindingsAsFindings([
        { requirement_ref: "R-1", related_requirement_ref: null, concern: "c" },
      ]),
      {
        family: "unowned",
        severity: "informational",
        source: "deterministic",
        requirementRef: "R-2",
      },
    ]);
    // informational FACT above an attention GUESS: the AI rank dominates.
    expect(merged[0].source).toBe("deterministic");
    expect(merged[1].source).toBe("ai_suggestion");
  });

  it("resolves a requirement id when the case carries the reference", () => {
    const out = aiFindingsAsFindings(
      [{ requirement_ref: "R-1", related_requirement_ref: null, concern: "c" }],
      (ref) => (ref === "R-1" ? 42 : undefined),
    );
    expect(out[0].requirementId).toBe(42);
  });
});

describe("agentModelNote — asked-and-found-nothing is not never-asked", () => {
  it("says the model was asked and returned none, rather than rendering silence", () => {
    const note = agentModelNote({ model: "some-model", aiFindings: [] });
    expect(note).toMatch(/returned none/);
    expect(note).toMatch(/not a finding/);
  });

  it("says nothing when no model was reached at all", () => {
    expect(agentModelNote({ model: null, aiFindings: [] })).toBeNull();
  });

  it("prefers the provider's own note when there is one", () => {
    expect(
      agentModelNote({ providerNote: "no provider configured", model: null }),
    ).toBe("no provider configured");
  });

  it("reports DROPPED candidates rather than swallowing them", () => {
    const note = agentModelNote({
      model: "m",
      aiFindings: [{}],
      aiDropped: ['reference "PR-14" does not resolve'],
    });
    expect(note).toMatch(/DROPPED/);
    expect(note).toMatch(/PR-14/);
  });

  it("says nothing over a refusal — the refusal is the answer", () => {
    expect(agentModelNote({ refused: true, model: "m" })).toBeNull();
  });
});

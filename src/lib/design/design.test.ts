/**
 * Validation for reliability-by-design.
 *
 * The allocation has an exact closed form, so the tests below are pinned to
 * hand arithmetic rather than to whatever the code emitted: two subsystems
 * sharing a 0.81 target must each get exactly 0.9, because 0.9 × 0.9 = 0.81.
 * The remainder cover the refusals, which are the point — an allocation nobody
 * checked against real equipment is a target that survives design review and
 * fails commissioning.
 */
import { describe, expect, it } from "vitest";
import {
  DESIGN_AXES,
  DESIGN_AXIS_SCALE,
  DISPOSITION_DISCIPLINES,
  DISPOSITION_OUTCOMES,
  FRONTLINE_DIMENSIONS,
  FRONTLINE_DISCIPLINES,
  allocateAvailability,
  analyseEarlyLife,
  assessStandardisation,
  latestDisposition,
  readDesignScorecard,
  readFrontlineReview,
  type DesignScorecardPayload,
  type FrontlineFinding,
  type FrontlineReviewPayload,
  type FrontlineStudy,
  type Subsystem,
} from "./index";

describe("allocateAvailability — series", () => {
  it("splits a target so the product is exactly the target", () => {
    // 0.9 x 0.9 = 0.81, by construction.
    const r = allocateAvailability(0.81, [{ label: "A" }, { label: "B" }]);
    expect(r.subsystems[0].allocated).toBeCloseTo(0.9, 12);
    expect(r.subsystems[1].allocated).toBeCloseTo(0.9, 12);
    const product = r.subsystems.reduce((p, s) => p * s.allocated, 1);
    expect(product).toBeCloseTo(0.81, 12);
  });

  it("reduces to equal apportionment for equal weights at any n", () => {
    for (const n of [3, 5, 10]) {
      const subs: Subsystem[] = Array.from({ length: n }, (_, i) => ({
        label: `S${i}`,
      }));
      const r = allocateAvailability(0.99, subs);
      const expected = Math.pow(0.99, 1 / n);
      for (const s of r.subsystems)
        expect(s.allocated).toBeCloseTo(expected, 12);
      expect(r.subsystems.reduce((p, s) => p * s.allocated, 1)).toBeCloseTo(
        0.99,
        12,
      );
    }
  });

  it("shows why ten series subsystems cannot each be given the system target", () => {
    // The whole point: 99% system needs ~99.9% each, not 99% each.
    const subs = Array.from({ length: 10 }, (_, i) => ({ label: `S${i}` }));
    const r = allocateAvailability(0.99, subs);
    expect(r.subsystems[0].allocated).toBeCloseTo(0.998995, 5);
    // And ten subsystems at 99% each would only reach:
    expect(Math.pow(0.99, 10)).toBeCloseTo(0.9044, 4);
  });

  it("gives a heavier subsystem a smaller share of the availability", () => {
    // Weights 1 and 3 over a 0.81 target: 0.81^0.25 and 0.81^0.75.
    const r = allocateAvailability(0.81, [
      { label: "Simple", complexityWeight: 1 },
      { label: "Hard", complexityWeight: 3 },
    ]);
    expect(r.subsystems[0].allocated).toBeCloseTo(Math.pow(0.81, 0.25), 12);
    expect(r.subsystems[1].allocated).toBeCloseTo(Math.pow(0.81, 0.75), 12);
    expect(r.subsystems[1].allocated).toBeLessThan(r.subsystems[0].allocated);
    expect(r.subsystems.reduce((p, s) => p * s.allocated, 1)).toBeCloseTo(
      0.81,
      12,
    );
  });
});

describe("allocateAvailability — parallel", () => {
  it("splits unavailability so the parallel combination is the target", () => {
    // 1 - (0.1 x 0.1) = 0.99, so each leg is 0.9.
    const r = allocateAvailability(
      0.99,
      [{ label: "A" }, { label: "B" }],
      "parallel",
    );
    expect(r.subsystems[0].allocated).toBeCloseTo(0.9, 12);
    const combined =
      1 - r.subsystems.reduce((p, s) => p * (1 - s.allocated), 1);
    expect(combined).toBeCloseTo(0.99, 12);
  });

  it("asks less of each leg than the series case does", () => {
    const series = allocateAvailability(0.99, [{ label: "A" }, { label: "B" }]);
    const parallel = allocateAvailability(
      0.99,
      [{ label: "A" }, { label: "B" }],
      "parallel",
    );
    expect(parallel.subsystems[0].allocated).toBeLessThan(
      series.subsystems[0].allocated,
    );
  });
});

describe("allocateAvailability — the refusals", () => {
  it("REFUSES a target that the proposed equipment cannot reach", () => {
    const r = allocateAvailability(0.99, [
      { label: "Pump", demonstrated: 0.999 },
      { label: "Drive", demonstrated: 0.98 }, // allocated ~0.995, short
    ]);
    expect(r.feasible).toBe(false);
    expect(r.subsystems[1].shortfall).toBeGreaterThan(0);
    expect(r.achievable).toBeCloseTo(0.999 * 0.98, 12);
    // Singular, because exactly one subsystem falls short.
    expect(r.reason).toMatch(/1 subsystem cannot deliver what it is allocated/);
    expect(r.reason).toMatch(/not achievable as specified/i);
    expect(r.reason).toMatch(/costs the difference for the life of the asset/i);
  });

  it("reports feasibility as UNKNOWN rather than met when evidence is missing", () => {
    const r = allocateAvailability(0.99, [
      { label: "Pump", demonstrated: 0.999 },
      { label: "Drive" },
    ]);
    expect(r.feasible).toBe(false);
    expect(r.achievable).toBeNull();
    expect(r.reason).toMatch(/1 subsystem has no demonstrated availability/);
    expect(r.reason).toMatch(/feasibility is UNKNOWN rather than met/i);
    expect(r.reason).toMatch(/survives design review and fails commissioning/i);
  });

  it("accepts a target every subsystem demonstrably meets", () => {
    const r = allocateAvailability(0.81, [
      { label: "A", demonstrated: 0.95 },
      { label: "B", demonstrated: 0.95 },
    ]);
    expect(r.feasible).toBe(true);
    expect(r.achievable).toBeCloseTo(0.9025, 12);
  });

  it("REFUSES a target of 1.0", () => {
    const r = allocateAvailability(1.0, [{ label: "A" }]);
    expect(r.feasible).toBe(false);
    expect(r.reason).toMatch(/not achievable by anything that can fail/i);
  });

  it("REFUSES an allocation with no subsystems", () => {
    const r = allocateAvailability(0.99, []);
    expect(r.reason).toMatch(/a number in a document/i);
  });
});

describe("analyseEarlyLife", () => {
  const RECORDS = [
    { assetLabel: "P-1", monthsSinceHandover: 2, attributedTo: "installation" },
    { assetLabel: "P-2", monthsSinceHandover: 5, attributedTo: "design" },
    {
      assetLabel: "P-3",
      monthsSinceHandover: 9,
      attributedTo: "commissioning",
      fedBackToDesign: true,
    },
    {
      assetLabel: "P-4",
      monthsSinceHandover: 11,
      attributedTo: "not_determined",
    },
    { assetLabel: "P-5", monthsSinceHandover: 30, attributedTo: "random" },
  ];

  const r = analyseEarlyLife(RECORDS, 12);

  it("counts only failures inside the window", () => {
    expect(r.total).toBe(5);
    expect(r.withinWindow).toBe(4);
    expect(r.proportionWithin).toBeCloseTo(0.8, 12);
  });

  it("splits by attribution rather than lumping into infant mortality", () => {
    expect(r.preventableAtDesignOrBuild).toBe(3);
    expect(r.reason).toMatch(
      /preventable by a different party at a different stage/i,
    );
  });

  it("names unattributed failures as teaching nobody anything", () => {
    expect(r.reason).toMatch(/teaches nobody anything/i);
  });

  it("says plainly when nothing has been fed back", () => {
    const none = analyseEarlyLife(
      RECORDS.map((x) => ({ ...x, fedBackToDesign: false })),
      12,
    );
    expect(none.fedBack).toBe(0);
    expect(none.reason).toMatch(/The next project will buy the same problem/i);
  });

  it("does not read an empty register as an absence of early-life failures", () => {
    const empty = analyseEarlyLife([], 12);
    expect(empty.reason).toMatch(/logged as ordinary corrective work/i);
  });
});

describe("assessStandardisation", () => {
  it("counts variants per function and names the most fragmented", () => {
    const r = assessStandardisation([
      { functionLabel: "Haul truck", makeModel: "Komatsu 930-4", count: 19 },
      { functionLabel: "Haul truck", makeModel: "Cat 793F", count: 3 },
      { functionLabel: "Slurry pump", makeModel: "Warman 8/6", count: 4 },
    ]);
    const trucks = r.functions.find((f) => f.functionLabel === "Haul truck");
    expect(trucks?.variants).toBe(2);
    expect(trucks?.totalUnits).toBe(22);
    expect(trucks?.dominantShare).toBeCloseTo(19 / 22, 12);
    expect(r.reason).toMatch(/most fragmented is Haul truck with 2/);
  });

  it("says who carries the cost of a variant and who chose it", () => {
    const r = assessStandardisation([
      { functionLabel: "Pump", makeModel: "A", count: 2 },
      { functionLabel: "Pump", makeModel: "B", count: 2 },
    ]);
    expect(r.functions[0].reason).toMatch(
      /carried by maintenance, chosen by the project/i,
    );
  });

  it("does not flag a function served by one model", () => {
    const r = assessStandardisation([
      { functionLabel: "Pump", makeModel: "A", count: 6 },
    ]);
    expect(r.functions[0].variants).toBe(1);
    expect(r.reason).toMatch(/served by a single make\/model/i);
  });
});

/* ═══════════ Slice 5B — the frontline review and the six axes ═══════════ */

describe("readFrontlineReview — the refusals (D4.10/D4.11, spec I.25)", () => {
  const finding = (over: Partial<FrontlineFinding> = {}): FrontlineFinding => ({
    id: 1,
    findingRef: "F-1",
    dimension: "accessibility",
    discipline: "maintenance",
    severity: "significant",
    recommendation: "The seal cannot be reached without removing the guard",
    raisedBy: "A Maintainer",
    requirementId: null,
    requirementRef: null,
    dispositions: [],
    ...over,
  });

  const study = (over: Partial<FrontlineStudy> = {}): FrontlineStudy => ({
    id: 1,
    studyKind: "frontline_design_review",
    frontlineKind: true,
    performedOn: "2026-12-05",
    summary: "Frontline review of the thickener underflow package",
    maintainerParticipated: true,
    operatorParticipated: false,
    constructorParticipated: false,
    findingsCount: 0,
    findingsClosed: 0,
    participants: [],
    findings: [],
    ...over,
  });

  const review = (
    over: Partial<FrontlineReviewPayload> = {},
  ): FrontlineReviewPayload => ({
    caseId: "c1",
    refused: false,
    refusal: null,
    studyCount: 0,
    studies: [],
    findingCount: 0,
    openFindingCount: 0,
    dispositionedCount: 0,
    byDiscipline: {},
    byDimension: {},
    blockers: [],
    blockerCount: 0,
    ...over,
  });

  /* ── 5B-R7 — "carried" stopped meaning "will be built" ──────────────── */

  const accepted = [
    {
      id: 1,
      no: 1,
      outcome: "accepted",
      reason: "The platform will be extended to reach the gland",
      conditions: null,
      discipline: "engineering",
      by: "An Engineer",
      at: "2026-12-05",
    },
  ];

  it("separates an acceptance carried by a FAILED requirement from a discharged one", () => {
    // The gate blocker cleared the moment a requirement id was attached, so an
    // acceptance could be discharged onto a requirement whose verification had
    // failed — the exact failure the family exists to stop, with a link in
    // front of it. It is not an uncarried acceptance and it is not a
    // discharged one; it is its own thing and it is named.
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        findingCount: 3,
        openFindingCount: 0,
        studies: [
          study({
            findings: [
              finding({
                id: 1,
                findingRef: "F-1",
                dispositions: accepted,
                requirementId: 10,
                requirementRef: "REQ-10",
                requirementVerification: "failed",
              }),
              finding({
                id: 2,
                findingRef: "F-2",
                dispositions: accepted,
                requirementId: 11,
                requirementRef: "REQ-11",
                requirementVerification: "waived",
              }),
              finding({
                id: 3,
                findingRef: "F-3",
                dispositions: accepted,
                requirementId: 12,
                requirementRef: "REQ-12",
                requirementVerification: "open",
              }),
            ],
          }),
        ],
      }),
    );
    expect(r.failedCarriers.map((f) => f.findingRef)).toEqual(["F-1", "F-2"]);
    // ...and they are NOT counted as uncarried, which would be a second answer
    // to the same question.
    expect(r.uncarriedAcceptances).toHaveLength(0);
    expect(r.headline).toContain("failed verification or been waived");
    expect(r.headline).toContain("discharges nothing");
  });

  it("a rejected recommendation on a failed requirement is not a failed carrier", () => {
    // A rejection carries nothing by definition, so it never enters the family
    // — the distinction is what makes the family mean something.
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        findingCount: 1,
        openFindingCount: 0,
        studies: [
          study({
            findings: [
              finding({
                dispositions: [{ ...accepted[0], outcome: "rejected" }],
                requirementId: 10,
                requirementRef: "REQ-10",
                requirementVerification: "failed",
              }),
            ],
          }),
        ],
      }),
    );
    expect(r.failedCarriers).toHaveLength(0);
  });

  it("carries the server's refusal instead of rendering a zero", () => {
    const r = readFrontlineReview(
      review({
        refused: true,
        refusal: "No design review is recorded against this case.",
        findingCount: null,
        openFindingCount: null,
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.headline).toContain("No design review is recorded");
  });

  it("REFUSES a payload that says it computed a count and then omits it", () => {
    // A missing count is not zero findings. The server would have to regress
    // for this to happen, which is exactly why the backstop exists.
    const r = readFrontlineReview(
      review({ refused: false, findingCount: null, openFindingCount: 3 }),
    );
    expect(r.refused).toBe(true);
    expect(r.headline).toContain("not zero findings");
  });

  it("refuses with a stated reason even when the server gave none", () => {
    const r = readFrontlineReview(review({ refused: true, refusal: null }));
    expect(r.refused).toBe(true);
    expect(r.headline).toContain("no answer");
  });

  it("counts a finding with no disposition as open", () => {
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        studies: [study({ findings: [finding()] })],
        findingCount: 1,
        openFindingCount: 1,
      }),
    );
    expect(r.openFindings).toHaveLength(1);
    expect(r.uncarriedAcceptances).toHaveLength(0);
  });

  it("reads the LATEST disposition, so a reversal is what counts", () => {
    const f = finding({
      dispositions: [
        {
          no: 1,
          outcome: "rejected",
          reason: "r1",
          discipline: "engineering",
          by: "E",
          at: "t",
          conditions: null,
        },
        {
          no: 2,
          outcome: "accepted",
          reason: "r2",
          discipline: "engineering",
          by: "E",
          at: "t",
          conditions: null,
        },
      ],
    });
    expect(latestDisposition(f)?.outcome).toBe("accepted");
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        studies: [study({ findings: [f] })],
        findingCount: 1,
        openFindingCount: 0,
      }),
    );
    expect(r.openFindings).toHaveLength(0);
    // Accepted and nothing carries it — the failure I.25 exists to stop.
    expect(r.uncarriedAcceptances).toHaveLength(1);
    expect(r.headline).toContain("never building it");
  });

  it("does not call an accepted recommendation uncarried once a requirement carries it", () => {
    const f = finding({
      requirementId: 7,
      requirementRef: "R-7",
      dispositions: [
        {
          no: 1,
          outcome: "accepted_with_conditions",
          reason: "r",
          conditions: "c",
          discipline: "maintenance",
          by: "M",
          at: "t",
        },
      ],
    });
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        studies: [study({ findings: [f] })],
        findingCount: 1,
        openFindingCount: 0,
      }),
    );
    expect(r.uncarriedAcceptances).toHaveLength(0);
  });

  it("does not call a REJECTED recommendation uncarried", () => {
    const f = finding({
      dispositions: [
        {
          no: 1,
          outcome: "rejected",
          reason:
            "The route is acceptable with the mobile crane already on site",
          conditions: null,
          discipline: "engineering",
          by: "E",
          at: "t",
        },
      ],
    });
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        studies: [study({ findings: [f] })],
        findingCount: 1,
        openFindingCount: 0,
      }),
    );
    expect(r.uncarriedAcceptances).toHaveLength(0);
  });

  it("names an unattended frontline review, and ignores a non-frontline kind", () => {
    const r = readFrontlineReview(
      review({
        studyCount: 2,
        studies: [
          study({ id: 1, maintainerParticipated: false }),
          study({
            id: 2,
            studyKind: "ram_study",
            frontlineKind: false,
            maintainerParticipated: false,
          }),
        ],
        findingCount: 1,
        openFindingCount: 0,
      }),
    );
    expect(r.unattendedReviews.map((s) => s.id)).toEqual([1]);
  });

  it("names the uncovered dimensions and the silent disciplines rather than counting them", () => {
    const r = readFrontlineReview(
      review({
        studyCount: 1,
        studies: [study({ findings: [finding()] })],
        findingCount: 1,
        openFindingCount: 1,
      }),
    );
    expect(r.uncoveredDimensions).toHaveLength(7);
    expect(r.uncoveredDimensions).toContain("Removal routes");
    expect(r.silentDisciplines).toEqual(["Operations", "Construction"]);
    expect(r.headline).toContain("Operations or Construction");
  });

  it("pins the eight dimensions, the three disciplines and the three outcomes", () => {
    expect(FRONTLINE_DIMENSIONS.map((d) => d.key)).toEqual([
      "accessibility",
      "isolation",
      "lifting",
      "inspection",
      "lubrication",
      "ergonomics",
      "removal_route",
      "emergency_response",
    ]);
    expect(FRONTLINE_DISCIPLINES.map((d) => d.key)).toEqual([
      "maintenance",
      "operations",
      "construction",
    ]);
    expect(DISPOSITION_DISCIPLINES.map((d) => d.key)).toContain("engineering");
    expect(DISPOSITION_OUTCOMES.map((o) => o.key)).toEqual([
      "accepted",
      "rejected",
      "accepted_with_conditions",
    ]);
  });
});

describe("readDesignScorecard — the composite refuses (D4.12, spec I.26)", () => {
  const axis = (key: string, score: number | null) => ({
    axis: key,
    score,
    basis: score == null ? null : "A stated basis for this score, long enough",
    scoredBy: score == null ? null : "A Human",
    scoredAt: score == null ? null : "2026-12-05",
    scored: score != null,
    history: [],
  });

  const all = (scores: number[]) =>
    DESIGN_AXES.map((a, i) => axis(a.key, scores[i] ?? null));

  const card = (
    over: Partial<DesignScorecardPayload> = {},
  ): DesignScorecardPayload => ({
    caseId: "c1",
    refused: false,
    refusal: null,
    axes: all([4, 4, 4, 4, 4, 4]),
    scoredAxisCount: 6,
    axisCount: 6,
    missingAxes: [],
    composite: 4,
    weakestAxis: { axis: "constructability", score: 4 },
    ...over,
  });

  it("names the six I.26 axes verbatim and in order", () => {
    expect(DESIGN_AXES.map((a) => a.key)).toEqual([
      "design_readiness",
      "constructability",
      "operability",
      "maintainability",
      "reliability",
      "commissionability",
    ]);
    expect(DESIGN_AXIS_SCALE.min).toBe(1);
    expect(DESIGN_AXIS_SCALE.max).toBe(5);
  });

  it("presents the composite when every axis is scored", () => {
    const r = readDesignScorecard(card());
    expect(r.refused).toBe(false);
    expect(r.composite).toBe(4);
    expect(r.headline).toContain("All six axes are scored");
  });

  it("REFUSES and names the axis when one is unscored", () => {
    const r = readDesignScorecard(
      card({
        axes: all([4, 4, 4, 4, 4]),
        scoredAxisCount: 5,
        missingAxes: ["commissionability"],
        composite: null,
        refused: true,
        refusal: "Five of six scored.",
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.composite).toBeNull();
    expect(r.missingAxisLabels).toEqual(["Commissionability"]);
  });

  it("REFUSES a composite that arrives beside an unscored axis — the backstop", () => {
    // The server saying refused:false while an axis is unscored is a
    // regression, and the average of five would read highest exactly when the
    // missing axis is the bad one.
    const r = readDesignScorecard(
      card({
        axes: all([5, 5, 5, 5, 5]),
        scoredAxisCount: 5,
        refused: false,
        composite: 5,
        missingAxes: [],
      }),
    );
    expect(r.refused).toBe(true);
    expect(r.composite).toBeNull();
    expect(r.headline).toContain("reads highest exactly when");
  });

  it("REFUSES a fully scored card whose composite never arrived", () => {
    const r = readDesignScorecard(card({ composite: null }));
    expect(r.refused).toBe(true);
    expect(r.headline).toContain("not a good composite");
  });

  it("names the weakest axis beside the composite, because the average hides it", () => {
    const r = readDesignScorecard(
      card({
        axes: all([5, 2, 5, 5, 5, 5]),
        composite: 4.5,
        weakestAxis: { axis: "constructability", score: 2 },
      }),
    );
    expect(r.headline).toContain("Constructability at 2");
  });

  it("always returns all six rows, even for an empty payload", () => {
    const r = readDesignScorecard(
      card({
        axes: [],
        scoredAxisCount: 0,
        missingAxes: DESIGN_AXES.map((a) => a.key),
        composite: null,
        refused: true,
        refusal: "Nothing scored.",
      }),
    );
    expect(r.rows).toHaveLength(6);
    expect(r.rows.every((x) => !x.scored)).toBe(true);
    expect(r.missingAxisLabels).toHaveLength(6);
  });
});

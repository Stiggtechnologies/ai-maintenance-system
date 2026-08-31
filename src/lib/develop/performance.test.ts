/**
 * Slice 4B performance helpers — the refusal paths, not the formatting.
 *
 * Every case here is a NUMBER THAT MUST NOT APPEAR: a CPI rendered from a
 * live read with no lineage, a metric that refused rendering as a blank (and
 * therefore reading as zero), an empty claim set reading as nothing earned, a
 * P80 derived from a deterministic figure, an unrated estimate printing the
 * same chip as a LOW one, a stale run captioned as freshly computed. Those
 * are the failures this module exists to prevent, so they are what it is
 * tested on.
 */
import { describe, expect, it } from "vitest";
import {
  EARNED_VALUE_METRICS,
  EAC_FORMULA,
  ESTIMATE_BASIS_DIMENSIONS,
  PERFORMANCE_CALC_KEYS,
  PERFORMANCE_CALC_VERSION,
  PROGRESS_EVIDENCE_SOURCES,
  confidenceLabel,
  coverageSuffix,
  earnedValueFingerprint,
  estimateConfidenceFingerprint,
  forecastConfidenceFingerprint,
  earnedValueHeadline,
  formatPerformanceValue,
  hasRunOutputs,
  integrityHeadline,
  metricDisplay,
  percentileCell,
  performanceRunIsStale,
  previewCumulativeCredit,
  performanceTrendFingerprint,
  progressIntegrityFingerprint,
  trendSentence,
  validateRuleSteps,
  type CaseEarnedValue,
  type CaseEstimateBasis,
  type CasePerformanceTrend,
  type ForecastConfidence,
  type CaseProgressIntegrity,
  type PerformanceCalculationRun,
} from "./performance";

/* ─────────────────────────────── fixtures ────────────────────────────── */

const run = (
  outputs: Record<string, unknown> | null,
  over: Partial<PerformanceCalculationRun> = {},
): PerformanceCalculationRun => ({
  id: "r1",
  calculationKey: "case_earned_value",
  method: "m".repeat(20),
  codeVersion: PERFORMANCE_CALC_VERSION,
  inputs: { periodRef: "2026-M01", claimCount: 2, costLineCount: 3 },
  inputRefs: [],
  outputs,
  refusals: outputs == null ? ["nothing could be computed"] : [],
  status: outputs == null ? "refused" : "computed",
  computedAt: "2026-12-01T00:00:00Z",
  computedBy: "planner@syncai.ca",
  ...over,
});

const liveEv = (over: Partial<CaseEarnedValue> = {}): CaseEarnedValue =>
  ({
    caseId: "c1",
    currency: "CAD",
    period: {
      id: "p1",
      periodRef: "2026-M01",
      periodEnd: "2026-01-31",
      status: "open",
      plannedPercentComplete: 20,
      index: 1,
    },
    bac: 1000,
    bacRefusal: null,
    costLineCount: 3,
    claimCount: 2,
    eacFormula: EAC_FORMULA,
    metrics: {
      ev: {
        label: "Earned value",
        unit: "currency",
        value: 200,
        refusal: null,
      },
      pv: {
        label: "Planned value",
        unit: "currency",
        value: 200,
        refusal: null,
      },
      ac: {
        label: "Actual cost",
        unit: "currency",
        value: null,
        refusal:
          "No cost line on this case carries an actual cost. That is nothing booked, not nothing spent.",
      },
      cpi: {
        label: "Cost performance index",
        unit: "ratio",
        value: null,
        refusal: "No cost performance index: actual cost is not available.",
      },
      spi: {
        label: "Schedule performance index",
        unit: "ratio",
        value: 1,
        refusal: null,
      },
      es: {
        label: "Earned schedule",
        unit: "periods",
        value: 1,
        refusal: null,
      },
      spit: {
        label: "Schedule performance index (time)",
        unit: "ratio",
        value: 1,
        refusal: null,
      },
      eac: {
        label: "Estimate at completion",
        unit: "currency",
        value: null,
        refusal:
          "No estimate at completion. This product computes EAC = BAC / CPI and there is no cost performance index.",
      },
      vac: {
        label: "Variance at completion",
        unit: "currency",
        value: null,
        refusal:
          "No variance at completion: the estimate at completion is unavailable.",
      },
    },
    claimedElements: [],
    estimateConfidence: {
      rating: null,
      band: "unrated",
      basisVersion: null,
      drivers: [],
      refusal: "No estimate basis is recorded on this case.",
    },
    caveats: [],
    refusals: [],
    evaluable: true,
    ...over,
  }) as CaseEarnedValue;

/* ───────────────────────────── vocabularies ──────────────────────────── */

describe("the vocabularies the spec fixes", () => {
  it("carries spec II.7's eight estimate-basis dimensions — eight, not seven", () => {
    // The spec paragraph asks seven questions; "Escalation and productivity
    // assumptions?" is two bases in one question and the register row says
    // eight. A list that silently became seven would drop a dimension from
    // the form and nobody would ever be asked for it again.
    expect(ESTIMATE_BASIS_DIMENSIONS).toHaveLength(8);
    expect(ESTIMATE_BASIS_DIMENSIONS.map((d) => d.field)).toContain(
      "escalation_basis",
    );
    expect(ESTIMATE_BASIS_DIMENSIONS.map((d) => d.field)).toContain(
      "productivity_basis",
    );
  });

  it("carries spec II.9's six independent cross-check sources", () => {
    expect(PROGRESS_EVIDENCE_SOURCES).toHaveLength(6);
    expect(PROGRESS_EVIDENCE_SOURCES.map((s) => s.value)).toEqual([
      "drawings_issued",
      "deliverables_accepted",
      "quantities_complete",
      "procurement_releases",
      "field_installation",
      "inspection_records",
    ]);
  });

  it("names the EAC formula in the constant every surface renders", () => {
    // The whole point of D5.05's EAC ruling is that the formula is stated on
    // the number. A constant that stopped saying which formula it is would
    // put an unlabelled forecast on every screen.
    expect(EAC_FORMULA).toContain("BAC / CPI");
  });

  it("lists all nine metrics of the suite", () => {
    expect(EARNED_VALUE_METRICS.map((m) => m.key)).toEqual([
      "ev",
      "pv",
      "ac",
      "cpi",
      "spi",
      "es",
      "spit",
      "eac",
      "vac",
    ]);
  });

  it("pins the five calculation keys this slice records", () => {
    expect([...PERFORMANCE_CALC_KEYS].sort()).toEqual([
      "case_earned_value",
      "case_estimate_confidence",
      "case_forecast_confidence",
      "case_performance_trend",
      "case_progress_integrity",
    ]);
  });
});

/* ─────────────────── metricDisplay: every refusal path ───────────────── */

describe("a metric is rendered from a recorded run or not at all", () => {
  it("with NO run, every metric refuses — the live read is never a fallback", () => {
    const live = liveEv();
    for (const m of EARNED_VALUE_METRICS) {
      const d = metricDisplay(m.key, live, undefined);
      expect(d.value, `${m.key} took a value from the live read`).toBeNull();
      expect(d.refusal).toContain(
        "No earned-value calculation has been recorded",
      );
      expect(d.fromRun).toBe(false);
    }
    // ...even for the metrics the LIVE read did produce. This is the exact
    // 4A failure — a figure with no lineage under a lineage block.
    expect(live.metrics.ev.value).toBe(200);
  });

  it("with a REFUSED run, every metric refuses rather than rendering blank", () => {
    const live = liveEv();
    const d = metricDisplay("cpi", live, run(null));
    expect(d.value).toBeNull();
    expect(d.refusal).not.toBeNull();
  });

  it("a metric absent from a computed run's outputs names the reason, not a blank", () => {
    // The run computed EV and PV and refused CPI. A blank cell where a CPI
    // belongs reads as 1.0 to anyone scanning the page.
    const live = liveEv();
    const d = metricDisplay(
      "cpi",
      live,
      run({ ev: 200, pv: 200, cpi: null, currency: "CAD" }),
    );
    expect(d.value).toBeNull();
    expect(d.refusal).toContain("No cost performance index");
  });

  it("refuses a non-finite recorded value instead of printing Infinity", () => {
    const live = liveEv();
    for (const bad of [Infinity, -Infinity, NaN]) {
      const d = metricDisplay("cpi", live, run({ cpi: bad }));
      expect(d.value).toBeNull();
      expect(d.refusal).not.toBeNull();
    }
  });

  it("names the metric when a run dropped it with no recorded reason", () => {
    const live = liveEv({
      metrics: {
        ...liveEv().metrics,
        cpi: { ...liveEv().metrics.cpi, refusal: null },
      },
    });
    const d = metricDisplay("cpi", live, run({ ev: 1 }));
    expect(d.refusal).toContain("no reason was recorded");
  });

  it("renders a recorded figure, and only from the run's own outputs", () => {
    const live = liveEv();
    const d = metricDisplay("ev", live, run({ ev: 175, currency: "CAD" }));
    expect(d.value).toBe(175);
    expect(d.refusal).toBeNull();
    expect(d.fromRun).toBe(true);
  });
});

describe("hasRunOutputs", () => {
  it("is false for a refused run, so a blank cannot stand in for a refusal", () => {
    expect(hasRunOutputs(run(null))).toBe(false);
    expect(hasRunOutputs(undefined)).toBe(false);
    expect(hasRunOutputs(run({ ev: 1 }))).toBe(true);
  });
});

/* ───────────────────────────── formatting ────────────────────────────── */

describe("a figure carries its unit or is not rendered as money", () => {
  it("says so when the currency was never established", () => {
    expect(formatPerformanceValue(1000, "currency", null)).toContain(
      "currency not established",
    );
    expect(formatPerformanceValue(1000, "currency", "")).toContain(
      "currency not established",
    );
  });

  it("renders no figure as words, never as a zero", () => {
    expect(formatPerformanceValue(null, "currency", "CAD")).toBe("no figure");
    expect(formatPerformanceValue(null, "ratio", null)).toBe("no figure");
  });

  it("keeps ratios and periods out of the money formatter", () => {
    expect(formatPerformanceValue(0.873, "ratio", "CAD")).toBe("0.873");
    expect(formatPerformanceValue(1, "periods", "CAD")).toBe("1.00 period");
    expect(formatPerformanceValue(2.5, "periods", null)).toBe("2.50 periods");
  });
});

/* ──────────────────────────── the headline ───────────────────────────── */

describe("the earned-value headline", () => {
  it("distinguishes 'nothing recorded' from 'the calculation refused'", () => {
    expect(earnedValueHeadline(liveEv(), undefined)).toContain(
      "No earned-value calculation has been recorded",
    );
    const refused = run(null, {
      refusals: ["No progress has been claimed in period 2026-M01."],
    });
    expect(earnedValueHeadline(liveEv(), refused)).toContain(
      "No progress has been claimed",
    );
  });

  it("names each missing index rather than omitting it", () => {
    const h = earnedValueHeadline(
      liveEv(),
      run({
        ev: 200,
        spi: 1,
        cpi: null,
        eac: null,
        currency: "CAD",
        periodRef: "2026-M01",
      }),
    );
    expect(h).toContain("no cost performance index");
    expect(h).toContain("no estimate at completion");
    expect(h).toContain("SPI 1.000");
    expect(h).toContain("2026-M01");
  });

  it("reports a refused run that recorded no reason as the defect it is", () => {
    expect(
      earnedValueHeadline(liveEv(), run(null, { refusals: [] })),
    ).toContain("recorded no reason");
  });
});

/* ──────────────────────── the confidence chip ────────────────────────── */

describe("unrated is not low", () => {
  it("prints a different word and a different tone for each", () => {
    expect(confidenceLabel("low")).toEqual({ text: "LOW", tone: "bad" });
    expect(confidenceLabel("unrated")).toEqual({
      text: "UNRATED",
      tone: "absent",
    });
    expect(confidenceLabel(null)).toEqual({ text: "UNRATED", tone: "absent" });
    expect(confidenceLabel(undefined)).toEqual({
      text: "UNRATED",
      tone: "absent",
    });
  });

  it("rates the two ends without inventing a middle", () => {
    expect(confidenceLabel("high").tone).toBe("good");
    expect(confidenceLabel("medium").tone).toBe("warn");
  });
});

/* ───────────────────── P50/P80: the fabrication guard ────────────────── */

describe("a percentile with no distribution behind it", () => {
  const refusal = "No probability distribution is recorded for this case.";

  it("renders as absent, with the reason, and never as a number", () => {
    const cell = percentileCell(null, refusal);
    expect(cell.available).toBe(false);
    expect(cell.text).toBe("not available");
    expect(cell.refusal).toBe(refusal);
  });

  it("treats an empty string as absent too", () => {
    expect(percentileCell("", refusal).available).toBe(false);
  });

  it("renders a real percentile when one exists, and drops the refusal", () => {
    // The shape 4C will use. It must exist so the honest-absence branch is
    // not the only branch and cannot rot into a hardcoded string.
    const cell = percentileCell(471_000_000, refusal);
    expect(cell.available).toBe(true);
    expect(cell.refusal).toBeNull();
  });
});

/* ────────────────────────────── staleness ────────────────────────────── */

describe("a run whose inputs have moved is stale", () => {
  it("is not stale when the fingerprint matches", () => {
    const live = liveEv();
    expect(
      performanceRunIsStale(
        run(
          { ev: 1 },
          {
            inputs: earnedValueFingerprint(live) as Record<string, unknown>,
          },
        ),
        earnedValueFingerprint(live),
      ),
    ).toBe(false);
  });

  it("is stale when a claim lands after the run was recorded", () => {
    const live = liveEv();
    const recorded = run(
      { ev: 1 },
      {
        inputs: earnedValueFingerprint(live) as Record<string, unknown>,
      },
    );
    const moved = earnedValueFingerprint(liveEv({ claimCount: 3 }));
    expect(performanceRunIsStale(recorded, moved)).toBe(true);
  });

  it("is stale when the planned curve moves under a recorded SPI", () => {
    const live = liveEv();
    const recorded = run(
      { spi: 1 },
      {
        inputs: earnedValueFingerprint(live) as Record<string, unknown>,
      },
    );
    const moved = earnedValueFingerprint(
      liveEv({ period: { ...live.period!, plannedPercentComplete: 45 } }),
    );
    expect(performanceRunIsStale(recorded, moved)).toBe(true);
  });

  it("is never stale when there is no run — absence is not staleness", () => {
    expect(performanceRunIsStale(undefined, { claimCount: 9 })).toBe(false);
  });

  it("ignores fingerprint keys the run never recorded", () => {
    const recorded = run({ ev: 1 }, { inputs: { claimCount: 2 } });
    expect(
      performanceRunIsStale(recorded, { claimCount: 2, somethingNew: 7 }),
    ).toBe(false);
  });

  it("the integrity fingerprint moves when evidence is added", () => {
    const base: CaseProgressIntegrity = {
      caseId: "c",
      period: {
        id: "p",
        periodRef: "M1",
        periodEnd: "2026-01-31",
        status: "open",
      },
      elements: [],
      claimedElementCount: 2,
      coveredElementCount: 0,
      coverage: 0,
      evidenceCount: 0,
      basisDigest: "d0",
      lowCount: 0,
      mediumCount: 0,
      highCount: 0,
      confidence: null,
      headline: null,
      bands: {},
      refusal: "nothing cross-checked",
    };
    expect(progressIntegrityFingerprint(base)).not.toEqual(
      progressIntegrityFingerprint({ ...base, evidenceCount: 1 }),
    );
  });
});

/* ─────────────────────── the integrity headline ──────────────────────── */

describe("the progress integrity headline", () => {
  const base: CaseProgressIntegrity = {
    caseId: "c",
    period: {
      id: "p",
      periodRef: "M1",
      periodEnd: "2026-01-31",
      status: "open",
    },
    elements: [],
    claimedElementCount: 3,
    coveredElementCount: 0,
    coverage: 0,
    evidenceCount: 0,
    basisDigest: "d0",
    lowCount: 0,
    mediumCount: 0,
    highCount: 0,
    confidence: null,
    headline: null,
    bands: {},
    refusal:
      "3 element(s) carry claimed progress and none has an independent observation: absence of evidence is not confirmation.",
  };

  it("prefers the refusal — an uncross-checked case must never read as verified", () => {
    expect(integrityHeadline(base)).toContain(
      "absence of evidence is not confirmation",
    );
  });

  it("renders the discrepancy sentence once a rating exists", () => {
    expect(
      integrityHeadline({
        ...base,
        refusal: null,
        confidence: "low",
        coveredElementCount: 3,
        coverage: 100,
        headline:
          "1.1 is reported 92 percent complete; only 71 of 100 deliverables are accepted (71 percent).",
      }),
    ).toContain("only 71 of 100");
  });
});

/* ──────────────────────────── the trend ──────────────────────────────── */

describe("a trend needs measured points", () => {
  const base: CasePerformanceTrend = {
    caseId: "c",
    points: [],
    gaps: [],
    periodCount: 0,
    recordedPointCount: 0,
    measuredPointCount: 0,
    refusedPointCount: 0,
    costTrend: null,
    costTrendRefusal: null,
    costTrendInterval: null,
    costTrendVolatility: null,
    scheduleTrend: null,
    scheduleTrendRefusal: null,
    scheduleTrendInterval: null,
    scheduleTrendVolatility: null,
    refusal: "No reporting period is recorded on this case.",
    basis: "recorded runs only",
  };

  it("returns the refusal rather than an empty direction", () => {
    expect(trendSentence(base)).toContain("No reporting period");
  });

  it("names the gaps rather than smoothing over them", () => {
    const s = trendSentence({
      ...base,
      refusal: null,
      measuredPointCount: 2,
      costTrend: "deteriorating",
      scheduleTrend: "flat",
      gaps: [
        {
          periodRef: "M2",
          periodEnd: "2026-02-28",
          kind: "not_computed",
          reason: "no run",
        },
      ],
    });
    expect(s).toContain("cost performance deteriorating");
    expect(s).toContain("1 period(s) carry no measured run");
  });
});

/* ──────────────── rule-of-credit authoring pre-flight ────────────────── */

describe("a rule of credit that does not add to the whole is refused", () => {
  it("refuses an empty rule", () => {
    expect(validateRuleSteps([])).toContain("at least one");
  });

  it("refuses weights that do not sum to 100 — the silent cap", () => {
    const problem = validateRuleSteps([
      { step: "IFR", weight: 30 },
      { step: "IFA", weight: 30 },
    ]);
    expect(problem).toContain("60 percent");
    expect(problem).toContain("not 100");
  });

  it("refuses a step with no label, a zero weight and a non-finite weight", () => {
    expect(validateRuleSteps([{ step: "x", weight: 100 }])).toContain(
      "no label",
    );
    expect(
      validateRuleSteps([
        { step: "Issued", weight: 0 },
        { step: "Complete", weight: 100 },
      ]),
    ).toContain("more than nothing");
    expect(
      validateRuleSteps([{ step: "Issued", weight: Number.NaN }]),
    ).toContain("no finite weight");
    expect(
      validateRuleSteps([{ step: "Issued", weight: Number.POSITIVE_INFINITY }]),
    ).toContain("no finite weight");
  });

  it("accepts a rule that adds to exactly 100", () => {
    expect(
      validateRuleSteps([
        { step: "Issued for review", weight: 30 },
        { step: "Issued for approval", weight: 30 },
        { step: "Issued for construction", weight: 40 },
      ]),
    ).toBeNull();
  });

  it("previews cumulative credit for the rule being typed", () => {
    expect(
      previewCumulativeCredit([
        { step: "a", weight: 30 },
        { step: "b", weight: 30 },
        { step: "c", weight: 40 },
      ]),
    ).toEqual([30, 60, 100]);
  });

  // WAS: "a non-finite weight contributes nothing rather than poisoning the
  // preview". That treated NaN as 0, so a rule containing NaN previewed a
  // ladder reaching a tidy 100 — the form showing a valid-looking convention
  // over an input the server refuses outright, which is a fabricated number
  // in the one place this slice renders one before the server sees it.
  it("propagates a non-finite weight rather than silently reading it as zero", () => {
    expect(
      previewCumulativeCredit([{ step: "a", weight: Number.NaN }]),
    ).toEqual([Number.NaN]);
    const ladder = previewCumulativeCredit([
      { step: "a", weight: 30 },
      { step: "b", weight: Number.NaN },
      { step: "c", weight: 70 },
    ]);
    expect(ladder[0]).toBe(30);
    expect(Number.isNaN(ladder[1])).toBe(true);
    // The tail is NaN too: a preview that recovered to 100 would say the rule
    // adds to the whole when it does not.
    expect(Number.isNaN(ladder[2])).toBe(true);
  });

  // The server sums in `numeric`, which is exact decimal. A float tolerance
  // disagreed with it at the boundary in both directions.
  it("agrees with the server's exact-decimal sum at the boundary", () => {
    expect(
      validateRuleSteps([
        { step: "one third", weight: 33.33 },
        { step: "one third", weight: 33.33 },
        { step: "one third", weight: 33.34 },
      ]),
    ).toBeNull();
    expect(
      validateRuleSteps([
        { step: "first third", weight: 33.33 },
        { step: "second third", weight: 33.33 },
        { step: "third third", weight: 33.33 },
      ]),
    ).toContain("not 100");
  });
});

/* ──────── the repairs the adversarial pass forced, each pinned ───────── */

describe("a metric's reason comes off the RUN, not off a live read that moved on", () => {
  it("finds the label-prefixed refusal the calculation recorded", () => {
    // The run computed nothing for EAC and RECORDED why. The live read has
    // since moved on and has a value, so its per-metric refusal is null: the
    // old code fell through to "no reason was recorded" and told the reader
    // the lineage ledger was broken while the reason sat one field away.
    const recorded = run(
      { cpi: 0, currency: "CAD", periodRef: "2026-M01" },
      {
        status: "computed_with_refusals",
        refusals: [
          "Estimate at completion: The cost performance index is zero, so BAC / CPI is undefined.",
        ],
      },
    );
    const d = metricDisplay("eac", liveEv(), recorded);
    expect(d.value).toBeNull();
    expect(d.refusal).toBe(
      "The cost performance index is zero, so BAC / CPI is undefined.",
    );
    expect(d.refusal).not.toContain("no reason was recorded");
  });

  it("still says so when the run genuinely recorded no reason", () => {
    const recorded = run({ cpi: 1, currency: "CAD" }, { refusals: [] });
    const bare = liveEv();
    bare.metrics.eac = {
      label: "Estimate at completion",
      unit: "currency",
      value: null,
      refusal: null,
    };
    expect(metricDisplay("eac", bare, recorded).refusal).toContain(
      "no reason was recorded",
    );
  });
});

describe("the staleness fingerprint can see a changed AMOUNT, not only a changed count", () => {
  it("moves when the cost basis digest moves and every count is identical", () => {
    const before = liveEv({ basisDigest: "aaa" });
    const after = liveEv({ basisDigest: "bbb" });
    const recorded = run(
      { cpi: 1.2 },
      { inputs: earnedValueFingerprint(before) as Record<string, unknown> },
    );
    expect(
      performanceRunIsStale(recorded, earnedValueFingerprint(before)),
    ).toBe(false);
    // Same periodRef, same claimCount, same costLineCount, same planned
    // percent, same band — a revised `actual` changes none of them.
    expect(earnedValueFingerprint(after).claimCount).toEqual(
      earnedValueFingerprint(before).claimCount,
    );
    expect(performanceRunIsStale(recorded, earnedValueFingerprint(after))).toBe(
      true,
    );
  });

  it("gives the forecast section and the estimate confidence a fingerprint at all", () => {
    const fc = {
      cost: {
        costLineCount: 4,
        recordedForecastLineCount: 2,
      },
      schedule: { activityCount: 7, activitiesWithDurationRange: 3 },
      estimateConfidence: { band: "low" },
    } as unknown as ForecastConfidence;
    const printed = forecastConfidenceFingerprint(fc);
    expect(printed).toMatchObject({ costLineCount: 4, activityCount: 7 });
    const moved = forecastConfidenceFingerprint({
      ...fc,
      cost: { ...fc.cost, costLineCount: 5 },
    } as ForecastConfidence);
    const recorded = run({ costDeterministic: 1 }, { inputs: printed });
    expect(performanceRunIsStale(recorded, printed)).toBe(false);
    expect(performanceRunIsStale(recorded, moved)).toBe(true);

    const basis = {
      confidence: { basisVersion: 2 },
      current: {
        estimateClass: "class_3",
        scopeMaturity: "feed",
        quantityBasedPercent: 60,
        quotationSupport: "budgetary",
      },
    } as unknown as CaseEstimateBasis;
    expect(estimateConfidenceFingerprint(basis)).toMatchObject({
      basisVersion: 2,
      estimateClass: "class_3",
    });
  });

  it("uses ONE definition of evidenceCount, taken from the read", () => {
    const base: CaseProgressIntegrity = {
      caseId: "c",
      period: {
        id: "p",
        periodRef: "M1",
        periodEnd: "2026-01-31",
        status: "open",
      },
      elements: [],
      claimedElementCount: 2,
      coveredElementCount: 1,
      coverage: 50,
      evidenceCount: 2,
      basisDigest: "d1",
      lowCount: 0,
      mediumCount: 0,
      highCount: 1,
      confidence: "high",
      headline: "h",
      bands: {},
      refusal: null,
    };
    const recorded = run(
      { confidence: "high" },
      { inputs: progressIntegrityFingerprint(base) },
    );
    // A run recorded one second ago is NOT stale. It used to be, for ever,
    // because the surface re-derived evidenceCount by summing sourceCount
    // over claimed elements while the run counted all evidence in the period.
    expect(
      performanceRunIsStale(recorded, progressIntegrityFingerprint(base)),
    ).toBe(false);
    expect(
      performanceRunIsStale(
        recorded,
        progressIntegrityFingerprint({ ...base, evidenceCount: 3 }),
      ),
    ).toBe(true);
  });
});

describe("a confidence band never travels without its coverage", () => {
  it("names the fraction the rating covers", () => {
    expect(coverageSuffix(50, 1, 2)).toBe(
      "over 1 of 2 claimed element(s) (50%)",
    );
    expect(coverageSuffix(100, 4, 4)).toBe("over all 4 claimed element(s)");
    expect(coverageSuffix(null, null, null)).toBeNull();
  });
});

describe("a rounded figure is not presented as an exact one", () => {
  it("marks a money figure the display rounded", () => {
    expect(formatPerformanceValue(0.4, "currency", "CAD")).toBe("0.4 CAD");
    expect(formatPerformanceValue(1234.56, "currency", "CAD")).toBe(
      "1,234.56 CAD",
    );
    expect(formatPerformanceValue(1234.567, "currency", "CAD")).toContain("≈");
    expect(formatPerformanceValue(50000, "currency", "CAD")).toBe("50,000 CAD");
  });

  it("marks a ratio the display rounded, so it cannot read as a true zero", () => {
    expect(formatPerformanceValue(0, "ratio", null)).toBe("0.000");
    expect(formatPerformanceValue(0.0004, "ratio", null)).toBe("≈0.000");
    expect(formatPerformanceValue(1.2, "ratio", null)).toBe("1.200");
  });
});

describe("the trend sentence names what it cannot say", () => {
  const base: CasePerformanceTrend = {
    caseId: "c",
    points: [],
    gaps: [],
    periodCount: 3,
    recordedPointCount: 3,
    measuredPointCount: 3,
    refusedPointCount: 0,
    costTrend: null,
    costTrendRefusal: null,
    costTrendInterval: null,
    costTrendVolatility: null,
    scheduleTrend: null,
    scheduleTrendRefusal: null,
    scheduleTrendInterval: null,
    scheduleTrendVolatility: null,
    refusal: null,
    basis: "recorded runs only",
  };

  it("does not silently omit a missing cost direction", () => {
    const s = trendSentence({
      ...base,
      scheduleTrend: "improving",
      scheduleTrendInterval: "M2 to M3",
      costTrendRefusal:
        "No cost performance direction: the recorded runs do not carry a cost performance index at two consecutive measured periods, so there is no interval to take a direction across.",
    });
    expect(s).toContain("schedule performance improving");
    expect(s).toContain("No cost performance direction");
  });

  it("says a direction is the LAST INTERVAL and flags a series that changed direction", () => {
    const s = trendSentence({
      ...base,
      costTrend: "improving",
      costTrendInterval: "M2 to M3",
      costTrendVolatility:
        "The cost performance index changes direction 1 time(s) across the recorded series, so no single word describes it — the direction above is the last interval only.",
    });
    expect(s).toContain("by the last interval");
    expect(s).toContain("(M2 to M3)");
    expect(s).toContain("changes direction 1 time(s)");
  });

  it("gives the trend a fingerprint so its run can be shown as stale", () => {
    const printed = performanceTrendFingerprint(base);
    const recorded = run({ costTrend: "flat" }, { inputs: printed });
    expect(performanceRunIsStale(recorded, printed)).toBe(false);
    expect(
      performanceRunIsStale(
        recorded,
        performanceTrendFingerprint({ ...base, measuredPointCount: 4 }),
      ),
    ).toBe(true);
  });
});

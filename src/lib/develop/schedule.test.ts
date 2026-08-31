/**
 * Sync Develop Slice 4C — the presentation helpers, under test.
 *
 * These are the last line between a recorded figure and a reader, and every
 * one of the cases below reached a screen during adversarial review:
 * "9999900%" under the heading "On plan", "NaN%" beside it, "on the critical
 * path in 4200% of runs" under a heading claiming the simulation ranked it,
 * an unlabelled "419,851" of expected economic exposure on a forecast, and a
 * §50 score of 100 with no stale label on a schedule the diagnosis had since
 * failed.
 *
 * The server refuses each of those at the door and at the column now. These
 * assertions are the second line: a surface helper that renders whatever it
 * is handed is one schema change away from printing it again.
 */
import { describe, expect, it } from "vitest";
import {
  SCHEDULE_SIMULATION_POLICY,
  attributionSentence,
  criticalityPercent,
  overrunDays,
  probabilityPercent,
  scheduleQualityFingerprint,
  simulationIsCurrent,
  type CaseScheduleQuality,
  type SimulationAttributionRow,
} from "./schedule";

const row = (
  over: Partial<SimulationAttributionRow> = {},
): SimulationAttributionRow => ({
  riskId: "r1",
  riskTitle: "Compressor delivery slips",
  activityId: "a1",
  occurrenceRate: 0.4,
  p80HoursContribution: 148.8,
  p80DaysContribution: 6.2,
  meanCostContribution: 419_850.88,
  p80CostContribution: 600_000,
  reason: "measured marginally",
  ...over,
});

describe("a share of the run is rendered as a share, or not at all", () => {
  it("renders a probability in range", () => {
    expect(probabilityPercent(0.406)).toBe("41%");
    expect(probabilityPercent(0)).toBe("0%");
    expect(probabilityPercent(1)).toBe("100%");
  });

  it("refuses a value outside [0,1] rather than printing 9999900%", () => {
    expect(probabilityPercent(99999)).toBeNull();
    expect(probabilityPercent(42)).toBeNull();
    expect(probabilityPercent(-0.1)).toBeNull();
  });

  it("refuses a non-finite value, including the STRING 'NaN' Postgres emits", () => {
    // `to_jsonb` of a numeric NaN is the JSON string "NaN", so the declared
    // `number | null` type was wrong and `x * 100` rendered "NaN%".
    expect(probabilityPercent("NaN")).toBeNull();
    expect(probabilityPercent(Number.NaN)).toBeNull();
    expect(probabilityPercent(Number.POSITIVE_INFINITY)).toBeNull();
    expect(probabilityPercent(null)).toBeNull();
    expect(probabilityPercent(undefined)).toBeNull();
  });

  it("the criticality index is held to the same range", () => {
    expect(criticalityPercent(0.75)).toBe("75%");
    expect(criticalityPercent(7.5)).toBeNull();
    expect(criticalityPercent(42)).toBeNull();
  });
});

describe("money on a forecast carries its unit or says it has none", () => {
  it("states the currency when there is one", () => {
    expect(attributionSentence(row(), "USD")).toContain("USD 419,851");
  });

  it("never prints a bare number when the currency is unknown", () => {
    // The sibling helper `formatPerformanceValue` already refuses this way;
    // this one used to drop the unit silently, so a live run with a null
    // currency rendered "and 419,851 of expected economic exposure".
    for (const c of [null, undefined, "", "   "]) {
      const s = attributionSentence(row(), c);
      expect(s).toContain("419,851 (currency not established)");
    }
  });

  it("omits the money half entirely when nothing was costed", () => {
    const s = attributionSentence(row({ meanCostContribution: null }), "USD");
    expect(s).toContain("The economic half is absent");
    expect(s).not.toContain("USD");
  });
});

describe("the quality fingerprint can see a defect change", () => {
  const quality = (over: Partial<CaseScheduleQuality> = {}) =>
    ({
      activityCount: 5,
      relationshipCount: 5,
      activitiesWithFloat: 0,
      activitiesWithPlannedDates: 5,
      activitiesWithDurationRange: 5,
      activitiesWithWbs: 0,
      acceptedImportRuns: 0,
      classSignature: {
        long_durations: "pass:0/5",
        excessive_concurrency: "pass:0/5",
      },
      ...over,
    }) as unknown as CaseScheduleQuality;

  it("carries the class signature, not only the seven counts", () => {
    expect(scheduleQualityFingerprint(quality())).toHaveProperty(
      "classSignature",
    );
  });

  it("moves when the diagnosis changes and no count does", () => {
    // Proven live: `duration_hours := 2000` on every activity took the score
    // from 100 to 81.3 and closed the gate while all seven counts matched, so
    // the panel kept printing "§50 Schedule Quality Score 100" as current.
    const before = scheduleQualityFingerprint(quality());
    const after = scheduleQualityFingerprint(
      quality({
        classSignature: {
          long_durations: "fail:5/5",
          excessive_concurrency: "fail:5/5",
        },
      } as Partial<CaseScheduleQuality>),
    );
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
    // ...and every count is genuinely unchanged, which is the point.
    for (const k of [
      "activityCount",
      "relationshipCount",
      "activitiesWithFloat",
      "activitiesWithPlannedDates",
      "activitiesWithDurationRange",
      "activitiesWithWbs",
      "acceptedImportRuns",
    ]) {
      expect(before[k]).toBe(after[k]);
    }
  });
});

describe("the published simulation policy is mirrored, not re-invented", () => {
  it("pins a kernel version list rather than accepting free text", () => {
    expect(SCHEDULE_SIMULATION_POLICY.kernelVersions.length).toBeGreaterThan(0);
    for (const v of SCHEDULE_SIMULATION_POLICY.kernelVersions) {
      expect(v).toMatch(/^integrated-risk\//);
    }
  });

  it("bounds the criticality array a client may write to an immutable ledger", () => {
    expect(SCHEDULE_SIMULATION_POLICY.maximumCriticalityRows).toBeGreaterThan(
      0,
    );
  });
});

describe("staleness and unit conversion stay honest", () => {
  it("a run that is not current is not current", () => {
    expect(simulationIsCurrent({ exists: true, current: false } as never)).toBe(
      false,
    );
    expect(simulationIsCurrent(undefined)).toBe(false);
  });

  it("overrun is null rather than zero when either end is missing", () => {
    // `?? 0` printed "0.0 day(s) of overrun" — i.e. NO overrun — for an
    // unknown, which is the most reassuring possible rendering of an absence.
    expect(overrunDays(null, 100)).toBeNull();
    expect(overrunDays(120, null)).toBeNull();
    expect(overrunDays(Number.NaN, 100)).toBeNull();
    expect(overrunDays(124, 100)).toBeCloseTo(1);
  });
});

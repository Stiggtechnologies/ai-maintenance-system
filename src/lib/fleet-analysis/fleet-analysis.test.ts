/**
 * Validation for scoping analysis.
 *
 * The fixtures reproduce the shapes that actually appeared in the auxiliary
 * fleet: a count-versus-hours inversion, delay events that are not failures,
 * unit numbers reused across equipment types, and rebuilds long enough to look
 * like errors. If the analysis cannot reach the conclusions I reached by hand
 * on that file, it is not ready to put in front of a prospect.
 */
import { describe, expect, it } from "vitest";
import { analyseFleet, type AnalysisRow } from "./index";

const d = (iso: string) => new Date(iso);
function row(
  asset: string,
  reason: string,
  kind: AnalysisRow["kind"],
  startIso: string,
  hours: number,
  assetClass?: string,
): AnalysisRow {
  const start = d(startIso);
  return {
    asset,
    assetClass,
    reason,
    kind,
    hours,
    start,
    end: new Date(start.getTime() + hours * 3_600_000),
  };
}

/** Many short GET events, few long undercarriage events — the real inversion. */
function fleet(): AnalysisRow[] {
  const rows: AnalysisRow[] = [];
  for (let i = 0; i < 60; i++)
    rows.push(
      row(
        "Dozer 5301",
        "GROUND ENGAGING TOOL",
        "system_group",
        `2010-0${(i % 9) + 1}-0${(i % 9) + 1}T06:00:00Z`,
        6,
        "Dozer",
      ),
    );
  for (let i = 0; i < 6; i++)
    rows.push(
      row(
        "Dozer 5302",
        "UNDERCARRIAGE",
        "system_group",
        `2011-0${i + 1}-15T06:00:00Z`,
        70,
        "Dozer",
      ),
    );
  for (let i = 0; i < 8; i++)
    rows.push(
      row(
        "Grader 7203",
        "WAIT PARTS",
        "delay_reason",
        `2011-0${i + 1}-20T06:00:00Z`,
        62,
        "Grader",
      ),
    );
  for (let i = 0; i < 5; i++)
    rows.push(
      row(
        "Grader 7203",
        "PLANNED MAINTENANCE",
        "activity_type",
        `2012-0${i + 1}-02T06:00:00Z`,
        8,
        "Grader",
      ),
    );
  return rows;
}

describe("scoping analysis", () => {
  it("aggregates the Pareto by reason rather than listing every event", () => {
    const f = analyseFleet(fleet());
    // 66 corrective events across exactly two reasons.
    expect(f.byHours.length).toBe(2);
    expect(f.correctiveEvents).toBe(66);
  });

  it("catches the count-versus-hours inversion that misdirects a programme", () => {
    const f = analyseFleet(fleet());
    expect(f.byHours[0].label).toBe("UNDERCARRIAGE"); // 420 h from 6 events
    expect(f.byCount[0].label).toBe("GROUND ENGAGING TOOL"); // 60 events, 6 h each
    expect(f.rankingInverts).toBe(true);
    expect(f.byCount[0].meanHours).toBe(6);
    expect(f.byHours[0].meanHours).toBe(70);
  });

  it("counts delay as delay, never as a failure", () => {
    const f = analyseFleet(fleet());
    expect(f.delayEvents).toBe(8);
    expect(f.delayHours).toBe(496);
    // 8 wait events must not appear in the corrective Pareto at all.
    expect(f.byHours.map((x) => x.label)).not.toContain("WAIT PARTS");
    expect(f.correctiveEvents).toBe(66);
    expect(f.delaySharePct).toBeGreaterThan(0);
  });

  it("reports the delay share of total downtime", () => {
    const f = analyseFleet(fleet());
    // 496 delay hours of 1,316 total = 37.7%
    expect(f.totalDownHours).toBe(1316);
    expect(f.delaySharePct).toBeCloseTo(37.7, 1);
  });

  it("ranks worst assets by downtime, not by event count", () => {
    const f = analyseFleet(fleet());
    expect(f.worstAssets[0].asset).toBe("Dozer 5302"); // 420 h from 6
    expect(f.worstAssets[0].failures).toBe(6);
    expect(f.worstAssets[1].asset).toBe("Dozer 5301"); // 360 h from 60
  });

  it("flags unit numbers reused across equipment types as serious", () => {
    const rows = [
      row(
        "Dozer 5301",
        "ENGINE GROUP",
        "system_group",
        "2010-01-01T00:00:00Z",
        5,
        "Dozer",
      ),
      row(
        "Support Dozer 5301",
        "ENGINE GROUP",
        "system_group",
        "2010-02-01T00:00:00Z",
        5,
        "Support Dozer",
      ),
    ];
    const f = analyseFleet(rows);
    const flag = f.dataQuality.find((x) => x.kind.includes("reused"));
    expect(flag?.severity).toBe("serious");
    expect(flag?.detail).toContain("5301");
  });

  it("flags overlapping down windows as impossible", () => {
    const rows = [
      row(
        "Dozer 1",
        "ENGINE GROUP",
        "system_group",
        "2010-01-01T00:00:00Z",
        48,
        "Dozer",
      ),
      row(
        "Dozer 1",
        "HYDRAULIC SYSTEM",
        "system_group",
        "2010-01-02T00:00:00Z",
        5,
        "Dozer",
      ),
    ];
    const f = analyseFleet(rows);
    const flag = f.dataQuality.find((x) => x.kind.includes("Overlapping"));
    expect(flag?.severity).toBe("serious");
  });

  it("treats a very long event as worth confirming, not as an error to trim", () => {
    const rows = [
      ...fleet(),
      row(
        "Dozer 5547",
        "UNDERCARRIAGE",
        "system_group",
        "2010-02-08T00:00:00Z",
        19235,
        "Dozer",
      ),
    ];
    const f = analyseFleet(rows);
    const flag = f.dataQuality.find((x) => x.kind.includes("2,000 hours"));
    expect(flag?.severity).toBe("info");
    expect(flag?.detail).toMatch(/rebuild is real downtime/i);
  });

  it("excludes unclassified codes from the Pareto and says so", () => {
    const rows = [
      ...fleet(),
      row(
        "Dozer 5301",
        "ICE LUGS",
        "unclassified",
        "2011-06-01T00:00:00Z",
        9,
        "Dozer",
      ),
    ];
    const f = analyseFleet(rows);
    expect(f.byHours.map((x) => x.label)).not.toContain("ICE LUGS");
    expect(
      f.dataQuality.find((x) => x.kind.includes("Unclassified"))?.count,
    ).toBe(1);
  });

  it("caveats a thin sample instead of presenting it as a ranking", () => {
    const rows = [
      row(
        "Dozer 1",
        "ENGINE GROUP",
        "system_group",
        "2010-01-01T00:00:00Z",
        5,
        "Dozer",
      ),
      row(
        "Dozer 1",
        "ENGINE GROUP",
        "system_group",
        "2010-01-05T00:00:00Z",
        5,
        "Dozer",
      ),
    ];
    const f = analyseFleet(rows);
    expect(f.caveats.join(" ")).toMatch(/too few for a bad-actor ranking/i);
    expect(f.caveats.join(" ")).toMatch(/seasonal/i);
  });

  it("always states the basis of the availability figure", () => {
    const f = analyseFleet(fleet());
    expect(f.caveats.join(" ")).toMatch(
      /calendar time in the file, not against a production plan/i,
    );
  });

  it("returns an empty, honest result rather than throwing on no rows", () => {
    const f = analyseFleet([]);
    expect(f.events).toBe(0);
    expect(f.caveats).toEqual(["No rows to analyse."]);
  });
});

/**
 * Scoping analysis — findings from a file, with nothing persisted.
 *
 * A prospect will hand over a spreadsheet long before they hand over a CMMS
 * connection. Until now the only way to analyse one was to IMPORT it, which
 * creates sites, assets, work orders and states in the operational estate —
 * asking someone to onboard equipment they have not decided to onboard, just
 * to find out whether the analysis is any good.
 *
 * So this computes findings from parsed rows and writes nothing. The whole
 * module is pure, like the reliability and lifecycle engines it sits beside:
 * no database, no network. The data does not leave the browser, which is both
 * the honest privacy answer and the reason no governance question has to be
 * settled before someone can see whether the product is worth buying.
 *
 * Every finding carries its basis and its sample size. A Pareto over eleven
 * events is not a bad-actor list, and saying so is what stops a scoping
 * exercise from becoming a bad decision.
 */
import { repairableSummary, pareto } from "../reliability";

export interface AnalysisRow {
  asset: string;
  assetClass?: string;
  start: Date;
  end: Date;
  hours: number;
  reason: string;
  kind: "system_group" | "activity_type" | "delay_reason" | "unclassified";
}

export interface ParetoFinding {
  label: string;
  events: number;
  hours: number;
  hoursShare: number;
  meanHours: number;
}

export interface AssetFinding {
  asset: string;
  assetClass?: string;
  failures: number;
  downtimeHours: number;
  mtbfHours: number | null;
  mttrHours: number | null;
  availabilityPct: number | null;
}

export interface DataQualityFlag {
  kind: string;
  count: number;
  detail: string;
  severity: "info" | "warning" | "serious";
}

export interface ScopingFindings {
  events: number;
  assets: number;
  spanDays: number;
  totalDownHours: number;
  correctiveEvents: number;
  plannedEvents: number;
  delayEvents: number;
  delayHours: number;
  delaySharePct: number;
  byHours: ParetoFinding[];
  byCount: ParetoFinding[];
  /** True when ranking by count would point at a different problem than hours. */
  rankingInverts: boolean;
  worstAssets: AssetFinding[];
  dataQuality: DataQualityFlag[];
  caveats: string[];
}

const DAY = 86_400_000;

export function analyseFleet(rows: AnalysisRow[]): ScopingFindings {
  const caveats: string[] = [];
  if (rows.length === 0) {
    return {
      events: 0,
      assets: 0,
      spanDays: 0,
      totalDownHours: 0,
      correctiveEvents: 0,
      plannedEvents: 0,
      delayEvents: 0,
      delayHours: 0,
      delaySharePct: 0,
      byHours: [],
      byCount: [],
      rankingInverts: false,
      worstAssets: [],
      dataQuality: [],
      caveats: ["No rows to analyse."],
    };
  }

  const start = Math.min(...rows.map((r) => r.start.getTime()));
  const end = Math.max(...rows.map((r) => r.end.getTime()));
  const spanDays = Math.max((end - start) / DAY, 1);
  const totalDownHours = rows.reduce((s, r) => s + r.hours, 0);

  const corrective = rows.filter((r) => r.kind === "system_group");
  const planned = rows.filter((r) => r.kind === "activity_type");
  const delays = rows.filter((r) => r.kind === "delay_reason");
  const delayHours = delays.reduce((s, r) => s + r.hours, 0);

  // Pareto two ways. The auxiliary fleet showed why both are needed: ground
  // engaging tools led on COUNT at 2,708 events but averaged six hours, while
  // undercarriage led on HOURS at 32,394 from 458 events. Ranking by count
  // aims the programme at a planning problem while the reliability problem
  // sits elsewhere.
  // pareto() ranks items; it does NOT group them. Aggregating by reason first
  // is the difference between a ten-line Pareto and 8,504 sorted events.
  const eventsByReason = new Map<string, number>();
  const hoursByReason = new Map<string, number>();
  for (const r of corrective) {
    eventsByReason.set(r.reason, (eventsByReason.get(r.reason) ?? 0) + 1);
    hoursByReason.set(r.reason, (hoursByReason.get(r.reason) ?? 0) + r.hours);
  }
  const hourAgg = pareto(
    [...hoursByReason].map(([key, value]) => ({ key, value })),
  );
  const countAgg = pareto(
    [...eventsByReason].map(([key, value]) => ({ key, value })),
  );
  const toFinding = (key: string): ParetoFinding => {
    const events = eventsByReason.get(key) ?? 0;
    const hours = hoursByReason.get(key) ?? 0;
    const correctiveHours = corrective.reduce((s, r) => s + r.hours, 0);
    return {
      label: key,
      events,
      hours: round(hours, 1),
      hoursShare:
        correctiveHours > 0 ? round((100 * hours) / correctiveHours, 1) : 0,
      meanHours: events > 0 ? round(hours / events, 1) : 0,
    };
  };
  const byHours = hourAgg.slice(0, 10).map((p) => toFinding(String(p.key)));
  const byCount = countAgg.slice(0, 10).map((p) => toFinding(String(p.key)));
  const rankingInverts =
    byHours.length > 0 &&
    byCount.length > 0 &&
    byHours[0].label !== byCount[0].label;

  // Per-asset reliability, using the same repairable arithmetic the platform
  // uses everywhere else rather than a second definition invented here.
  const perAsset = new Map<string, { cls?: string; downs: number[] }>();
  for (const r of corrective) {
    const e = perAsset.get(r.asset) ?? { cls: r.assetClass, downs: [] };
    e.downs.push(r.hours);
    perAsset.set(r.asset, e);
  }
  const calendarHours = spanDays * 24;
  const worstAssets: AssetFinding[] = [...perAsset.entries()]
    .map(([asset, e]) => {
      const s = repairableSummary(e.downs, calendarHours);
      return {
        asset,
        assetClass: e.cls,
        failures: e.downs.length,
        downtimeHours: round(
          e.downs.reduce((a, b) => a + b, 0),
          1,
        ),
        mtbfHours: finite(s.mtbfHours),
        mttrHours: finite(s.mttrHours),
        availabilityPct:
          finite(s.availability) === null
            ? null
            : round(s.availability * 100, 1),
      };
    })
    .sort((a, b) => b.downtimeHours - a.downtimeHours)
    .slice(0, 15);

  // Data quality, checked the way it was checked by hand on the real fleet.
  const dataQuality: DataQualityFlag[] = [];
  const zero = rows.filter((r) => r.hours <= 0).length;
  if (zero > 0)
    dataQuality.push({
      kind: "Zero-length events",
      count: zero,
      severity: "warning",
      detail:
        "Events with no duration cannot contribute to MTTR or availability.",
    });

  const long = rows.filter((r) => r.hours > 2000).length;
  if (long > 0)
    dataQuality.push({
      kind: "Events over 2,000 hours",
      count: long,
      severity: "info",
      detail:
        "Usually legitimate rebuilds or a unit parked rather than repaired. Worth confirming rather than trimming — a rebuild is real downtime.",
    });

  const overlaps = countOverlaps(rows);
  if (overlaps > 0)
    dataQuality.push({
      kind: "Overlapping down windows",
      count: overlaps,
      severity: "serious",
      detail:
        "Two simultaneous down states on one machine is impossible; the source is double-counting downtime.",
    });

  const dupUnits = duplicateUnitsAcrossClasses(rows);
  if (dupUnits.length > 0)
    dataQuality.push({
      kind: "Unit numbers reused across equipment types",
      count: dupUnits.length,
      severity: "serious",
      detail: `e.g. ${dupUnits.slice(0, 3).join(", ")}. Keying assets on the number alone would merge distinct machines.`,
    });

  const unclassified = rows.filter((r) => r.kind === "unclassified").length;
  if (unclassified > 0)
    dataQuality.push({
      kind: "Unclassified reason codes",
      count: unclassified,
      severity: "warning",
      detail:
        "Events whose code was not recognised as equipment, activity or delay. They are excluded from the Pareto rather than counted as failures.",
    });

  if (corrective.length < 30)
    caveats.push(
      `Only ${corrective.length} corrective events — too few for a bad-actor ranking to be stable.`,
    );
  if (spanDays < 180)
    caveats.push(
      `The file covers ${Math.round(spanDays)} days; seasonal effects will not be visible.`,
    );
  if (perAsset.size > 0 && corrective.length / perAsset.size < 3)
    caveats.push(
      "Fewer than three corrective events per asset on average — per-asset MTBF is indicative only.",
    );
  caveats.push(
    "Availability is calculated against calendar time in the file, not against a production plan or planned-run hours.",
  );

  return {
    events: rows.length,
    assets: new Set(rows.map((r) => r.asset)).size,
    spanDays: Math.round(spanDays),
    totalDownHours: round(totalDownHours, 0),
    correctiveEvents: corrective.length,
    plannedEvents: planned.length,
    delayEvents: delays.length,
    delayHours: round(delayHours, 0),
    delaySharePct:
      totalDownHours > 0 ? round((100 * delayHours) / totalDownHours, 1) : 0,
    byHours,
    byCount,
    rankingInverts,
    worstAssets,
    dataQuality,
    caveats,
  };
}

function countOverlaps(rows: AnalysisRow[]): number {
  const byAsset = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    const a = byAsset.get(r.asset) ?? [];
    a.push(r);
    byAsset.set(r.asset, a);
  }
  let n = 0;
  for (const list of byAsset.values()) {
    const sorted = [...list].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start.getTime() < sorted[i - 1].end.getTime()) n += 1;
    }
  }
  return n;
}

function duplicateUnitsAcrossClasses(rows: AnalysisRow[]): string[] {
  const byUnit = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.assetClass) continue;
    // The unit token is the trailing number on the asset label.
    const m = /(\d[\w-]*)\s*$/.exec(r.asset);
    if (!m) continue;
    const s = byUnit.get(m[1]) ?? new Set<string>();
    s.add(r.assetClass);
    byUnit.set(m[1], s);
  }
  return [...byUnit.entries()].filter(([, c]) => c.size > 1).map(([u]) => u);
}

const round = (v: number, dp: number) => Number(v.toFixed(dp));
const finite = (v: number) =>
  Number.isFinite(v) ? Number(v.toFixed(1)) : null;

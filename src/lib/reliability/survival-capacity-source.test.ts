import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coxCapacityInput } from "./fixtures/cox-capacity-input";
import witness from "./fixtures/cox-capacity-reference.json";
import { fitCox } from "./cox";
import {
  prepareSurvivalCensus,
  SURVIVAL_CENSUS_VERSION,
  type SurvivalCensus,
  type SurvivalSourceEvent,
} from "./survival-source";

// Pure source-preparation fixture only. These explicit synthetic approval and
// evidence fields are NOT receipts from the database or real customer reviews.
// Actual capture/review/ledger and browser acceptance remain separate gates.
function capacityCensus() {
  const input = coxCapacityInput();
  const covariates = input.covariateNames.map((name) => ({
    name,
    unit: "ratio",
  }));
  const calendarTime = (hours: number) =>
    new Date(
      Date.parse("2026-08-01T00:00:00Z") + hours * 2 * 3_600_000,
    ).toISOString();
  const events: SurvivalSourceEvent[] = input.clusters.map(
    ([lifeRef, assetId], index) => {
      const intervals = input.rows.slice(index * 2, index * 2 + 2);
      const terminal = intervals[1];
      const terminalObservedAt = calendarTime(terminal.stop);
      return {
        id: index + 1,
        assetId,
        component: "Synthetic capacity component",
        hoursAtChangeOut: terminal.stop,
        eventKind: terminal.failed ? "failure" : "scheduled",
        eventDate: terminalObservedAt.slice(0, 10),
        overlayVersion: 1,
        overlayStatus: "validated",
        overlayAuthor: "synthetic-author-only",
        overlayReviewer: "synthetic-independent-reviewer-only",
        sourceCurrent: true,
        approvalCurrent: true,
        approvalId: `synthetic-approval-${index}`,
        overlay: {
          mode: "include",
          basis:
            "Explicit synthetic source-preparation qualification, not actual database approval.",
          lifeRef,
          stratum: terminal.stratum,
          entryHours: intervals[0].start,
          serviceStartedAt: calendarTime(0),
          terminalObservedAt,
          intervals: intervals.map((row, piece) => ({
            startHours: row.start,
            stopHours: row.stop,
            startedAt: calendarTime(row.start),
            endedAt: calendarTime(row.stop),
            values: covariates.map((covariate, j) => ({
              ...covariate,
              value: row.covariates[j],
              evidenceItemId: `synthetic-evidence-${index}-${piece}`,
              observedAtHours: row.observedAt,
              availableAtHours: row.observedAt,
              validThroughHours: row.stop,
              observedAt: calendarTime(row.observedAt),
              availableAt: calendarTime(row.observedAt),
            })),
          })),
        },
      };
    },
  );
  const source: SurvivalCensus = {
    sourceVersion: SURVIVAL_CENSUS_VERSION,
    component: "Synthetic capacity component",
    events,
    activeInstances: [],
    removedInstances: [],
    populationGaps: [],
  };
  return { input, covariates, source };
}

describe("complete maximum-boundary source preparation, not database acceptance", () => {
  it("preserves every interval, physical life, asset cluster, condition and censoring fact", () => {
    const { input, covariates, source } = capacityCensus();
    const prepared = prepareSurvivalCensus(source, covariates);
    expect(prepared.gaps).toEqual([]);
    expect(prepared.rows).toHaveLength(2000);
    expect(prepared.clusterBySubject.size).toBe(1000);
    expect(new Set(prepared.clusterBySubject.values()).size).toBe(32);
    expect(prepared.excludedEventIds).toEqual([]);
    expect(prepared.excludedInstanceIds).toEqual([]);
    prepared.rows.forEach((row, index) => {
      const expected = input.rows[index];
      expect(row).toMatchObject({
        stratum: expected.stratum,
        start: expected.start,
        stop: expected.stop,
        failed: expected.failed,
        observedAt: expected.observedAt,
        covariates: expected.covariates,
      });
      expect(prepared.clusterBySubject.get(row.subjectId)).toBe(
        input.clusters[Math.floor(index / 2)][1],
      );
    });
    const fit = fitCox(prepared.rows, input.covariateNames);
    if (fit.status !== "fitted") throw new Error(fit.reason);
    expect(fit.subjects).toBe(1000);
    expect(fit.failures).toBe(witness.failures);
    fit.coefficients.forEach((value, j) =>
      expect(value).toBeCloseTo(witness.coefficients[j], 7),
    );
    fit.covariance.forEach((row, i) =>
      row.forEach((value, j) =>
        expect(value).toBeCloseTo(witness.covariance[i][j], 7),
      ),
    );
    expect(fit.logLikelihood).toBeCloseTo(witness.logLikelihood, 7);
    expect(fit.phAssumptionValidated).toBe(false);
    expect(fit.authority).toBe("advisory_only");
  });

  it.each(["approval", "source", "unit", "coverage"])(
    "refuses the whole maximum cohort when its final life has a %s gap",
    (gap) => {
      const { covariates, source } = capacityCensus();
      const final = source.events.at(-1)!;
      if (gap === "approval") final.approvalCurrent = false;
      if (gap === "source") final.sourceCurrent = false;
      if (gap === "unit")
        final.overlay!.intervals![1].values[7].unit = "wrong-unit";
      if (gap === "coverage") final.overlay!.intervals![1].startHours += 1;
      const prepared = prepareSurvivalCensus(source, covariates);
      expect(prepared.gaps.length).toBeGreaterThan(0);
      expect(prepared.rows).toEqual([]);
      expect(prepared.clusterBySubject.size).toBe(0);
      expect(prepared.excludedEventIds).toEqual([]);
      expect(source.events).toHaveLength(1000);
    },
  );

  it("refuses excess complete exposure without sampling or changing software bounds", () => {
    const { covariates, source } = capacityCensus();
    const extra = structuredClone(source.events[0]);
    extra.id = 1001;
    extra.overlay!.lifeRef = "synthetic-extra-physical-life";
    source.events.push(extra);
    const prepared = prepareSurvivalCensus(source, covariates);
    expect(prepared.gaps.join(" ")).toContain(
      "no rows were sampled or dropped",
    );
    expect(prepared.rows).toEqual([]);
    expect(prepared.clusterBySubject.size).toBe(0);
    expect(source.events).toHaveLength(1001);
  });

  it("identifies the unresolved legacy persistence collision rather than claiming this fixture was ingested", () => {
    const { source } = capacityCensus();
    const legacyKeys = source.events.map((event) =>
      JSON.stringify([
        event.assetId,
        event.component,
        event.hoursAtChangeOut,
        event.eventKind,
      ]),
    );
    expect(new Set(legacyKeys).size).toBe(789);
    expect(legacyKeys.length - new Set(legacyKeys).size).toBe(211);
    expect(
      new Set(
        source.events.map(
          (event) => `${event.assetId}:${event.overlay!.lifeRef}`,
        ),
      ).size,
    ).toBe(1000);
    const schema = readFileSync(
      "supabase/migrations/20260830090000_component_life_events.sql",
      "utf8",
    );
    expect(schema).toContain(
      "unique(organization_id, unit_number, component, hours_at_change_out, event_kind)",
    );
    const smoke = readFileSync(
      "scripts/ci-survival-covariate-smoke.sh",
      "utf8",
    );
    expect(smoke).toContain("LEGACY_COLLISION");
    expect(smoke).toContain("this component life event is already recorded");
    expect(smoke).toContain("legacy_same_exposure_life_ingestion=false");
  });
});

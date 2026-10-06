import { describe, expect, it } from "vitest";
import {
  prepareSurvivalSource,
  type SurvivalSourceEvent,
} from "./survival-source";

const source = (): SurvivalSourceEvent[] => [
  {
    id: 1,
    assetId: "asset-one",
    component: "drive",
    hoursAtChangeOut: 120,
    eventKind: "scheduled",
    eventDate: "2026-09-20",
    overlayVersion: 1,
    overlayStatus: "validated",
    overlayAuthor: "author",
    overlayReviewer: "reviewer",
    sourceCurrent: true,
    approvalCurrent: true,
    overlay: {
      mode: "include",
      basis: "Verified operating measurements and installation boundary.",
      lifeRef: "serial-123-life-1",
      serviceStartedAt: "2026-08-20T00:00:00Z",
      terminalObservedAt: "2026-09-20T00:00:00Z",
      entryHours: 0,
      stratum: "same-design",
      intervals: [
        {
          startHours: 0,
          stopHours: 120,
          startedAt: "2026-08-20T00:00:00Z",
          endedAt: "2026-09-20T00:00:00Z",
          values: [
            {
              name: "temperature",
              unit: "degC",
              value: 45,
              evidenceItemId: "evidence-one",
              observedAtHours: 0,
              availableAtHours: 0,
              validThroughHours: 120,
              observedAt: "2026-08-20T00:00:00Z",
              availableAt: "2026-08-20T00:00:00Z",
            },
          ],
        },
      ],
    },
  },
];

describe("canonical survival source preparation", () => {
  it("preserves scheduled working removal as censoring and physical-life identity", () => {
    const result = prepareSurvivalSource(source(), [
      { name: "temperature", unit: "degC" },
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.rows[0].failed).toBe(false);
    expect(result.rows[0].subjectId).toBe("asset-one:drive:serial-123-life-1");
    expect(result.rows[0].covariates).toEqual([45]);
  });
  it.each(["sourceCurrent", "approvalCurrent"] as const)(
    "refuses changed or revoked %s",
    (field) => {
      const rows = source();
      rows[0][field] = false;
      expect(
        prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }])
          .gaps,
      ).not.toEqual([]);
    },
  );
  it("refuses pending or self-reviewed overlays", () => {
    const rows = source();
    rows[0].overlayStatus = "pending_review";
    expect(
      prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }]).rows,
    ).toEqual([]);
    rows[0].overlayStatus = "validated";
    rows[0].overlayReviewer = rows[0].overlayAuthor;
    expect(
      prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }]).rows,
    ).toEqual([]);
  });
  it("never fills a missing covariate, converts an undeclared unit or discards an uncertain removal", () => {
    for (const mutate of [
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values = [];
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values[0].unit = "degF";
      },
      (row: SurvivalSourceEvent) => {
        row.eventKind = "other";
      },
    ]) {
      const rows = source();
      mutate(rows[0]);
      const result = prepareSurvivalSource(rows, [
        { name: "temperature", unit: "degC" },
      ]);
      expect(result.gaps).not.toEqual([]);
      expect(result.rows).toEqual([]);
    }
  });
  it("requires observed and available evidence before exposure, with explicit validity", () => {
    for (const mutate of [
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values[0].observedAtHours = 1;
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values[0].availableAtHours = 1;
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values[0].validThroughHours = 119;
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].values[0].availableAt =
          "2026-09-21T00:00:00Z";
      },
    ]) {
      const rows = source();
      mutate(rows[0]);
      expect(
        prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }])
          .gaps,
      ).not.toEqual([]);
    }
  });
  it("requires one complete contiguous exposure terminating at canonical change-out", () => {
    for (const endpoint of [119, 121, Number.NaN]) {
      const rows = source();
      rows[0].overlay!.intervals![0].stopHours = endpoint;
      expect(
        prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }])
          .rows,
      ).toEqual([]);
    }
  });
  it("refuses wall-clock leakage even when operating-hour offsets are backdated", () => {
    const rows = source();
    rows[0].overlay!.intervals![0].values[0].availableAt =
      "2026-09-19T00:00:00Z";
    expect(
      prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }]).rows,
    ).toEqual([]);
  });
  it("requires actual interval dates and physically possible operating exposure", () => {
    for (const mutate of [
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].endedAt = "2026-08-20T01:00:00Z";
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].startedAt = "";
      },
      (row: SurvivalSourceEvent) => {
        row.overlay!.intervals![0].startedAt = "2026-08-21T00:00:00Z";
      },
    ]) {
      const rows = source();
      mutate(rows[0]);
      expect(
        prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }])
          .rows,
      ).toEqual([]);
    }
  });
  it("keeps independently reviewed exclusions visible, rather than silently filtering other removals", () => {
    const rows = source();
    rows[0].eventKind = "other";
    rows[0].overlay = {
      mode: "exclude",
      basis:
        "Documented warranty return; failure status cannot be established.",
      evidenceItemId: "evidence-one",
    };
    const result = prepareSurvivalSource(rows, [
      { name: "temperature", unit: "degC" },
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.excludedEventIds).toEqual([1]);
    expect(result.rows).toEqual([]);
  });
  it("refuses duplicate canonical events and physical lives", () => {
    const rows = source();
    rows.push(structuredClone(rows[0]));
    rows[1].id = 2;
    expect(
      prepareSurvivalSource(rows, [{ name: "temperature", unit: "degC" }]).gaps,
    ).not.toEqual([]);
  });
  it("returns no fit-ready population when any source event has an unresolved gap", () => {
    const rows = source();
    rows.push({ ...structuredClone(rows[0]), id: 2, overlay: null });
    const result = prepareSurvivalSource(rows, [
      { name: "temperature", unit: "degC" },
    ]);
    expect(result.rows).toEqual([]);
    expect(result.gaps).not.toEqual([]);
  });
});

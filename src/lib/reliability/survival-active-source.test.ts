import { describe, expect, it } from "vitest";
import { fitCoxWithDiagnostics } from "./cox";
import reference from "./fixtures/cox-reference.json";
import rReference from "./fixtures/cox-r-reference.json";
import {
  prepareActiveSurvivalScenario,
  prepareSurvivalCensus,
  prepareSurvivalScenario,
  prepareSurvivalSource,
  type SurvivalActiveInstance,
  type SurvivalActiveOverlay,
  type SurvivalSourceEvent,
  type SurvivalCensus,
} from "./survival-source";

const now = Date.parse("2026-10-05T12:00:00Z");
const covariates = [{ name: "synthetic_load", unit: "ratio" }];
const active = (): SurvivalActiveInstance => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  assetId: "bbbbbbbb-0000-0000-0000-000000000001",
  component: "synthetic drive",
  position: "left",
  state: "installed",
  installedAt: "2026-10-04T10:00:00Z",
  installedMeterHours: 1000,
  currentMeter: {
    id: "cccccccc-0000-0000-0000-000000000001",
    assetId: "bbbbbbbb-0000-0000-0000-000000000001",
    kind: "operating_hours",
    value: 1008,
    recordedAt: "2026-10-05T10:00:00Z",
  },
  overlayVersion: 1,
  overlayStatus: "validated",
  overlayAuthor: "author",
  overlayReviewer: "reviewer",
  sourceCurrent: true,
  approvalCurrent: true,
  overlay: {
    mode: "include",
    basis:
      "Independently reviewed synthetic installation, meter and condition evidence.",
    meterReadingId: "cccccccc-0000-0000-0000-000000000001",
    installationEvidenceItemId: "installation-evidence",
    meterEvidenceItemId: "meter-evidence",
    validUntil: "2026-10-06T12:00:00Z",
    entryHours: 0,
    stratum: "synthetic-design",
    intervals: [
      {
        startHours: 0,
        stopHours: 8,
        startedAt: "2026-10-04T10:00:00Z",
        endedAt: "2026-10-05T10:00:00Z",
        values: [
          {
            name: "synthetic_load",
            unit: "ratio",
            value: 0.4,
            evidenceItemId: "condition-evidence",
            observedAtHours: 0,
            availableAtHours: 0,
            validThroughHours: 15,
            observedAt: "2026-10-04T10:00:00Z",
            availableAt: "2026-10-04T10:00:00Z",
          },
        ],
      },
    ],
  },
});

describe("canonical installed-life survival preparation", () => {
  const census = (): SurvivalCensus => ({
    sourceVersion: "survival-census/2/draft",
    component: "synthetic drive",
    events: [],
    activeInstances: [active()],
    removedInstances: [],
    populationGaps: [],
  });
  it("includes the canonical installed population in the pinned full census", () => {
    expect(prepareSurvivalCensus(census(), covariates, now).rows).toHaveLength(
      1,
    );
  });
  it("refuses a population outside the exact declared normalized component scope", () => {
    const source = census();
    source.component = "different canonical component";
    const prepared = prepareSurvivalCensus(source, covariates, now);
    expect(prepared.rows).toEqual([]);
    expect(prepared.gaps.join(" ")).toMatch(/requested component scope/);
  });
  it.each([
    "sourceVersion",
    "events",
    "activeInstances",
    "removedInstances",
    "populationGaps",
  ])(
    "does not treat a missing %s as a completed-only or empty census",
    (key) => {
      const source = census();
      delete (source as unknown as Record<string, unknown>)[key];
      const result = prepareSurvivalCensus(source, covariates, now);
      expect(result.rows).toEqual([]);
      expect(result.clusterBySubject.size).toBe(0);
      expect(result.gaps.join(" ")).toMatch(
        /pinned complete physical-life census/,
      );
    },
  );
  it("blocks the entire population for either reported or unreconciled removal gaps", () => {
    const source = census();
    source.populationGaps = ["Explicit unlinked removal"];
    expect(prepareSurvivalCensus(source, covariates, now).rows).toEqual([]);
    source.populationGaps = [];
    source.removedInstances = [
      { ...active(), state: "removed", reconciled: false },
    ];
    expect(
      prepareSurvivalCensus(source, covariates, now).gaps.join(" "),
    ).toMatch(/exact approved historical link/);
    expect(prepareSurvivalCensus(source, covariates, now).rows).toEqual([]);
    source.removedInstances[0].reconciled = true;
    expect(prepareSurvivalCensus(source, covariates, now).rows).toHaveLength(1);
  });
  it.each(["installed", "quarantined"])(
    "allows only a current independently reviewed evidenced exclusion of a %s instance with unknown exposure",
    (state) => {
      const row = active();
      row.state = state;
      row.installedMeterHours = null;
      row.currentMeter = null;
      row.overlay = {
        mode: "exclude",
        basis: "Independent source gaps and disposition reviewed.",
        evidenceItemId: "exclusion-evidence",
      };
      const result = prepareSurvivalSource([], covariates, [row], now);
      expect(result.gaps).toEqual([]);
      expect(result.rows).toEqual([]);
      expect(result.excludedInstanceIds).toEqual([row.id]);
      row.approvalCurrent = false;
      expect(
        prepareSurvivalSource([], covariates, [row], now).gaps.length,
      ).toBeGreaterThan(0);
      row.approvalCurrent = true;
      row.overlayReviewer = row.overlayAuthor;
      expect(
        prepareSurvivalSource([], covariates, [row], now).gaps.length,
      ).toBeGreaterThan(0);
      row.overlayReviewer = "reviewer";
      delete row.overlay.evidenceItemId;
      expect(
        prepareSurvivalSource([], covariates, [row], now).gaps.length,
      ).toBeGreaterThan(0);
    },
  );
  it.each([
    [1000, 1000.3, 0.3],
    [1e-7, 3e-7, 2e-7],
  ])(
    "preserves decimal exposure from meters %s to %s",
    (installed, current, age) => {
      const row = active();
      row.installedMeterHours = installed;
      row.currentMeter!.value = current;
      row.overlay!.intervals![0].stopHours = age;
      const prepared = prepareSurvivalSource([], covariates, [row], now);
      expect(prepared.gaps).toEqual([]);
      expect(prepared.rows[0].stop).toBe(age);
      expect(
        prepareActiveSurvivalScenario(
          [],
          covariates,
          [row],
          {
            componentInstanceId: row.id,
            horizonHours: 1,
          },
          now,
        ),
      ).toMatchObject({ originHours: age });
    },
  );
  it("keeps actual UUID identities and measured right censoring, without a fabricated removal event", () => {
    const result = prepareSurvivalSource([], covariates, [active()], now);
    expect(result.gaps).toEqual([]);
    expect(result.rows).toMatchObject([
      {
        id: "component_instances:aaaaaaaa-0000-0000-0000-000000000001:1:0",
        start: 0,
        stop: 8,
        failed: false,
        covariates: [0.4],
      },
    ]);
    expect(result.clusterBySubject.get(result.rows[0].subjectId)).toBe(
      active().assetId,
    );
    expect(result.excludedEventIds).toEqual([]);
    expect(result.excludedInstanceIds).toEqual([]);
  });
  const invalid: Array<[string, (row: SurvivalActiveInstance) => void]> = [
    [
      "unsafe absolute meter precision",
      (row) => {
        row.installedMeterHours = 1e16;
        row.currentMeter!.value = 1e16 + 8;
      },
    ],
    [
      "missing installation meter",
      (row) => {
        row.installedMeterHours = null;
      },
    ],
    [
      "meter regression",
      (row) => {
        row.currentMeter!.value = 999;
      },
    ],
    [
      "unobserved positive exposure",
      (row) => {
        row.currentMeter!.value = 1000;
      },
    ],
    [
      "impossible runtime",
      (row) => {
        row.currentMeter!.value = 1025;
      },
    ],
    [
      "missing current meter",
      (row) => {
        row.currentMeter = null;
      },
    ],
    [
      "foreign-asset meter",
      (row) => {
        row.currentMeter!.assetId = "foreign-asset";
      },
    ],
    [
      "wrong meter kind",
      (row) => {
        row.currentMeter!.kind = "calendar_hours";
      },
    ],
    [
      "future meter",
      (row) => {
        row.currentMeter!.recordedAt = "2026-10-06T10:00:00Z";
      },
    ],
    [
      "pre-installation meter",
      (row) => {
        row.currentMeter!.recordedAt = row.installedAt;
      },
    ],
    [
      "stale selected meter",
      (row) => {
        row.overlay!.meterReadingId = "another-meter";
      },
    ],
    [
      "missing installation evidence",
      (row) => {
        delete row.overlay!.installationEvidenceItemId;
      },
    ],
    [
      "missing meter evidence",
      (row) => {
        delete row.overlay!.meterEvidenceItemId;
      },
    ],
    [
      "removed installation",
      (row) => {
        row.state = "removed";
      },
    ],
    [
      "unknown installed identity",
      (row) => {
        row.id = "not-a-canonical-uuid";
      },
    ],
    [
      "unreviewed source",
      (row) => {
        row.overlayStatus = "pending_review";
      },
    ],
    [
      "self-reviewed source",
      (row) => {
        row.overlayReviewer = row.overlayAuthor;
      },
    ],
    [
      "changed source",
      (row) => {
        row.sourceCurrent = false;
      },
    ],
    [
      "changed approval",
      (row) => {
        row.approvalCurrent = false;
      },
    ],
    [
      "uncovered exposure",
      (row) => {
        row.overlay!.intervals![0].stopHours = 7;
      },
    ],
    [
      "future condition",
      (row) => {
        row.overlay!.intervals![0].values[0].availableAtHours = 1;
      },
    ],
    [
      "expired interval validity",
      (row) => {
        row.overlay!.intervals![0].values[0].validThroughHours = 7;
      },
    ],
  ];
  it.each(invalid)(
    "refuses the whole installed population for %s",
    (_name, mutate) => {
      const row = active();
      mutate(row);
      const result = prepareSurvivalSource([], covariates, [row], now);
      expect(result.rows).toEqual([]);
      expect(result.clusterBySubject.size).toBe(0);
      expect(result.gaps.length).toBeGreaterThan(0);
    },
  );
  it("refuses duplicate canonical instance and normalized active position identities", () => {
    const a = active(),
      b = active();
    expect(prepareSurvivalSource([], covariates, [a, b], now).gaps).not.toEqual(
      [],
    );
    b.id = "aaaaaaaa-0000-0000-0000-000000000002";
    b.component = " SYNTHETIC DRIVE ";
    b.position = " LEFT ";
    const result = prepareSurvivalSource([], covariates, [a, b], now);
    expect(result.rows).toEqual([]);
    expect(result.gaps.join(" ")).toContain(
      "duplicate active asset/component position",
    );
  });
  it("derives measured age, condition and provenance instead of trusting caller-supplied forecast fields", () => {
    const row = active();
    // A malformed source overlay cannot override canonical installation/meter facts.
    row.overlay = {
      ...row.overlay,
      lifeRef: "forged-life",
      serviceStartedAt: "1900-01-01",
      terminalObservedAt: "2099-01-01",
    } as SurvivalActiveOverlay;
    const result = prepareActiveSurvivalScenario(
      [],
      covariates,
      [row],
      {
        componentInstanceId: row.id,
        horizonHours: 12,
        originHours: 0,
        covariates: [999],
        validUntil: "2099-01-01",
        stratum: "forged",
      },
      now,
    );
    expect(result).toMatchObject({
      originHours: 8,
      horizonHours: 12,
      stratum: "synthetic-design",
      path: [{ covariates: [0.4], validThroughHours: 15 }],
      source: {
        kind: "active_component",
        componentInstanceId: row.id,
        meterReadingId: row.currentMeter!.id,
        asOf: row.currentMeter!.recordedAt,
        overlayVersion: 1,
        evidenceItemIds: [
          "installation-evidence",
          "meter-evidence",
          "condition-evidence",
        ],
      },
    });
  });
  it("requires explicit horizon and unexpired reviewed wall-clock and exposure validity", () => {
    for (const horizon of [8, 7, 16, Number.NaN])
      expect(
        prepareActiveSurvivalScenario(
          [],
          covariates,
          [active()],
          { componentInstanceId: active().id, horizonHours: horizon },
          now,
        ),
      ).toHaveProperty("refusal");
    for (const validUntil of [
      undefined,
      "not-a-date",
      "2026-10-05T12:00:00Z",
      "2026-10-04T12:00:00Z",
    ])
      expect(
        prepareActiveSurvivalScenario(
          [],
          covariates,
          [{ ...active(), overlay: { ...active().overlay!, validUntil } }],
          { componentInstanceId: active().id, horizonHours: 12 },
          now,
        ),
      ).toHaveProperty("refusal");
    for (const selection of [
      null,
      [],
      {},
      { componentInstanceId: "foreign" },
      {
        componentInstanceId: "aaaaaaaa-0000-0000-0000-000000000009",
        horizonHours: 12,
      },
    ])
      expect(
        prepareActiveSurvivalScenario(
          [],
          covariates,
          [active()],
          selection,
          now,
        ),
      ).toHaveProperty("refusal");
  });
  it("refuses a mixed component scope and does not mistake a fabricated active event for an installation", () => {
    const installed = active();
    const completed: SurvivalSourceEvent = {
      id: 1,
      assetId: installed.assetId,
      component: "another component",
      hoursAtChangeOut: 8,
      eventKind: "scheduled",
      eventDate: installed.currentMeter!.recordedAt.slice(0, 10),
      overlayVersion: 1,
      overlayStatus: "validated",
      overlayAuthor: "author",
      overlayReviewer: "reviewer",
      sourceCurrent: true,
      approvalCurrent: true,
      overlay: {
        ...installed.overlay!,
        lifeRef: "historical-life",
        serviceStartedAt: installed.installedAt,
        terminalObservedAt: installed.currentMeter!.recordedAt,
      },
    };
    expect(
      prepareSurvivalSource(
        [completed],
        covariates,
        [installed],
        now,
      ).gaps.join(" "),
    ).toContain("one explicit normalized canonical component scope");
    completed.component = installed.component;
    completed.eventKind = "active" as SurvivalSourceEvent["eventKind"];
    expect(
      prepareSurvivalSource([completed], covariates, [], now).rows,
    ).toEqual([]);
    expect(
      prepareSurvivalSource([completed], covariates, [], now).gaps.join(" "),
    ).toContain("censoring classification is incomplete");
  });
  it("combines completed and still-operating lives without changing the independently witnessed censoring likelihood", () => {
    const input = reference.cases[0];
    const predictors = input.covariateNames.map((name) => ({
      name,
      unit: "synthetic",
    }));
    const events: SurvivalSourceEvent[] = [],
      installed: SurvivalActiveInstance[] = [];
    input.rows.forEach((r, index) => {
      const assetId = `bbbbbbbb-0000-0000-0000-${String(Math.floor(index / 3) + 1).padStart(12, "0")}`;
      const instanceId = `aaaaaaaa-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
      const meterId = `cccccccc-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
      const overlay = {
        mode: "include" as const,
        basis:
          "Independent synthetic physical-life, exposure and condition reference.",
        entryHours: 0,
        stratum: r.stratum,
        intervals: [
          {
            startHours: 0,
            stopHours: r.stop,
            startedAt: "2026-08-20T00:00:00Z",
            endedAt: "2026-09-20T00:00:00Z",
            values: predictors.map((c, j) => ({
              ...c,
              value: r.covariates[j],
              evidenceItemId: `synthetic-${index}-${j}`,
              observedAtHours: 0,
              availableAtHours: 0,
              validThroughHours: r.stop,
              observedAt: "2026-08-20T00:00:00Z",
              availableAt: "2026-08-20T00:00:00Z",
            })),
          },
        ],
      };
      if (!r.failed)
        installed.push({
          ...active(),
          id: instanceId,
          assetId,
          position: `position-${index}`,
          installedAt: "2026-08-20T00:00:00Z",
          currentMeter: {
            id: meterId,
            assetId,
            kind: "operating_hours",
            value: 1000 + r.stop,
            recordedAt: "2026-09-20T00:00:00Z",
          },
          overlay: {
            ...overlay,
            meterReadingId: meterId,
            installationEvidenceItemId: `synthetic-installation-${index}`,
            meterEvidenceItemId: `synthetic-meter-${index}`,
          },
        });
      else
        events.push({
          id: index + 1,
          assetId,
          component: "synthetic drive",
          hoursAtChangeOut: r.stop,
          eventKind: "failure",
          eventDate: "2026-09-20",
          overlayVersion: 1,
          overlayStatus: "validated",
          overlayAuthor: "author",
          overlayReviewer: "reviewer",
          sourceCurrent: true,
          approvalCurrent: true,
          overlay: {
            ...overlay,
            lifeRef: r.subjectId,
            serviceStartedAt: "2026-08-20T00:00:00Z",
            terminalObservedAt: "2026-09-20T00:00:00Z",
          },
        });
    });
    const prepared = prepareSurvivalSource(events, predictors, installed, now);
    expect(prepared.gaps).toEqual([]);
    expect(prepared.rows).toHaveLength(input.rows.length);
    expect(prepared.rows.filter((r) => !r.failed)).toHaveLength(
      installed.length,
    );
    const fit = fitCoxWithDiagnostics(
      prepared.rows,
      input.covariateNames,
      prepared.clusterBySubject,
    );
    if (fit.status !== "fitted" || fit.diagnostics?.status !== "computed")
      throw new Error(JSON.stringify(fit));
    input.expected.coefficients.forEach((value, j) =>
      expect(fit.coefficients[j]).toBeCloseTo(value, 7),
    );
    const diagnostic = fit.diagnostics;
    rReference.cases[0].expected.clusterCovariance.forEach((row, j) =>
      row.forEach((value, k) =>
        expect(diagnostic.clusteredCovariance[j][k]).toBeCloseTo(value, 7),
      ),
    );
    // Any unresolved installed life blocks the complete population, including historical scenarios.
    installed[0].sourceCurrent = false;
    expect(
      prepareSurvivalSource(events, predictors, installed, now).rows,
    ).toEqual([]);
    expect(
      prepareSurvivalScenario(
        events,
        predictors,
        {
          eventId: events[0].id,
          intervalIndex: 0,
          originHours: 0,
          horizonHours: events[0].hoursAtChangeOut,
        },
        installed,
        now,
      ),
    ).toHaveProperty("refusal");
  });
});

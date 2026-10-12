import { describe, expect, it } from "vitest";
import { replay, validateTelemetry, type Telemetry } from "./index";
import { AS_OF, configuration, fixtures, observation } from "./fixtures";
import report from "./qualification-report.json";

const check = (e: unknown, c = configuration) => validateTelemetry(e, c, AS_OF);
const inference = (
  kind: "derived_feature" | "condition_estimate" | "forecast",
): Telemetry =>
  ({
    ...observation(),
    kind,
    value: 0.4,
    model: { modelKey: "synthetic-feature", version: "1" },
    provenance: {
      method: "synthetic-model",
      sourceRefs: [{ table: "condition_readings", id: "synthetic-reading" }],
    },
    ...(kind !== "derived_feature"
      ? {
          confidence: {
            meaning: "uncalibrated_model_score" as const,
            score: 0.7,
            applicability: "synthetic fixture only",
            basis: "unvalidated fixture score",
          },
        }
      : {}),
    ...(kind === "forecast" ? { targetAt: "2026-01-01T01:00:00.000Z" } : {}),
  }) as Telemetry;

describe("telemetry qualification v1", () => {
  it.each(["organizationId", "siteId", "assetId", "sensorId", "componentId"])(
    "requires canonical %s",
    (key) => {
      const e = observation();
      expect(check({ ...e, identity: { ...e.identity, [key]: " " } })).toEqual({
        outcome: "invalid",
        reasons: ["missing_identifier"],
      });
      expect(
        check({ ...e, identity: { ...e.identity, [key]: "other" } }).outcome,
      ).toBe("quarantined");
    },
  );
  it.each(["sourceId", "sourceSystem"])("requires stable %s", (key) =>
    expect(check({ ...observation(), [key]: "" }).outcome).toBe("invalid"),
  );
  it.each([NaN, Infinity, -Infinity, "3", undefined])(
    "refuses non-numeric value %s",
    (value) =>
      expect(check({ ...observation(), value }).reasons).toEqual([
        "nonfinite_value",
      ]),
  );
  it.each([null, [], {}, "text"])("handles malformed input %s", (e) =>
    expect(check(e).outcome).toBe("invalid"),
  );
  it.each([
    "2026-02-30T00:00:00.000Z",
    "2026-01-01",
    "tomorrow",
    "2026-01-01T00:11:00.000Z",
  ])("refuses impossible capture %s", (capturedAt) =>
    expect(check({ ...observation(), capturedAt }).outcome).toBe("invalid"),
  );
  it("requires receipt after capture and before the explicit evaluation clock", () => {
    expect(
      check({ ...observation(), receivedAt: "2026-01-02T00:00:00.000Z" })
        .reasons,
    ).toEqual(["impossible_time"]);
    expect(validateTelemetry(observation(), configuration, "bad").outcome).toBe(
      "invalid",
    );
  });
  it("distinguishes missing config, stale config and wrong units", () => {
    expect(validateTelemetry(observation(), null, AS_OF).outcome).toBe(
      "unknown",
    );
    expect(check({ ...observation(), configurationVersion: "" }).outcome).toBe(
      "unknown",
    );
    expect(
      check({ ...observation(), configurationVersion: "old" }).reasons,
    ).toEqual(["stale_configuration"]);
    expect(
      check(observation(), { ...configuration, validUntil: AS_OF }).outcome,
    ).toBe("quarantined");
    expect(
      check(observation(), { ...configuration, maxReceiptDelayMs: NaN })
        .outcome,
    ).toBe("invalid");
    expect(check({ ...observation(), unit: "degC" }).reasons).toEqual([
      "unit_mismatch",
    ]);
  });
  it.each(["suspect", "bad", "substituted"])(
    "does not qualify %s quality",
    (quality) =>
      expect(check({ ...observation(), quality }).reasons).toEqual([
        "unusable_quality",
      ]),
  );
  it("preserves dropout as unknown, not zero", () =>
    expect(check(observation("dropout", null))).toEqual({
      outcome: "unknown",
      reasons: ["sensor_dropout"],
    }));
  it.each(["derived_feature", "condition_estimate", "forecast"] as const)(
    "distinguishes %s with model and lineage",
    (kind) => {
      expect(check(inference(kind)).outcome).toBe("valid");
      expect(
        check({
          ...inference(kind),
          model: { modelKey: "synthetic-feature", version: "retired" },
        }).reasons,
      ).toEqual(["model_version_mismatch"]);
      expect(
        check({
          ...inference(kind),
          provenance: { method: "synthetic", sourceRefs: [] },
        }).outcome,
      ).toBe("invalid");
    },
  );
  it("refuses arbitrary confidence or forecast horizon masquerading as observation", () => {
    expect(check({ ...observation(), confidence: 0.9 }).outcome).toBe(
      "invalid",
    );
    expect(
      check({
        ...inference("condition_estimate"),
        confidence: { meaning: "failure_probability", score: 0.9 },
      }).outcome,
    ).toBe("invalid");
    expect(
      check({ ...inference("forecast"), targetAt: observation().capturedAt })
        .outcome,
    ).toBe("invalid");
  });
});

describe("deterministic synthetic replay", () => {
  it("matches the retained machine-readable report and repeats without mutations", () => {
    const before = JSON.stringify(fixtures);
    const first = fixtures.map((f) => replay(f, AS_OF));
    expect(first).toEqual(report);
    expect(JSON.stringify(fixtures.map((f) => replay(f, AS_OF)))).toBe(
      JSON.stringify(first),
    );
    expect(JSON.stringify(fixtures)).toBe(before);
    expect(first.every((r) => r.synthetic && !r.operationalAuthorization)).toBe(
      true,
    );
  });
  it("asserts labelled domain outcomes independently of the retained report", () => {
    const results = fixtures.map((f) => replay(f, AS_OF));
    expect(results.map((r) => r.rows.map((row) => row.outcome))).toEqual([
      ["valid", "valid"],
      ["valid", "valid", "valid"],
      ["valid", "unknown"],
      ["quarantined", "quarantined"],
      ["quarantined"],
      ["valid", "quarantined"],
      ["valid", "duplicate"],
      ["quarantined", "quarantined"],
      ["quarantined"],
    ]);
    expect(results[1].rows.map((r) => r.qualifiedValue)).toEqual([2, 4, 6]);
    expect(results[4].rows[0].reasons).toEqual(["late_reading"]);
    expect(results[7].rows[0].reasons).toContain("conflicting_content_id");
    expect(results[7].rows[1].reasons).toContain("conflicting_content_id");
    expect(results[5].rows[1].reasons).toEqual(["out_of_order"]);
  });
  it("does not leak identity or time state across calls", () => {
    const e = observation();
    replay(
      { label: "late", configuration, events: [observation("next", 3, 2)] },
      AS_OF,
    );
    expect(
      replay({ label: "isolated", configuration, events: [e] }, AS_OF).rows[0]
        .outcome,
    ).toBe("valid");
  });
  it("revokes every same-ID result after a conflicting duplicate", () => {
    const r = replay(
      {
        label: "collision",
        configuration,
        events: [
          observation(),
          observation(),
          observation("sample-1", 9),
          observation(),
        ],
      },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) => row.outcome === "quarantined" && row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it("never restores a contradictory point through a third ID", () => {
    const r = replay(
      {
        label: "contradiction",
        configuration,
        events: [
          observation(),
          observation("second", 9),
          observation("third", 2),
        ],
      },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) => row.outcome === "quarantined" && row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it("propagates conflicting IDs to contradictory same-time independent IDs", () => {
    const r = replay(
      {
        label: "combined-conflicts",
        configuration,
        events: [
          observation(),
          observation("sample-1", 9),
          observation("independent", 2),
        ],
      },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) => row.outcome === "quarantined" && row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it.each(["contractVersion", "kind", "quality", "provenance"])(
    "refuses malformed %s",
    (key) => {
      expect(check({ ...observation(), [key]: [] }).outcome).toBe("invalid");
    },
  );
  it("does not let extra identity metadata split a canonical sensor series", () => {
    const first = observation();
    const second = {
      ...observation("second", 9),
      identity: { ...first.identity, adapterNote: "extra" },
    };
    expect(check(second).outcome).toBe("valid");
    const r = replay(
      { label: "identity-extras", configuration, events: [first, second] },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) =>
          row.outcome === "quarantined" &&
          row.reasons.includes("contradictory_same_time") &&
          row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it("does not let extra model metadata split an exact-version series", () => {
    const first = inference("condition_estimate");
    const second = {
      ...inference("condition_estimate"),
      sourceId: "second",
      value: 0.8,
      model: {
        modelKey: "synthetic-feature",
        version: "1",
        adapterNote: "extra",
      },
    };
    expect(check(second).outcome).toBe("valid");
    const r = replay(
      { label: "model-extras", configuration, events: [first, second] },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) =>
          row.outcome === "quarantined" &&
          row.reasons.includes("contradictory_same_time") &&
          row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it("compares semantic object content independent of property order", () => {
    const e = observation();
    const reordered = Object.fromEntries(
      Object.entries(e).reverse(),
    ) as Telemetry;
    expect(
      replay(
        { label: "reordered", configuration, events: [e, reordered] },
        AS_OF,
      ).rows[1].outcome,
    ).toBe("duplicate");
  });
});

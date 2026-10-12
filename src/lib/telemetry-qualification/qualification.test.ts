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
  it("checks inference policy before reporting an absent derived value", () => {
    const e = { ...inference("forecast"), value: null };
    expect(check(e)).toEqual({
      outcome: "unknown",
      reasons: ["missing_derived_value"],
    });
    expect(
      check({
        ...e,
        confidence: { meaning: "failure_probability", score: 0.9 },
      }).reasons,
    ).toEqual(["invalid_confidence_semantics"]);
    expect(check({ ...e, targetAt: e.capturedAt }).reasons).toEqual([
      "invalid_forecast_target",
    ]);
    expect(
      check({
        ...e,
        identity: { ...e.identity, organizationId: "other-tenant" },
      }).reasons,
    ).toEqual(["identity_binding_mismatch"]);
    expect(check(e, { ...configuration, validUntil: AS_OF }).reasons).toEqual([
      "stale_configuration",
    ]);
    expect(
      check({
        ...e,
        model: { modelKey: "synthetic-feature", version: "retired" },
      }).reasons,
    ).toEqual(["model_version_mismatch"]);
    expect(check({ ...e, quality: "bad" }).reasons).toEqual([
      "unusable_quality",
    ]);
  });
  it.each(["derived_feature", "condition_estimate", "forecast"] as const)(
    "refuses sparse lineage for %s",
    (kind) => {
      const sourceRefs = new Array(1);
      expect(
        check({
          ...inference(kind),
          provenance: { method: "synthetic-model", sourceRefs },
        }).reasons,
      ).toEqual(["invalid_provenance"]);
      const partiallySparse = new Array(2);
      partiallySparse[0] = {
        table: "condition_readings",
        id: "synthetic-reading",
      };
      expect(
        check({
          ...inference(kind),
          provenance: {
            method: "synthetic-model",
            sourceRefs: partiallySparse,
          },
        }).reasons,
      ).toEqual(["invalid_provenance"]);
    },
  );
  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])(
    "refuses unbounded confidence %s",
    (score) => {
      const e = inference("condition_estimate");
      expect(
        check({
          ...e,
          confidence: {
            meaning: "uncalibrated_model_score",
            score,
            applicability: "synthetic only",
            basis: "fixture",
          },
        }).reasons,
      ).toEqual(["invalid_confidence_semantics"]);
    },
  );
  it.each(["basis", "applicability"])("requires confidence %s", (field) => {
    expect(
      check({
        ...inference("forecast"),
        confidence: {
          meaning: "uncalibrated_model_score",
          score: 0.5,
          applicability: "synthetic only",
          basis: "fixture",
          [field]: "",
        },
      }).reasons,
    ).toEqual(["invalid_confidence_semantics"]);
  });
  it("defines configuration validity endpoints without implicit clock tolerance", () => {
    const e = observation();
    expect(
      check(e, { ...configuration, validFrom: e.capturedAt }).outcome,
    ).toBe("valid");
    expect(
      check(e, { ...configuration, validFrom: "2026-01-01T00:01:00.001Z" })
        .reasons,
    ).toEqual(["stale_configuration"]);
    expect(
      check(e, { ...configuration, validUntil: "2026-01-01T00:10:00.001Z" })
        .outcome,
    ).toBe("valid");
    expect(check(e, { ...configuration, validUntil: AS_OF }).reasons).toEqual([
      "stale_configuration",
    ]);
    expect(
      check(e, { ...configuration, validFrom: AS_OF, validUntil: AS_OF })
        .reasons,
    ).toEqual(["invalid_configuration"]);
    expect(
      check(e, { ...configuration, maxReceiptDelayMs: 1000 }).outcome,
    ).toBe("valid");
    expect(
      check(e, { ...configuration, maxReceiptDelayMs: 999 }).reasons,
    ).toEqual(["late_reading"]);
  });
  it("requires both model key and version in the supplied configuration", () => {
    expect(
      check({
        ...inference("derived_feature"),
        model: { modelKey: "other-model", version: "1" },
      }).reasons,
    ).toEqual(["model_version_mismatch"]);
    expect(
      check(inference("derived_feature"), { ...configuration, model: null })
        .reasons,
    ).toEqual(["model_version_mismatch"]);
    expect(
      check({ ...inference("derived_feature"), model: null }).reasons,
    ).toEqual(["missing_model_or_lineage"]);
  });
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
  it("treats the same source ID with changed receipt time as a content conflict", () => {
    const e = observation();
    const r = replay(
      {
        label: "receipt-change",
        configuration,
        events: [e, { ...e, receivedAt: "2026-01-01T00:01:02.000Z" }],
      },
      AS_OF,
    );
    expect(
      r.rows.every(
        (row) =>
          row.outcome === "quarantined" &&
          row.reasons.includes("conflicting_content_id") &&
          row.qualifiedValue === null,
      ),
    ).toBe(true);
  });
  it.each(["unknown", "quarantined"] as const)(
    "duplicates a repeated %s event without qualifying it",
    (outcome) => {
      const e =
        outcome === "unknown"
          ? observation("missing", null)
          : { ...observation(), quality: "bad" as const };
      const r = replay(
        { label: "repeat-unusable", configuration, events: [e, e, e] },
        AS_OF,
      );
      expect(r.rows.map((row) => row.outcome)).toEqual([
        outcome,
        "duplicate",
        "duplicate",
      ]);
      expect(r.rows.every((row) => row.qualifiedValue === null)).toBe(true);
    },
  );
  it("compares nested property order without splitting duplicate identity", () => {
    const e = inference("condition_estimate");
    const reordered = {
      ...e,
      identity: Object.fromEntries(Object.entries(e.identity).reverse()),
      model: { version: "1", modelKey: "synthetic-feature" },
      provenance: {
        sourceRefs: [{ id: "synthetic-reading", table: "condition_readings" }],
        method: "synthetic-model",
      },
    } as Telemetry;
    expect(
      replay(
        { label: "nested-order", configuration, events: [e, reordered] },
        AS_OF,
      ).rows.map((row) => row.outcome),
    ).toEqual(["valid", "duplicate"]);
  });
  it("separates source IDs by source system without cross-source fusion", () => {
    const e = observation();
    const r = replay(
      {
        label: "sources",
        configuration,
        events: [e, { ...e, sourceSystem: "other-source", value: 9 }],
      },
      AS_OF,
    );
    expect(r.rows.map((row) => row.outcome)).toEqual(["valid", "valid"]);
  });
  it("does not let an event from another tenant collide with a qualified event", () => {
    const e = observation();
    const r = replay(
      {
        label: "tenant-fields",
        configuration,
        events: [
          e,
          {
            ...e,
            identity: { ...e.identity, organizationId: "other-tenant" },
            value: 9,
          },
        ],
      },
      AS_OF,
    );
    expect(r.rows.map((row) => row.outcome)).toEqual(["valid", "quarantined"]);
    expect(r.rows[1].reasons).toEqual(["identity_binding_mismatch"]);
    // This is field-validation coverage, not a test of authentication or RLS.
  });
  it("is deterministic for a supplied arrival order, not permutation invariant", () => {
    const older = observation();
    const newer = observation("newer", 4, 2);
    expect(
      replay(
        { label: "ordered", configuration, events: [older, newer] },
        AS_OF,
      ).rows.map((row) => row.outcome),
    ).toEqual(["valid", "valid"]);
    expect(
      replay(
        { label: "reversed", configuration, events: [newer, older] },
        AS_OF,
      ).rows.map((row) => row.outcome),
    ).toEqual(["valid", "quarantined"]);
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

import { describe, expect, it } from "vitest";
import { contextInventoryFixture } from "../../test/support/syncContextInventoryFixture";
import { parseSyncContextSourceInventory } from "./source-inventory";
import {
  CONTEXT_RIGHTS_STATES,
  CONTEXT_SOURCE_CLASSES,
  SOURCE_HEALTH_STATES,
} from "./contracts";

describe("complete-or-refuse organization source metadata (not authorization)", () => {
  it.each([
    ["key", 256],
    ["name", 4000],
    ["purpose", 4000],
    ["detail", 4000],
  ] as const)(
    "matches PostgreSQL Unicode character boundaries for %s",
    (field, maximum) => {
      const raw = contextInventoryFixture();
      const source = { ...raw.sources[0], [field]: "😀".repeat(maximum) };
      expect(
        parseSyncContextSourceInventory({ ...raw, sources: [source] })
          .sources[0][field],
      ).toBe(source[field]);
      expect(() =>
        parseSyncContextSourceInventory({
          ...raw,
          sources: [{ ...source, [field]: "😀".repeat(maximum + 1) }],
        }),
      ).toThrow();
    },
  );
  it("keeps non-active registry status metadata at the Unicode character boundary", () => {
    const raw = contextInventoryFixture();
    const source = {
      ...raw.sources[0],
      registryStatus: "😀".repeat(256),
      state: "unavailable",
      issues: ["health_not_permitted", "disabled_or_inactive"],
    };
    expect(
      parseSyncContextSourceInventory({ ...raw, sources: [source] }).sources[0]
        .registryStatus,
    ).toBe(source.registryStatus);
    expect(() =>
      parseSyncContextSourceInventory({
        ...raw,
        sources: [{ ...source, registryStatus: "😀".repeat(257) }],
      }),
    ).toThrow();
  });
  it("retains every classified health/rights/enablement state allowed by the metadata contract", () => {
    let cases = 0;
    for (const sourceClass of CONTEXT_SOURCE_CLASSES)
      for (const state of SOURCE_HEALTH_STATES)
        for (const rightsState of CONTEXT_RIGHTS_STATES)
          for (const enabled of [true, false, null])
            for (const registryStatus of ["active", "inactive", null])
              for (const clockValid of [true, false])
                for (const rightsClockValid of [true, false]) {
                  const raw = contextInventoryFixture();
                  const active =
                    enabled === true && registryStatus === "active";
                  const rightsPermit =
                    rightsClockValid &&
                    (sourceClass === "simulated_industrial"
                      ? rightsState === "not_required"
                      : sourceClass === "customer_operational"
                        ? rightsState === "customer_authorized"
                        : ["demo_approved", "production_approved"].includes(
                            rightsState,
                          ));
                  const healthPermit =
                    active &&
                    (sourceClass === "simulated_industrial"
                      ? state === "simulated"
                      : [
                          "connected",
                          "live",
                          "stale",
                          "throttled",
                          "delayed",
                          "conflicting",
                          "partial_coverage",
                          "clock_skew",
                        ].includes(state));
                  const effectiveState = !active
                    ? "unavailable"
                    : !clockValid
                      ? "malformed"
                      : state;
                  const canEmit = clockValid && rightsPermit && healthPermit;
                  const displayAsLive =
                    canEmit &&
                    effectiveState === "live" &&
                    (sourceClass === "customer_operational" ||
                      (sourceClass === "live_external" &&
                        rightsState === "production_approved"));
                  const source = {
                    ...raw.sources[0],
                    class: sourceClass,
                    reportedHealthState: state,
                    state: effectiveState,
                    rightsState,
                    enabled,
                    registryStatus,
                    clockValid,
                    rightsPermit,
                    healthPermit,
                    canEmit,
                    displayAsLive,
                    checkedAt: clockValid ? raw.sources[0].checkedAt : null,
                    checkAgeSeconds: clockValid ? 60 : null,
                    observedAt: clockValid ? raw.sources[0].checkedAt : null,
                    observationAgeSeconds: clockValid ? 60 : null,
                    issues: [
                      !clockValid && "invalid_source_clock",
                      !rightsPermit && "rights_not_permitted",
                      !healthPermit && "health_not_permitted",
                      !active && "disabled_or_inactive",
                      effectiveState === "stale" && "stale_observation",
                    ].filter(Boolean),
                  };
                  expect(
                    parseSyncContextSourceInventory({
                      ...raw,
                      sources: [source],
                    }).sources,
                  ).toEqual([source]);
                  cases++;
                }
    expect(cases).toBe(9072);
  });
  it("accepts degraded live-source metadata without claiming it is currently live", () => {
    const raw = contextInventoryFixture();
    const source = {
      ...raw.sources[0],
      reportedHealthState: "live",
      state: "stale",
      observedAt: raw.sources[0].checkedAt,
      observationAgeSeconds: 60,
      healthPermit: true,
      canEmit: true,
      issues: ["stale_observation"],
    };
    expect(
      parseSyncContextSourceInventory({ ...raw, sources: [source] }).sources[0]
        .displayAsLive,
    ).toBe(false);
  });
  it("enforces cumulative escaped wire bytes, not just per-field or source-count limits", () => {
    const raw = contextInventoryFixture();
    const sources = Array.from({ length: 120 }, (_, index) => ({
      ...raw.sources[0],
      id: `ee020000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      name: "\u0000".repeat(4000),
      purpose: "\u0000".repeat(4000),
      detail: "\u0000".repeat(4000),
    }));
    expect(
      parseSyncContextSourceInventory({ ...raw, sources: sources.slice(0, 60) })
        .sources,
    ).toHaveLength(60);
    expect(() =>
      parseSyncContextSourceInventory({ ...raw, sources }),
    ).toThrow();
  });
  it("retains a disconnected unused source without invented coverage or success", () => {
    const raw = contextInventoryFixture();
    const result = parseSyncContextSourceInventory(raw);
    expect(result).toEqual(raw);
    expect(result.sources[0].canEmit).toBe(false);
    expect(result.sources[0].lastSuccessfulCheckAt).toBeNull();
    expect(result.sources[0].coverage.state).toBe("unknown");
    expect(result).not.toBe(raw);
    expect(result.sources[0]).not.toBe(raw.sources[0]);
  });
  it("distinguishes an empty classified registry from disconnected entries", () => {
    expect(
      parseSyncContextSourceInventory({
        ...contextInventoryFixture(),
        sources: [],
      }).sources,
    ).toEqual([]);
  });
  it.each([
    { scope: "site" },
    { complete: false },
    { operationalAuthority: true },
    { generatedAt: "2026-02-30T05:00:00Z" },
    { generatedAt: "2026-10-10T05:00:00" },
    { generatedAt: "infinity" },
    { organizationId: "not-a-uuid" },
    { sources: null },
    { secrets: "must never cross this contract" },
  ])("refuses malformed or overclaiming envelopes %j", (change) => {
    expect(() =>
      parseSyncContextSourceInventory({
        ...contextInventoryFixture(),
        ...change,
      }),
    ).toThrow();
  });
  it.each([
    { organizationId: "ee020000-0000-4000-8000-000000000099" },
    { id: "not-a-canonical-id" },
    { name: "x".repeat(4001) },
    { key: "x".repeat(257) },
    { class: "unknown" },
    { authority: "approved_operator" },
    { rightsState: "approved" },
    { state: "healthy" },
    { reportedHealthState: "healthy" },
    { enabled: "true" },
    { canEmit: true },
    { displayAsLive: true },
    { healthPermit: true },
    { checkedAt: "2026-10-10T05:02:00Z" },
    { checkedAt: "infinity" },
    { checkedAt: "2026-02-30T05:00:00Z" },
    { checkAgeSeconds: 0 },
    { checkAgeSeconds: -1 },
    { checkAgeSeconds: Number.NaN },
    { observedAt: "2026-10-10T05:00:01Z", observationAgeSeconds: 59 },
    { observationAgeSeconds: 0 },
    { lastSuccessfulCheckAt: "2026-10-10T05:00:00Z" },
    { lastSuccessfulCheckBasis: "connected_means_success" },
    { coverage: { state: "complete", basis: "object_count" } },
    { issues: [] },
    { issues: ["unknown"] },
    { operationalAuthority: true },
    { endpoint: "https://private.example" },
    { config: { token: "private" } },
  ])(
    "refuses the whole inventory rather than dropping a bad source %j",
    (change) => {
      const raw = contextInventoryFixture();
      expect(() =>
        parseSyncContextSourceInventory({
          ...raw,
          sources: [{ ...raw.sources[0], ...change }],
        }),
      ).toThrow();
    },
  );
  it("refuses duplicate, sparse and over-count arrays, including differently cased IDs", () => {
    const raw = contextInventoryFixture();
    for (const sources of [
      [
        raw.sources[0],
        { ...raw.sources[0], id: raw.sources[0].id.toUpperCase() },
      ],
      new Array(1),
      new Array(501).fill(raw.sources[0]),
    ])
      expect(() =>
        parseSyncContextSourceInventory({ ...raw, sources }),
      ).toThrow();
  });
  it("keeps unavailable sanitized clocks visible with unknown ages", () => {
    const raw = contextInventoryFixture();
    raw.sources[0] = {
      ...raw.sources[0],
      checkedAt: null,
      checkAgeSeconds: null,
      clockValid: false,
      state: "malformed",
      issues: ["invalid_source_clock", "health_not_permitted"],
    } as unknown as (typeof raw.sources)[0];
    const result = parseSyncContextSourceInventory(raw);
    expect(result.sources[0].checkedAt).toBeNull();
    expect(result.sources[0].checkAgeSeconds).toBeNull();
  });
  it("accepts microsecond timestamps without pretending UI millisecond precision is authoritative", () => {
    const raw = contextInventoryFixture();
    raw.generatedAt = "2026-10-10T05:01:00.000999+00:00";
    raw.sources[0].checkedAt = "2026-10-10T05:00:00.000001+00:00";
    raw.sources[0].checkAgeSeconds = 60.000998;
    expect(
      parseSyncContextSourceInventory(raw).sources[0].checkAgeSeconds,
    ).toBe(60.000998);
  });
});

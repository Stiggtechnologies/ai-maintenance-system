import { describe, expect, it } from "vitest";
import { SOURCE_HEALTH_STATES, type ContextSource } from "./contracts";
import { contextSourceEmission } from "./operating-source";

const source: ContextSource = {
  id: "customer-gis",
  organizationId: "tenant-a",
  key: "gis",
  name: "Customer GIS",
  class: "customer_operational",
  authority: "tenant_authorized",
  purpose: "Customer authorized source geometry.",
  rightsState: "customer_authorized",
  state: "connected",
  checkedAt: "2026-10-10T05:00:00Z",
  observedAt: null,
  detail: null,
  displayAsLive: false,
};
const blockedHealth = [
  "not_connected",
  "unavailable",
  "malformed",
  "simulated",
];

describe("SC-02 operating source emission policy (browser defense in depth)", () => {
  it.each(SOURCE_HEALTH_STATES)(
    "retains the exact customer source state %s",
    (state) => {
      const input = { ...source, state };
      const before = structuredClone(input);
      const result = contextSourceEmission(input);
      expect(result.canEmit).toBe(!blockedHealth.includes(state));
      expect(result.displayAsLive).toBe(false);
      expect(result.reason).toBe(
        blockedHealth.includes(state) ? "source_health" : null,
      );
      expect(input).toEqual(before);
    },
  );

  it.each([
    "unreviewed",
    "not_required",
    "demo_approved",
    "production_approved",
    "blocked",
    "expired",
  ] as const)(
    "refuses customer geometry when customer authorization is %s",
    (rightsState) => {
      expect(
        contextSourceEmission({
          ...source,
          state: "live",
          displayAsLive: true,
          rightsState,
        }),
      ).toMatchObject({
        canEmit: false,
        displayAsLive: false,
        reason: "source_rights",
      });
    },
  );

  it("requires both the canonical live state and live flag", () => {
    expect(
      contextSourceEmission({ ...source, state: "live", displayAsLive: true }),
    ).toMatchObject({ canEmit: true, displayAsLive: true, degraded: false });
    expect(
      contextSourceEmission({ ...source, state: "stale", displayAsLive: true }),
    ).toMatchObject({ canEmit: true, displayAsLive: false, degraded: true });
  });

  it.each([
    "stale",
    "throttled",
    "delayed",
    "conflicting",
    "partial_coverage",
    "clock_skew",
  ] as const)(
    "allows last-good context only as visibly degraded for %s",
    (state) => {
      expect(
        contextSourceEmission({ ...source, state, displayAsLive: true }),
      ).toMatchObject({ canEmit: true, degraded: true, displayAsLive: false });
    },
  );

  it.each(SOURCE_HEALTH_STATES)(
    "simulation cannot acquire live authority through %s",
    (state) => {
      expect(
        contextSourceEmission({
          ...source,
          class: "simulated_industrial",
          rightsState: "not_required",
          state,
          displayAsLive: true,
        }),
      ).toMatchObject({
        canEmit: state === "simulated",
        displayAsLive: false,
        demoOnly: true,
      });
    },
  );

  it("keeps external demo approval distinct from production/live rights", () => {
    expect(
      contextSourceEmission({
        ...source,
        class: "live_external",
        rightsState: "demo_approved",
        state: "live",
        displayAsLive: true,
      }),
    ).toMatchObject({ canEmit: true, demoOnly: true, displayAsLive: false });
    expect(
      contextSourceEmission({
        ...source,
        class: "live_external",
        rightsState: "production_approved",
        state: "live",
        displayAsLive: true,
      }),
    ).toMatchObject({ canEmit: true, demoOnly: false, displayAsLive: true });
  });

  it.each([
    "customer_authorized",
    "not_required",
    "unreviewed",
    "blocked",
    "expired",
  ] as const)(
    "does not substitute %s for external source approval",
    (rightsState) => {
      expect(
        contextSourceEmission({
          ...source,
          class: "live_external",
          rightsState,
          state: "live",
          displayAsLive: true,
        }),
      ).toMatchObject({
        canEmit: false,
        displayAsLive: false,
        reason: "source_rights",
      });
    },
  );

  it("does not relabel customer or external observations as simulation", () => {
    expect(
      contextSourceEmission({ ...source, state: "simulated" }).canEmit,
    ).toBe(false);
    expect(
      contextSourceEmission({
        ...source,
        class: "live_external",
        rightsState: "production_approved",
        state: "simulated",
      }).canEmit,
    ).toBe(false);
  });
});

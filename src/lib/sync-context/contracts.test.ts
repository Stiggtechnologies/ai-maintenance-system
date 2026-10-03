import { describe, expect, it } from "vitest";
import {
  canDisplaySourceAsLive,
  deriveWorkGovernanceState,
  parseSyncContextSnapshot,
  type ContextSource,
} from "./contracts";

const source: ContextSource = {
  id: "source-1",
  organizationId: "org-a",
  key: "customer-gis",
  name: "Customer GIS",
  class: "customer_operational",
  authority: "tenant_authorized",
  purpose: "Source-supplied asset geometry for maintenance context.",
  rightsState: "customer_authorized",
  state: "live",
  checkedAt: "2026-10-03T10:00:00Z",
  observedAt: "2026-10-03T09:59:00Z",
  detail: null,
  displayAsLive: true,
};

function object(sourceValue: ContextSource = source) {
  return {
    id: "object-1",
    organizationId: "org-a",
    layerId: "assets_sites",
    kind: "asset",
    name: "Pump P-101",
    geometryType: "Point",
    geometry: { type: "Point", coordinates: [1, 2] },
    source: {
      id: sourceValue.id,
      organizationId: sourceValue.organizationId,
      key: sourceValue.key,
      class: sourceValue.class,
      authority: sourceValue.authority,
      healthState: sourceValue.state,
    },
    observedAt: "2026-10-03T09:59:00Z",
    validUntil: null,
    validityKind: "permanent",
    freshness: "current",
    dataQuality: "unknown",
    evidenceIds: [],
    missingEvidence: ["Independent coordinate survey"],
    evidenceState: "draft",
    authority: { operational: false, label: "Draft evidence" },
    subjects: [{ type: "asset", id: "asset-1" }],
    engineeringClaims: [],
  };
}

function event(sourceValue: ContextSource = source) {
  return {
    id: "event-1",
    organizationId: "org-a",
    layerId: "assets_sites",
    kind: "observation",
    title: "Pump observed",
    occurredAt: "2026-10-03T09:59:00Z",
    canonicalRecord: { type: "geospatial_feature", id: "object-1" },
    source: {
      id: sourceValue.id,
      organizationId: sourceValue.organizationId,
      key: sourceValue.key,
      class: sourceValue.class,
    },
    governanceState: "recommended",
    approvalId: null,
    operationalAuthority: false,
    evidenceIds: [],
    engineeringClaims: [],
  };
}

interface RawSnapshot {
  organizationId: string;
  generatedAt: string;
  operationalAuthority: boolean;
  sources: unknown[];
  layers: unknown[];
  objects: unknown[];
  events: unknown[];
}

function snapshot(): RawSnapshot {
  return {
    organizationId: "org-a",
    generatedAt: "2026-10-03T10:00:00Z",
    operationalAuthority: false,
    sources: [source],
    layers: [
      {
        id: "assets_sites",
        label: "Assets and sites",
        renderMode: "object",
        authorized: true,
        sourceDependencies: [source.id],
        healthStates: ["live"],
        availability: "available",
        recordCount: 1,
        empty: false,
        degraded: false,
        issues: [],
      },
    ],
    objects: [object()],
    events: [event()],
  };
}

describe("Sync Context canonical browser contract", () => {
  it("accepts a bounded same-tenant, non-authoritative projection", () => {
    const parsed = parseSyncContextSnapshot(snapshot());
    expect(parsed.organizationId).toBe("org-a");
    expect(parsed.issues).toEqual([]);
    expect(parsed.objects[0]?.dataQuality).toBe("unknown");
  });

  it("isolates malformed sources and layers without crashing valid layers", () => {
    const raw = snapshot();
    raw.sources.push({ id: "bad-source", organizationId: "org-a" });
    raw.layers.push({ id: "bad-layer", renderMode: "telepathy" });
    raw.layers[0] = {
      ...(raw.layers[0] as Record<string, unknown>),
      sourceDependencies: [source.id, "bad-source"],
    };
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0]).toMatchObject({
      id: "assets_sites",
      availability: "degraded",
      degraded: true,
      sourceDependencies: [source.id],
    });
    expect(parsed.issues.map((issue) => issue.scope)).toEqual([
      "source",
      "layer",
    ]);
  });

  it("isolates cross-tenant and unknown source references", () => {
    const raw = snapshot();
    raw.sources.push({ ...source, id: "foreign", organizationId: "org-b" });
    raw.objects.push(object({ ...source, id: "unknown" }));
    raw.events.push({
      ...event(),
      id: "event-bad",
      source: {
        id: source.id,
        organizationId: "org-b",
        key: source.key,
        class: source.class,
      },
    });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.issues.map((issue) => issue.scope)).toEqual([
      "source",
      "object",
      "event",
    ]);
  });

  it("refuses invented canonical subject and event identities", () => {
    const raw = snapshot();
    raw.objects.push({
      ...object(),
      id: "invented-subject",
      subjects: [{ type: "imaginary_asset", id: "made-up" }],
    });
    raw.events.push({
      ...event(),
      id: "invented-event-record",
      canonicalRecord: { type: "imaginary_event", id: "made-up" },
    });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      "Unsupported canonical Context subject type.",
      "Unsupported canonical Context event record type.",
    ]);
  });

  it("refuses a normalized SpatialObject with no canonical subject", () => {
    const raw = snapshot();
    raw.objects.push({ ...object(), id: "unlinked-object", subjects: [] });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.objects.map((item) => item.id)).toEqual(["object-1"]);
    expect(parsed.issues.at(-1)).toMatchObject({
      scope: "object",
      message: "SpatialObject requires a canonical subject.",
    });
  });

  it("never relabels simulations, stale, conflicting, or unlicensed data as live", () => {
    expect(canDisplaySourceAsLive(source)).toBe(true);
    for (const changed of [
      {
        ...source,
        class: "simulated_industrial" as const,
        rightsState: "not_required" as const,
      },
      {
        ...source,
        class: "live_external" as const,
        rightsState: "demo_approved" as const,
      },
      { ...source, state: "stale" as const },
      { ...source, state: "conflicting" as const },
    ]) {
      expect(canDisplaySourceAsLive(changed)).toBe(false);
    }
  });

  it("preserves unknown and refuses unverified engineering claims", () => {
    const accepted = parseSyncContextSnapshot(snapshot());
    expect(accepted.objects[0]?.dataQuality).toBe("unknown");

    const raw = snapshot();
    raw.objects.push({
      ...object(),
      id: "unapproved-limit",
      engineeringClaims: [
        {
          name: "Pressure limit",
          value: 100,
          unit: "kPa",
          evidenceIds: [],
          evidenceState: "draft",
        },
      ],
    });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.objects.some((item) => item.id === "unapproved-limit")).toBe(
      false,
    );
    expect(parsed.issues.at(-1)?.message).toContain(
      "verified canonical evidence",
    );
  });

  it("requires explicit approval and treats actual work as executed", () => {
    expect(deriveWorkGovernanceState("scheduled", false)).toBe("recommended");
    expect(deriveWorkGovernanceState("scheduled", true)).toBe("approved");
    expect(deriveWorkGovernanceState("in_progress", false)).toBe("executed");
    expect(deriveWorkGovernanceState("completed", false)).toBe("executed");

    const raw = snapshot();
    raw.events.push({
      ...event(),
      id: "false-approval",
      governanceState: "approved",
    });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.events.some((item) => item.id === "false-approval")).toBe(
      false,
    );
    expect(parsed.issues.at(-1)?.message).toContain("canonical approval");
  });

  it("drops person identity without losing unrelated Context records", () => {
    const raw = snapshot();
    raw.objects.push({
      ...object(),
      id: "tracked-person",
      personId: "person-1",
    });
    const parsed = parseSyncContextSnapshot(raw);
    expect(parsed.objects).toHaveLength(1);
    expect(parsed.issues.at(-1)?.message).toContain("Person identity");
  });

  it("still fails closed on top-level operational authority", () => {
    const raw = snapshot();
    raw.operationalAuthority = true;
    expect(() => parseSyncContextSnapshot(raw)).toThrow(
      "may not assert operational authority",
    );
  });
});

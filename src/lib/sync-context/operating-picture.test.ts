import { describe, expect, it } from "vitest";
import { parseSyncContextOperatingPicture } from "./operating-picture";

function fixture() {
  const source = {
    id: "source-1",
    organizationId: "tenant-a",
    key: "gis",
    name: "Customer GIS",
    class: "customer_operational",
    authority: "tenant_authorized",
    purpose: "Customer authorized surveyed asset geometry.",
    rightsState: "customer_authorized",
    state: "connected",
    checkedAt: "2026-10-10T05:00:00Z",
    observedAt: "2026-10-10T04:59:00Z" as string | null,
    detail: null,
    displayAsLive: false,
  };
  return {
    organizationId: "tenant-a",
    generatedAt: "2026-10-10T05:01:00Z",
    operationalAuthority: false,
    scope: { siteId: null, objectLimit: 250, eventLimit: 250 },
    coverage: {
      objects: {
        eligible: 1,
        returned: 1,
        truncated: false,
        draftExcluded: 2,
        expiredExcluded: 1,
        unlinkedExcluded: 0,
        coordinateContractMissing: 3,
        healthBlocked: 0,
      },
      events: { eligible: 0, returned: 0, truncated: false },
    },
    sources: [source],
    layers: [
      {
        id: "assets_sites",
        label: "Assets and sites",
        renderMode: "object",
        authorized: true,
        sourceDependencies: [source.id],
        healthStates: ["connected"],
        availability: "available",
        recordCount: 1,
        empty: false,
        degraded: false,
        issues: [],
      },
    ],
    objects: [
      {
        id: "feature-1",
        organizationId: "tenant-a",
        layerId: "assets_sites",
        kind: "asset",
        name: "Pump P-101",
        geometryType: "Point",
        geometry: { type: "Point", coordinates: [-111.38, 56.73] },
        coordinate: {
          referenceSystem: "EPSG:4326",
          axisOrder: "longitude_latitude",
          basis: "Source GIS survey reviewed against canonical evidence.",
          horizontalAccuracyM: null,
        },
        sourceReference: "Customer GIS surveyed feature P-101 revision 4",
        source: {
          id: source.id,
          organizationId: source.organizationId,
          key: source.key,
          class: source.class,
          authority: source.authority,
          healthState: source.state,
        },
        observedAt: "2026-10-10T04:59:00Z",
        validUntil: null as string | null,
        validityKind: "permanent",
        freshness: "current",
        dataQuality: "verified",
        evidenceIds: ["evidence-1"],
        missingEvidence: ["Survey accuracy not supplied"],
        evidenceState: "verified",
        authority: {
          operational: false,
          label: "Verified context; no operational authority",
        },
        subjects: [{ type: "asset", id: "asset-1" }],
        engineeringClaims: [],
      },
    ],
    events: [] as unknown[],
  };
}

describe("SC-02 bounded operating-picture browser input", () => {
  it("consumes canonical snapshot identity plus explicit coordinate and coverage contracts", () => {
    const raw = fixture();
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.objects[0]).toMatchObject({
      id: "feature-1",
      sourceReference: raw.objects[0].sourceReference,
      coordinate: raw.objects[0].coordinate,
      subjects: [{ type: "asset", id: "asset-1" }],
    });
    expect(result.coverage).toEqual(raw.coverage);
    expect(result.scope).toEqual(raw.scope);
    expect(result.issues).toEqual([]);
    expect(result.operationalAuthority).toBe(false);
  });

  it.each(["not_connected", "unavailable", "malformed"])(
    "does not emit data from %s sources",
    (state) => {
      const raw = fixture();
      raw.sources[0].state = state;
      raw.objects[0].source.healthState = state;
      const result = parseSyncContextOperatingPicture(raw);
      expect(result.sources).toHaveLength(1);
      expect(result.objects).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ scope: "object", id: "feature-1" }),
      );
      // Returned server rows are not silently rewritten into fabricated query coverage.
      expect(result.coverage.objects.returned).toBe(1);
    },
  );

  it("keeps revocation visible while refusing the corresponding geometry", () => {
    const raw = fixture();
    raw.sources[0].rightsState = "blocked";
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.sources[0].rightsState).toBe("blocked");
    expect(result.objects).toEqual([]);
  });

  it("does not render draft, expired or unauthorized objects as operational", () => {
    for (const kind of ["draft", "expired", "unauthorized", "noncurrent"]) {
      const raw = fixture();
      if (kind === "draft") raw.objects[0].evidenceState = "draft";
      if (kind === "expired") {
        raw.objects[0].validityKind = "temporary";
        raw.objects[0].validUntil = "2026-10-10T05:00:00Z";
      }
      if (kind === "unauthorized") raw.layers[0].authorized = false;
      if (kind === "noncurrent") raw.objects[0].freshness = "expired";
      expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
    }
  });

  it("isolates bad coordinate provenance without inventing a CRS or losing source health", () => {
    const raw = fixture();
    raw.objects[0].coordinate.referenceSystem = "unknown";
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.objects).toEqual([]);
    expect(result.sources).toHaveLength(1);
    expect(result.issues[0].message).toMatch(/coordinate|WGS84/i);
  });

  it.each([
    undefined,
    null,
    {},
    { objects: { eligible: 1, returned: 1, truncated: false } },
  ])("refuses missing coverage instead of displaying zero (%j)", (coverage) => {
    expect(() =>
      parseSyncContextOperatingPicture({ ...fixture(), coverage }),
    ).toThrow();
  });

  it.each([
    { eligible: 0 },
    { returned: 2 },
    { returned: -1 },
    { eligible: 1.5 },
    { eligible: Number.POSITIVE_INFINITY },
    { truncated: true },
    { draftExcluded: -1 },
  ])("refuses inconsistent query counts (%j)", (counts) => {
    const raw = fixture();
    Object.assign(raw.coverage.objects, counts);
    expect(() => parseSyncContextOperatingPicture(raw)).toThrow();
  });

  it("keeps truncation explicit rather than implying complete tenant coverage", () => {
    const raw = fixture();
    Object.assign(raw.coverage.objects, {
      eligible: 251,
      returned: 1,
      truncated: true,
    });
    expect(
      parseSyncContextOperatingPicture(raw).coverage.objects.truncated,
    ).toBe(true);
  });

  it.each([
    { objectLimit: 0 },
    { objectLimit: 501 },
    { objectLimit: 1.5 },
    { eventLimit: -1 },
    { eventLimit: 501 },
    { siteId: "foreign-not-a-uuid" },
  ])("refuses malformed scope (%j)", (scope) => {
    const raw = fixture();
    Object.assign(raw.scope, scope);
    expect(() => parseSyncContextOperatingPicture(raw)).toThrow();
  });

  it("refuses duplicate object IDs rather than attaching one object's provenance to another", () => {
    const raw = fixture();
    raw.objects.push(structuredClone(raw.objects[0]));
    Object.assign(raw.coverage.objects, { eligible: 2, returned: 2 });
    expect(() => parseSyncContextOperatingPicture(raw)).toThrow(/duplicate/i);
  });

  it("refuses duplicate layer identities instead of choosing the most permissive copy", () => {
    const raw = fixture();
    raw.layers.push({ ...raw.layers[0], authorized: false });
    expect(() => parseSyncContextOperatingPicture(raw)).toThrow(/duplicate/i);
  });

  it("bounds object and event arrays before accepting query metadata", () => {
    const raw = fixture();
    expect(() =>
      parseSyncContextOperatingPicture({
        ...raw,
        objects: Array.from({ length: 501 }, () => null),
      }),
    ).toThrow(/limit/i);
    expect(() =>
      parseSyncContextOperatingPicture({
        ...raw,
        events: Array.from({ length: 501 }, () => null),
      }),
    ).toThrow(/limit/i);
  });

  it("does not label a blocked-source layer empty or available", () => {
    const raw = fixture();
    raw.sources[0].state = "not_connected";
    raw.objects[0].source.healthState = "not_connected";
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.layers[0]).toMatchObject({
      availability: "unavailable",
      degraded: true,
      recordCount: 1,
    });
  });

  it("keeps work history as unlocated context and suppresses it when its source is unavailable", () => {
    const raw = fixture();
    raw.events.push({
      id: "work-event-1",
      organizationId: "tenant-a",
      layerId: "assets_sites",
      kind: "status_changed",
      title: "Work status recorded",
      occurredAt: "2026-10-10T04:59:00Z",
      canonicalRecord: { type: "work_order", id: "work-1" },
      source: {
        id: "source-1",
        organizationId: "tenant-a",
        key: "gis",
        class: "customer_operational",
      },
      governanceState: "recommended",
      approvalId: null,
      operationalAuthority: false,
      evidenceIds: [],
      engineeringClaims: [],
    });
    Object.assign(raw.coverage.events, { eligible: 1, returned: 1 });
    const located = parseSyncContextOperatingPicture(raw);
    expect(located.events).toHaveLength(1);
    expect(located.events[0]).not.toHaveProperty("geometry");
    raw.sources[0].state = "unavailable";
    raw.objects[0].source.healthState = "unavailable";
    const unavailable = parseSyncContextOperatingPicture(raw);
    expect(unavailable.events).toEqual([]);
    expect(unavailable.issues).toContainEqual(
      expect.objectContaining({ scope: "event", id: "work-event-1" }),
    );
  });

  it.each(["unavailable", "empty", "unauthorized"])(
    "does not emit on a %s layer",
    (availability) => {
      const raw = fixture();
      raw.layers[0].availability = availability;
      expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
    },
  );
  it("requires an object's source to be a declared dependency of its layer", () => {
    const raw = fixture();
    raw.layers[0].sourceDependencies = [];
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.objects).toEqual([]);
    expect(result.layers[0].availability).toBe("unavailable");
  });
  it("does not emit geometry on an event-only layer", () => {
    const raw = fixture();
    raw.layers[0].renderMode = "event";
    expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
  });
  it("requires canonical evidence references even when the supplied state says verified", () => {
    const raw = fixture();
    raw.objects[0].evidenceIds = [];
    expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
  });
  it("preserves raw object issue indices after earlier malformed rows", () => {
    const raw = fixture();
    const payload = {
      ...raw,
      objects: [null, { ...raw.objects[0], coordinate: null }],
    };
    Object.assign(payload.coverage.objects, { eligible: 2, returned: 2 });
    expect(parseSyncContextOperatingPicture(payload).issues).toContainEqual(
      expect.objectContaining({ scope: "object", id: "feature-1", index: 1 }),
    );
  });
  it.each(["not a time", "2026-10-10T05:02:00Z"])(
    "does not emit source data checked at %s",
    (checkedAt) => {
      const raw = fixture();
      raw.sources[0].checkedAt = checkedAt;
      const result = parseSyncContextOperatingPicture(raw);
      expect(result.objects).toEqual([]);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ scope: "source", id: "source-1", index: 0 }),
      );
    },
  );
  it("does not render a future object observation as current", () => {
    const raw = fixture();
    raw.objects[0].observedAt = "2026-10-10T05:02:00Z";
    expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
  });
  it("derives layer health from the canonical source instead of stale copied health", () => {
    const raw = fixture();
    raw.sources[0].state = "stale";
    raw.objects[0].source.healthState = "stale";
    expect(parseSyncContextOperatingPicture(raw).layers[0]).toMatchObject({
      healthStates: ["stale"],
      availability: "degraded",
    });
  });
  it("retains explicit simulated/demo-only display meaning without inventing authority", () => {
    const raw = fixture();
    raw.sources[0].class = "simulated_industrial";
    raw.sources[0].rightsState = "not_required";
    raw.sources[0].state = "simulated";
    raw.objects[0].source.class = "simulated_industrial";
    raw.objects[0].source.healthState = "simulated";
    expect(parseSyncContextOperatingPicture(raw).objects[0]).toMatchObject({
      display: { demoOnly: true, live: false, degraded: false },
      authority: { operational: false },
    });
  });

  it("retains layer degradation even when a source is healthy and live", () => {
    const raw = fixture();
    raw.layers[0].degraded = true;
    raw.sources[0].state = "live";
    raw.sources[0].displayAsLive = true;
    raw.objects[0].source.healthState = "live";
    const result = parseSyncContextOperatingPicture(raw);
    expect(result.layers[0].availability).toBe("degraded");
    expect(result.objects[0].display).toEqual({
      demoOnly: false,
      live: false,
      degraded: true,
    });
  });

  it.each(["1", "2026-02-30T05:00:00Z", "2026-10-09T05:00:00"])(
    "requires an actual zoned calendar timestamp, not Date.parse coercion (%s)",
    (checkedAt) => {
      const raw = fixture();
      raw.sources[0].checkedAt = checkedAt;
      raw.sources[0].observedAt = null;
      expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
    },
  );

  it.each([
    { empty: true, recordCount: 0 },
    { empty: true, recordCount: 1 },
    { empty: false, recordCount: 0 },
  ])(
    "does not emit objects on an empty or internally inconsistent layer (%j)",
    (counts) => {
      const raw = fixture();
      Object.assign(raw.layers[0], counts);
      expect(parseSyncContextOperatingPicture(raw).objects).toEqual([]);
    },
  );
});

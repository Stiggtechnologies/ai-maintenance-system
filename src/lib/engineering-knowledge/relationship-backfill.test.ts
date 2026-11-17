import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "../asset-twins/compiler";
import { centrifugalPumpTemplate } from "../asset-twins/centrifugal-pump";
import { getSharedComponentDna } from "../asset-twins/shared-component-dna-library";
import type { CustomerAssetTwinInstance } from "../asset-twins/types";
import { relationshipsFromCompiledTwin } from "./relationship-backfill";

const asset: CustomerAssetTwinInstance = {
  assetId: "twin-pump-1",
  assetClassCode: "ROT-CENT-PUMP",
  siteId: "site-1",
  operatingContext: {},
  telemetryMap: {},
  customerOverrides: {},
  baselineStatus: "not_started",
};

describe("relationship backfill from compiled twins", () => {
  const twin = compileAssetTwin(centrifugalPumpTemplate, asset);
  const edges = relationshipsFromCompiledTwin(twin, getSharedComponentDna);

  it("links the wet end to its failure and detection method by canonical id", () => {
    expect(
      edges.some(
        (item) =>
          item.relationshipType === "may_fail_by" &&
          item.fromCanonicalId === "PUMP-WET-END" &&
          item.toCanonicalId === "PUMP-WET-END-CAVITATION",
      ),
    ).toBe(true);
    expect(
      edges.some(
        (item) =>
          item.relationshipType === "detected_by" &&
          item.fromCanonicalId === "PUMP-WET-END-CAVITATION" &&
          item.toCanonicalId === "vibration",
      ),
    ).toBe(true);
    expect(
      edges.some(
        (item) =>
          item.relationshipType === "supported_by" &&
          item.fromCanonicalId === "PUMP-WET-END" &&
          item.toCanonicalId === "COMP-DNA-PUMP-CENTRIFUGAL",
      ),
    ).toBe(true);
  });

  it("keeps every backfilled edge draft and does not copy profile text", () => {
    expect(edges.every((item) => item.provenanceChunkIds.length === 0)).toBe(
      true,
    );
    expect(
      edges.every((item) =>
        item.provenanceCanonicalIds.includes("ROT-CENT-PUMP"),
      ),
    ).toBe(true);
    const serialized = JSON.stringify(edges);
    expect(serialized).not.toContain(
      "Erosion or wear changing hydraulic geometry",
    );
    expect(serialized).not.toContain("vapour bubble");
    expect(
      edges.some(
        (item) =>
          item.fromCanonicalId === item.toCanonicalId &&
          item.fromEntityType === item.toEntityType,
      ),
    ).toBe(false);
  });
});

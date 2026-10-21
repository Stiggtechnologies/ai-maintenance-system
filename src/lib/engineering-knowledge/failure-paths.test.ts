import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "../asset-twins/compiler";
import { centrifugalPumpTemplate } from "../asset-twins/centrifugal-pump";
import { getSharedComponentDna } from "../asset-twins/shared-component-dna-library";
import type { CustomerAssetTwinInstance } from "../asset-twins/types";
import {
  detectionEdgesFromCompiledTwin,
  queryFailureDetectionPaths,
  type FailurePathStep,
} from "./failure-paths";

const asset: CustomerAssetTwinInstance = {
  assetId: "twin-pump-1",
  assetClassCode: "ROT-CENT-PUMP",
  siteId: "site-1",
  operatingContext: {},
  telemetryMap: {},
  customerOverrides: {},
  baselineStatus: "not_started",
};

describe("failure detection paths", () => {
  const edges = detectionEdgesFromCompiledTwin(
    compileAssetTwin(centrifugalPumpTemplate, asset),
    getSharedComponentDna,
  );

  it("walks the wet-end failure to a detection method without copying profile text", () => {
    const result = queryFailureDetectionPaths(edges, "PUMP-WET-END");
    const matched = result.paths.find(
      (path) =>
        path.steps.some(
          (step) =>
            step.relationshipType === "may_fail_by" &&
            step.toCanonicalId === "PUMP-WET-END-CAVITATION",
        ) &&
        path.steps.some(
          (step, index) =>
            step.relationshipType === "detected_by" &&
            step.toCanonicalId === "vibration" &&
            index >
              path.steps.findIndex(
                (item) => item.toCanonicalId === "PUMP-WET-END-CAVITATION",
              ),
        ),
    );
    expect(matched).toBeTruthy();
    expect(result.grantsAuthority).toBe(false);
    expect(result.grantsWorkRelease).toBe(false);
    expect(result.grantsApproval).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("vapour bubble");
    expect(serialized).not.toContain(
      "Erosion or wear changing hydraulic geometry",
    );
    expect(serialized).not.toContain("propagationProbability");
  });

  it("stops at the requested depth and ignores rejected edges and cycles", () => {
    const shallow = queryFailureDetectionPaths(edges, "PUMP-WET-END", 1);
    expect(shallow.paths.every((path) => path.steps.length === 1)).toBe(true);
    expect(
      shallow.paths.some((path) =>
        path.steps.some((step) => step.relationshipType === "detected_by"),
      ),
    ).toBe(false);

    const rejected: FailurePathStep = {
      relationshipType: "may_fail_by",
      relationshipCode: "rejected-edge",
      reviewState: "rejected",
      fromEntityType: "component",
      fromCanonicalId: "PUMP-WET-END",
      toEntityType: "failure_mode",
      toCanonicalId: "SHOULD-NOT-APPEAR",
    };
    const hidden = queryFailureDetectionPaths([rejected], "PUMP-WET-END");
    expect(hidden.paths).toEqual([]);

    const cycle: FailurePathStep[] = [
      {
        relationshipType: "composed_of",
        relationshipCode: "cycle-a",
        reviewState: "draft",
        fromEntityType: "component",
        fromCanonicalId: "EKG-CYCLE-A",
        toEntityType: "component",
        toCanonicalId: "EKG-CYCLE-B",
      },
      {
        relationshipType: "composed_of",
        relationshipCode: "cycle-b",
        reviewState: "draft",
        fromEntityType: "component",
        fromCanonicalId: "EKG-CYCLE-B",
        toEntityType: "component",
        toCanonicalId: "EKG-CYCLE-A",
      },
    ];
    const walked = queryFailureDetectionPaths(cycle, "EKG-CYCLE-A");
    expect(walked.truncated).toBe(false);
    expect(walked.paths).toHaveLength(1);
    expect(walked.paths[0].steps.map((step) => step.relationshipCode)).toEqual([
      "cycle-a",
    ]);
    expect(
      walked.paths[0].steps.some(
        (step) => step.toCanonicalId === "EKG-CYCLE-A",
      ),
    ).toBe(false);
  });
});

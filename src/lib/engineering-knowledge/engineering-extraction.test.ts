import { describe, expect, it } from "vitest";
import {
  resolveEngineeringExtraction,
  type EngineeringExtractionCandidate,
} from "./engineering-extraction";
import type { CanonicalKnowledgeRegistry } from "./knowledge-base-factory";

const registry: CanonicalKnowledgeRegistry = {
  assetClassCodes: ["PROC-BALL-MILL", "PROC-SAG-MILL"],
  engineeringDnaCodes: ["DEDNA-PROC-BALL-MILL"],
  assetTwinIds: [],
  componentCodes: ["BM-TRUNNION-BEARING", "BM-DRIVE"],
  sharedComponentDnaCodes: ["SCDNA-ROLLING-BEARING"],
  failureModeCodes: ["BM-TRUNNION-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
};

const candidate = (
  overrides: Partial<EngineeringExtractionCandidate> = {},
): EngineeringExtractionCandidate => ({
  entityType: "component",
  mention: "discharge trunnion bearing",
  candidateCanonicalIds: ["BM-TRUNNION-BEARING"],
  confidence: 0.94,
  sourceChunkIds: ["chunk-12"],
  ...overrides,
});

describe("resolveEngineeringExtraction", () => {
  it("accepts a confident canonical mapping and builds a metadata patch", () => {
    const result = resolveEngineeringExtraction(
      "manual-1",
      [
        candidate({
          entityType: "asset_class",
          mention: "ball mill",
          candidateCanonicalIds: ["PROC-BALL-MILL"],
        }),
        candidate(),
        candidate({
          entityType: "failure_mode",
          mention: "bearing degradation",
          candidateCanonicalIds: ["BM-TRUNNION-BEARING-DEGRADE"],
        }),
        candidate({
          entityType: "physics_capability",
          mention: "bearing characteristic frequencies",
          candidateCanonicalIds: ["PHYS-BEARING-KINEMATICS"],
        }),
      ],
      registry,
    );

    expect(result.humanReviewRequired).toBe(false);
    expect(result.issues).toEqual([]);
    expect(result.resolved.every((item) => item.disposition === "accepted")).toBe(true);
    expect(result.metadataPatch).toEqual({
      assetClassCode: "PROC-BALL-MILL",
      componentCodes: ["BM-TRUNNION-BEARING"],
      sharedComponentDnaCodes: [],
      failureModeCodes: ["BM-TRUNNION-BEARING-DEGRADE"],
      physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
    });
  });

  it("requires review when more than one canonical candidate remains", () => {
    const result = resolveEngineeringExtraction(
      "manual-2",
      [
        candidate({
          entityType: "asset_class",
          mention: "grinding mill",
          candidateCanonicalIds: ["PROC-BALL-MILL", "PROC-SAG-MILL"],
        }),
      ],
      registry,
    );

    expect(result.resolved[0].disposition).toBe("ambiguous");
    expect(result.humanReviewRequired).toBe(true);
    expect(result.issues[0].message).toMatch(/disambiguation/i);
    expect(result.metadataPatch.assetClassCode).toBeUndefined();
  });

  it("flags unknown canonical identifiers instead of publishing them", () => {
    const result = resolveEngineeringExtraction(
      "manual-3",
      [candidate({ candidateCanonicalIds: ["UNKNOWN-COMPONENT"] })],
      registry,
    );

    expect(result.resolved[0].disposition).toBe("unknown");
    expect(result.resolved[0].canonicalId).toBeUndefined();
    expect(result.metadataPatch.componentCodes).toEqual([]);
    expect(result.humanReviewRequired).toBe(true);
  });

  it("rejects high-confidence mappings that lack source-chunk evidence", () => {
    const result = resolveEngineeringExtraction(
      "manual-4",
      [candidate({ sourceChunkIds: [] })],
      registry,
    );

    expect(result.resolved[0].disposition).toBe("rejected");
    expect(result.humanReviewRequired).toBe(true);
  });

  it("routes medium-confidence single matches to human review", () => {
    const result = resolveEngineeringExtraction(
      "manual-5",
      [candidate({ confidence: 0.72 })],
      registry,
    );

    expect(result.resolved[0]).toEqual(
      expect.objectContaining({
        disposition: "ambiguous",
        canonicalId: "BM-TRUNNION-BEARING",
      }),
    );
  });

  it("clamps invalid confidence and rejects low-confidence extraction", () => {
    const result = resolveEngineeringExtraction(
      "manual-6",
      [candidate({ confidence: Number.NaN })],
      registry,
    );

    expect(result.resolved[0].confidence).toBe(0);
    expect(result.resolved[0].disposition).toBe("rejected");
  });

  it("rejects an invalid policy ordering", () => {
    const result = resolveEngineeringExtraction(
      "manual-7",
      [candidate()],
      registry,
      {
        minimumAcceptedConfidence: 0.5,
        minimumReviewConfidence: 0.7,
        requireSourceChunks: true,
      },
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "policy.minimumAcceptedConfidence",
          severity: "blocking",
        }),
      ]),
    );
  });
});

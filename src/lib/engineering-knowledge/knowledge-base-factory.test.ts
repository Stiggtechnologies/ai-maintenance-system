import { describe, expect, it } from "vitest";
import {
  buildKnowledgeFactoryPlan,
  type CanonicalKnowledgeRegistry,
  type KnowledgeFactoryInput,
} from "./knowledge-base-factory";

const registry: CanonicalKnowledgeRegistry = {
  assetClassCodes: ["PROC-SAG-MILL"],
  engineeringDnaCodes: ["DEDNA-PROC-SAG-MILL"],
  assetTwinIds: ["twin-sag-1"],
  componentCodes: ["SAG-TRUNNION-BEARING"],
  sharedComponentDnaCodes: ["SCDNA-ROLLING-BEARING"],
  failureModeCodes: ["SAG-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
};

function input(overrides: Partial<KnowledgeFactoryInput> = {}): KnowledgeFactoryInput {
  return {
    registry,
    extractedTextLength: 12000,
    chunkCount: 14,
    requestedBy: "human",
    metadata: {
      sourceId: "OEM-SAG-001",
      title: "SAG mill bearing manual",
      documentType: "manual",
      tenantId: "tenant-1",
      assetClassCode: "PROC-SAG-MILL",
      engineeringDnaCode: "DEDNA-PROC-SAG-MILL",
      assetTwinId: "twin-sag-1",
      componentCodes: ["SAG-TRUNNION-BEARING"],
      sharedComponentDnaCodes: ["SCDNA-ROLLING-BEARING"],
      failureModeCodes: ["SAG-BEARING-DEGRADE"],
      physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
      manufacturer: "Authorized OEM",
      model: "Reference model",
      revision: "1",
      authorityLevel: "oem_authorized",
      reviewState: "approved",
      confidentiality: "customer_confidential",
      checksum: "sha256:test",
    },
    ...overrides,
  };
}

describe("buildKnowledgeFactoryPlan", () => {
  it("publishes approved authoritative documents with valid canonical mappings", () => {
    const plan = buildKnowledgeFactoryPlan(input());
    expect(plan.decision).toBe("publish");
    expect(plan.gaps).toEqual([]);
    expect(plan.validationIssues).toEqual([]);
    expect(plan.canonicalEntities.some((entity) => entity.entityType === "failure_mode")).toBe(true);
    expect(plan.relationships.every((relationship) => relationship.provenanceSourceIds.includes("OEM-SAG-001"))).toBe(true);
  });

  it("rejects unknown canonical references", () => {
    const candidate = input();
    candidate.metadata.componentCodes = ["UNKNOWN-COMPONENT"];
    const plan = buildKnowledgeFactoryPlan(candidate);
    expect(plan.decision).toBe("reject");
    expect(plan.gaps).toContainEqual(expect.objectContaining({ code: "UNKNOWN-COMPONENT", severity: "blocking" }));
  });

  it("routes unmapped public knowledge for review", () => {
    const candidate = input();
    candidate.metadata.assetClassCode = undefined;
    candidate.metadata.engineeringDnaCode = undefined;
    candidate.metadata.assetTwinId = undefined;
    candidate.metadata.componentCodes = [];
    candidate.metadata.sharedComponentDnaCodes = [];
    candidate.metadata.failureModeCodes = [];
    candidate.metadata.physicsCapabilityCodes = [];
    candidate.metadata.authorityLevel = "authoritative_public";
    const plan = buildKnowledgeFactoryPlan(candidate);
    expect(plan.decision).toBe("review");
    expect(plan.publicationRequirements).toContain("canonical_engineering_mapping");
  });

  it("rejects documents with no extracted content or chunks", () => {
    const plan = buildKnowledgeFactoryPlan(input({ extractedTextLength: 0, chunkCount: 0 }));
    expect(plan.decision).toBe("reject");
    expect(plan.gaps.filter((gap) => gap.severity === "blocking")).toHaveLength(2);
  });

  it("does not publish AI-generated material as approved knowledge", () => {
    const candidate = input();
    candidate.metadata.authorityLevel = "ai_generated";
    const plan = buildKnowledgeFactoryPlan(candidate);
    expect(plan.decision).toBe("reject");
    expect(plan.validationIssues).toContainEqual(expect.objectContaining({ path: "authorityLevel" }));
  });

  it("requires a checksum before final publication", () => {
    const candidate = input();
    candidate.metadata.checksum = undefined;
    const plan = buildKnowledgeFactoryPlan(candidate);
    expect(plan.decision).toBe("publish");
    expect(plan.publicationRequirements).toContain("source_checksum");
  });
});

import { describe, expect, it } from "vitest";
import { buildKnowledgeFactoryPlan } from "./knowledge-base-factory";
import {
  documentMappingsFromFactoryPlan,
  validateDocumentEngineeringMapping,
  type DocumentEngineeringMapping,
} from "./document-mappings";
import type { EngineeringKnowledgeDocumentMetadata } from "./ontology";

const metadata: EngineeringKnowledgeDocumentMetadata = {
  sourceId: "source-1",
  title: "Pump manual",
  documentType: "manual",
  tenantId: "org-1",
  assetClassCode: "ROT-CENT-PUMP",
  assetTwinId: "twin-1",
  componentCodes: ["PUMP-WET-END"],
  sharedComponentDnaCodes: ["COMP-DNA-PUMP-CENTRIFUGAL"],
  failureModeCodes: ["PUMP-WET-END-CAVITATION"],
  physicsCapabilityCodes: ["PHYS-PUMP-HYDRAULICS"],
  authorityLevel: "oem_authorized",
  reviewState: "draft",
  confidentiality: "customer_confidential",
};

const mapping = (
  overrides: Partial<DocumentEngineeringMapping> = {},
): DocumentEngineeringMapping => ({
  entityType: "asset_twin",
  canonicalId: "twin-1",
  relationship: "applies_to",
  reviewState: "draft",
  provenanceChunkIds: ["chunk-1"],
  ...overrides,
});

describe("document engineering mappings", () => {
  it("keeps factory applicability as canonical references with chunk provenance", () => {
    const plan = buildKnowledgeFactoryPlan({
      metadata,
      registry: {
        assetClassCodes: ["ROT-CENT-PUMP"],
        engineeringDnaCodes: [],
        assetTwinIds: ["twin-1"],
        componentCodes: ["PUMP-WET-END"],
        sharedComponentDnaCodes: ["COMP-DNA-PUMP-CENTRIFUGAL"],
        failureModeCodes: ["PUMP-WET-END-CAVITATION"],
        physicsCapabilityCodes: ["PHYS-PUMP-HYDRAULICS"],
      },
      extractedTextLength: 20,
      chunkCount: 1,
      requestedBy: "human",
    });
    const mappings = documentMappingsFromFactoryPlan(plan, ["chunk-1"]);
    expect(mappings.map((item) => [item.entityType, item.canonicalId])).toEqual(
      [
        ["asset_class", "ROT-CENT-PUMP"],
        ["asset_twin", "twin-1"],
        ["component", "PUMP-WET-END"],
        ["shared_component", "COMP-DNA-PUMP-CENTRIFUGAL"],
        ["failure_mode", "PUMP-WET-END-CAVITATION"],
        ["physics_capability", "PHYS-PUMP-HYDRAULICS"],
      ],
    );
    expect(
      mappings.every((item) => item.provenanceChunkIds.join() === "chunk-1"),
    ).toBe(true);
    expect(JSON.stringify(mappings)).not.toContain("Pump manual");
  });

  it("rejects a mapping that has no canonical id or provenance", () => {
    expect(
      validateDocumentEngineeringMapping(mapping({ canonicalId: "  " })),
    ).toEqual([
      { path: "mapping.canonicalId", message: "Canonical id is required." },
    ]);
    expect(
      validateDocumentEngineeringMapping(mapping({ provenanceChunkIds: [] }))[0]
        ?.path,
    ).toBe("mapping.provenanceChunkIds");
  });

  it("does not emit mappings when provenance chunks are missing", () => {
    const plan = buildKnowledgeFactoryPlan({
      metadata,
      registry: {
        assetClassCodes: ["ROT-CENT-PUMP"],
        engineeringDnaCodes: [],
        assetTwinIds: ["twin-1"],
        componentCodes: ["PUMP-WET-END"],
        sharedComponentDnaCodes: ["COMP-DNA-PUMP-CENTRIFUGAL"],
        failureModeCodes: ["PUMP-WET-END-CAVITATION"],
        physicsCapabilityCodes: ["PHYS-PUMP-HYDRAULICS"],
      },
      extractedTextLength: 20,
      chunkCount: 1,
      requestedBy: "human",
    });
    expect(documentMappingsFromFactoryPlan(plan, [])).toEqual([]);
  });
});

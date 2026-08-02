import { describe, expect, it } from "vitest";
import {
  isKnowledgeApplicable,
  rankKnowledgeAuthority,
  validateEngineeringRelationship,
  validateKnowledgeDocumentMetadata,
  type EngineeringContextPackage,
  type EngineeringKnowledgeDocumentMetadata,
} from "./ontology";

const context: EngineeringContextPackage = {
  tenantId: "tenant-a",
  assetTwinId: "twin-sag-01",
  assetClassCode: "PROC-SAG-MILL",
  operatingState: "running_loaded",
  componentCodes: ["SAG-TRUNNION-BEARING"],
  candidateFailureModeCodes: ["SAG-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
  evidenceIds: [],
  sourceIds: [],
  sourceConflictIds: [],
  missingEvidence: [],
  humanApprovalRequired: true,
  autonomousOperationalActionAllowed: false,
};

const documentMetadata: EngineeringKnowledgeDocumentMetadata = {
  sourceId: "oem-sag-bearing-manual-r3",
  title: "SAG mill bearing manual",
  documentType: "oem_manual",
  tenantId: "tenant-a",
  assetClassCode: "PROC-SAG-MILL",
  componentCodes: ["SAG-TRUNNION-BEARING"],
  sharedComponentDnaCodes: [],
  failureModeCodes: ["SAG-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
  revision: "3",
  authorityLevel: "oem_authorized",
  reviewState: "approved",
  confidentiality: "customer_confidential",
};

describe("engineering knowledge ontology", () => {
  it("accepts an applicable approved engineering document", () => {
    expect(validateKnowledgeDocumentMetadata(documentMetadata)).toEqual([]);
    expect(isKnowledgeApplicable(documentMetadata, context)).toBe(true);
  });

  it("enforces tenant isolation for tenant-scoped knowledge", () => {
    expect(isKnowledgeApplicable({ ...documentMetadata, tenantId: "tenant-b" }, context)).toBe(false);
  });

  it("filters documents mapped to a different component", () => {
    expect(
      isKnowledgeApplicable({ ...documentMetadata, componentCodes: ["SAG-DRIVE"] }, context),
    ).toBe(false);
  });

  it("rejects superseded knowledge during applicability filtering", () => {
    expect(
      isKnowledgeApplicable(
        { ...documentMetadata, reviewState: "superseded", supersededDate: "2026-01-01" },
        context,
      ),
    ).toBe(false);
  });

  it("requires superseded dates and prevents AI material becoming authoritative", () => {
    expect(
      validateKnowledgeDocumentMetadata({
        ...documentMetadata,
        reviewState: "superseded",
        supersededDate: undefined,
      }),
    ).toContainEqual({
      path: "supersededDate",
      message: "Superseded documents require a superseded date.",
    });

    expect(
      validateKnowledgeDocumentMetadata({
        ...documentMetadata,
        authorityLevel: "ai_generated",
        reviewState: "approved",
      }),
    ).toContainEqual({
      path: "authorityLevel",
      message: "AI-generated material cannot be approved as an authoritative source.",
    });
  });

  it("requires provenance and rejects self-referencing graph edges", () => {
    const issues = validateEngineeringRelationship({
      code: "REL-001",
      relationshipType: "supported_by",
      from: { entityType: "failure_mode", canonicalId: "SAG-BEARING-DEGRADE" },
      to: { entityType: "failure_mode", canonicalId: "SAG-BEARING-DEGRADE" },
      provenanceSourceIds: [],
      reviewState: "draft",
      createdBy: "agent",
    });

    expect(issues).toContainEqual({
      path: "to",
      message: "A relationship cannot point an entity to itself.",
    });
    expect(issues).toContainEqual({
      path: "provenanceSourceIds",
      message: "At least one provenance source is required.",
    });
  });

  it("ranks governed sources above public and AI-generated material", () => {
    expect(rankKnowledgeAuthority("customer_approved")).toBeGreaterThan(
      rankKnowledgeAuthority("general_public"),
    );
    expect(rankKnowledgeAuthority("oem_authorized")).toBeGreaterThan(
      rankKnowledgeAuthority("ai_generated"),
    );
  });
});

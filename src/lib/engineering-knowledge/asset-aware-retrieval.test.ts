import { describe, expect, it } from "vitest";
import { buildAssetAwareRetrievalPlan } from "./asset-aware-retrieval";
import type {
  EngineeringContextPackage,
  EngineeringKnowledgeDocumentMetadata,
} from "./ontology";

const context: EngineeringContextPackage = {
  tenantId: "TENANT-1",
  assetTwinId: "TWIN-1",
  assetClassCode: "PROC-BALL-MILL",
  componentCodes: ["BM-TRUNNION-BEARING"],
  candidateFailureModeCodes: ["BM-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
  evidenceIds: [],
  sourceIds: [],
  sourceConflictIds: [],
  missingEvidence: [],
  humanApprovalRequired: true,
  autonomousOperationalActionAllowed: false,
};

const metadata = (
  sourceId: string,
  overrides: Partial<EngineeringKnowledgeDocumentMetadata> = {},
): EngineeringKnowledgeDocumentMetadata => ({
  sourceId,
  title: sourceId,
  documentType: "manual",
  tenantId: "TENANT-1",
  assetClassCode: "PROC-BALL-MILL",
  assetTwinId: "TWIN-1",
  componentCodes: ["BM-TRUNNION-BEARING"],
  sharedComponentDnaCodes: [],
  failureModeCodes: ["BM-BEARING-DEGRADE"],
  physicsCapabilityCodes: ["PHYS-BEARING-KINEMATICS"],
  authorityLevel: "oem_authorized",
  reviewState: "approved",
  confidentiality: "customer_confidential",
  effectiveDate: "2025-01-01",
  ...overrides,
});

describe("asset-aware retrieval", () => {
  it("filters by canonical engineering context and ranks authority", () => {
    const plan = buildAssetAwareRetrievalPlan(
      context,
      [
        { metadata: metadata("OEM"), semanticScore: 0.82, chunkIds: ["C1"] },
        {
          metadata: metadata("PUBLIC", {
            authorityLevel: "general_public",
            assetTwinId: undefined,
          }),
          semanticScore: 0.95,
          chunkIds: ["C2"],
        },
        {
          metadata: metadata("OTHER", { tenantId: "TENANT-2" }),
          semanticScore: 0.99,
          chunkIds: ["C3"],
        },
      ],
      {
        minimumSemanticScore: 0.7,
        maximumResults: 5,
        requireApprovedSources: true,
        now: "2026-08-02T00:00:00.000Z",
      },
    );

    expect(plan.included.map((item) => item.metadata.sourceId)).toEqual([
      "OEM",
      "PUBLIC",
    ]);
    expect(plan.excluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "OTHER" }),
      ]),
    );
  });

  it("rejects low scores, missing provenance, drafts, and superseded sources", () => {
    const plan = buildAssetAwareRetrievalPlan(
      context,
      [
        { metadata: metadata("LOW"), semanticScore: 0.4, chunkIds: ["C1"] },
        { metadata: metadata("NO-CHUNK"), semanticScore: 0.9, chunkIds: [] },
        {
          metadata: metadata("DRAFT", { reviewState: "draft" }),
          semanticScore: 0.9,
          chunkIds: ["C3"],
        },
        {
          metadata: metadata("OLD", {
            reviewState: "superseded",
            supersededDate: "2026-01-01",
          }),
          semanticScore: 0.9,
          chunkIds: ["C4"],
        },
      ],
      {
        minimumSemanticScore: 0.7,
        maximumResults: 5,
        requireApprovedSources: true,
      },
    );

    expect(plan.included).toHaveLength(0);
    expect(plan.excluded).toHaveLength(4);
  });

  it("flags revision conflicts and validates policy", () => {
    const plan = buildAssetAwareRetrievalPlan(
      context,
      [
        {
          metadata: metadata("REV-A", { revision: "A" }),
          semanticScore: 0.9,
          chunkIds: ["C1"],
        },
        {
          metadata: metadata("REV-B", { revision: "B" }),
          semanticScore: 0.9,
          chunkIds: ["C2"],
        },
      ],
      {
        minimumSemanticScore: 0.7,
        maximumResults: 5,
        requireApprovedSources: true,
      },
    );

    expect(plan.sourceConflictIds).toEqual(expect.arrayContaining(["REV-A", "REV-B"]));
    expect(() =>
      buildAssetAwareRetrievalPlan(context, [], {
        minimumSemanticScore: 2,
        maximumResults: 5,
        requireApprovedSources: true,
      }),
    ).toThrow("minimumSemanticScore");
  });
});

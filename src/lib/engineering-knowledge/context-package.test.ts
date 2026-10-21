import { describe, expect, it } from "vitest";
import {
  assembleGovernedEngineeringContext,
  physicsResultRefs,
} from "./context-package";

describe("governed engineering context package", () => {
  it("packages passages, conflicts, and missing codes without granting authority", () => {
    const packaged = assembleGovernedEngineeringContext({
      tenantId: "org-1",
      assetTwinId: "twin-pump-1",
      assetClassCode: "ROT-CENT-PUMP",
      componentCodes: ["PUMP-WET-END", "PUMP-UNMAPPED"],
      failureModeCodes: ["PUMP-WET-END-CAVITATION"],
      physicsCapabilityCodes: ["PHYS-NPSH"],
      retrieved: [
        {
          chunkId: "chunk-1",
          title: "Client note",
          documentClass: "client_supplied",
          trustRank: 75,
          isClientPrivate: true,
          content: "UNTRUSTED RETRIEVED EVIDENCE passage",
          sourceId: "source-a",
        },
      ],
      visibleChunkIds: ["chunk-1"],
      requestedChunkIds: ["chunk-1", "other-tenant-chunk"],
      evidenceIds: ["evidence-1", "evidence-foreign"],
      verifiedEvidenceIds: ["evidence-1"],
      approvedMappings: [
        { entityType: "component", canonicalId: "PUMP-WET-END" },
      ],
      physicsResults: [{ capabilityCode: "PHYS-NPSH", resultRef: "RESULT-1" }],
      sources: [
        {
          id: "source-a",
          revision: "1",
          authorityLevel: "oem_authorized",
          assetClass: "ROT-CENT-PUMP",
          reviewState: "approved",
          superseded: false,
        },
        {
          id: "source-b",
          revision: "2",
          authorityLevel: "internal_approved",
          assetClass: "ROT-CENT-PUMP",
          reviewState: "approved",
          superseded: false,
        },
      ],
    });

    expect(packaged.humanApprovalRequired).toBe(true);
    expect(packaged.autonomousOperationalActionAllowed).toBe(false);
    expect(packaged.grantsWorkRelease).toBe(false);
    expect(packaged.grantsApprovalAuthority).toBe(false);
    expect(packaged.missingEvidence).toEqual([
      "component:PUMP-UNMAPPED",
      "failure_mode:PUMP-WET-END-CAVITATION",
      "physics_capability:PHYS-NPSH",
    ]);
    expect(packaged.evidenceIds).toEqual(["evidence-1"]);
    expect(packaged.unverifiedEvidenceIds).toEqual(["evidence-foreign"]);
    expect(packaged.unverifiedChunkIds).toEqual(["other-tenant-chunk"]);
    expect(packaged.conflicts.map((item) => item.kind)).toEqual([
      "revision_conflict",
      "authority_conflict",
    ]);
    expect(packaged.sourceConflictIds).toEqual(["source-a", "source-b"]);
    expect(packaged.physicsResults).toEqual([
      { capabilityCode: "PHYS-NPSH", resultRef: "RESULT-1", unverified: true },
    ]);
    expect(packaged).not.toHaveProperty("confidence");
    expect(JSON.stringify(packaged)).not.toContain("vapour bubble");
  });

  it("rejects a copied calculation in a physics result", () => {
    expect(() =>
      physicsResultRefs([
        { capabilityCode: "PHYS-NPSH", resultRef: "RESULT-1", value: 12.5 },
      ]),
    ).toThrow(/capability code and a result reference/);
    expect(() =>
      physicsResultRefs([{ capabilityCode: "PHYS-NPSH", resultRef: "12.5" }]),
    ).toThrow(/not carry a calculated value/);
  });
});

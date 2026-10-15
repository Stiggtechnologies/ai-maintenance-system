import { describe, expect, it } from "vitest";
import {
  evaluateIntakeSourceStanding,
  validateIntakeMappingReceipt,
  type CanonicalIntakeMapping,
} from "./decision-case-intake-contract";
const canonical: CanonicalIntakeMapping = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  caseId: "22222222-2222-4222-8222-222222222222",
  caseVersion: 8,
  documentId: "33333333-3333-4333-8333-333333333333",
  evidenceItemId: "44444444-4444-4444-8444-444444444444",
  sourceId: "synthetic-customer-inspection",
  sourceRevision: 2,
  securityRevision: 3,
  contentSha256: "a".repeat(64),
  documentStatus: "indexed",
  securityStatus: "cleared",
  chunkCount: 2,
};
const expected = {
  organizationId: canonical.organizationId,
  caseId: canonical.caseId,
  expectedCaseVersion: 7,
  sourceId: canonical.sourceId,
};
describe("proposed canonical intake mapping contract (not deployed)", () => {
  it("requires an independently resolved mapping, not a self-claimed cleared upload", () => {
    expect(
      validateIntakeMappingReceipt(canonical, expected, null).standing,
    ).toBe("invalidated");
    expect(
      validateIntakeMappingReceipt(
        {
          source_id: canonical.sourceId,
          status: "indexed",
          security_status: "cleared",
          chunks_created: 2,
        },
        expected,
        canonical,
      ).standing,
    ).toBe("invalidated");
    expect(
      validateIntakeMappingReceipt(canonical, expected, canonical),
    ).toEqual({
      standing: "current",
      durableReference: canonical.evidenceItemId,
    });
  });
  it.each([
    { organizationId: "99999999-9999-4999-8999-999999999999" },
    { caseId: "99999999-9999-4999-8999-999999999999" },
    { caseVersion: 7 },
    { caseVersion: 9 },
    { evidenceItemId: canonical.sourceId },
    { documentId: canonical.evidenceItemId },
    { sourceId: "different-source" },
    { contentSha256: "b".repeat(64) },
    { sourceRevision: 1 },
    { securityRevision: 2 },
    { chunkCount: 0 },
    { securityStatus: undefined },
    { documentStatus: "failed" },
  ])("refuses a mismatched or incomplete receipt %j", (change) => {
    expect(
      validateIntakeMappingReceipt(
        { ...canonical, ...change },
        expected,
        canonical,
      ).standing,
    ).toBe("invalidated");
  });
  it.each(["quarantined", "rejected"] as const)(
    "refuses even matching %s source records",
    (securityStatus) => {
      const blocked = { ...canonical, securityStatus };
      expect(
        validateIntakeMappingReceipt(blocked, expected, blocked).standing,
      ).toBe("invalidated");
    },
  );
  it.each([
    { evidenceItemId: "55555555-5555-4555-8555-555555555555" },
    { sourceRevision: 3 },
    { securityRevision: 4 },
    { contentSha256: "b".repeat(64) },
    { securityStatus: "quarantined" as const },
    { securityStatus: "rejected" as const },
    { documentStatus: "failed" as const },
    { chunkCount: 0 },
  ])(
    "invalidates retained approval basis after a canonical source change %j",
    (change) => {
      const historical = structuredClone(canonical);
      expect(
        evaluateIntakeSourceStanding(historical, { ...canonical, ...change })
          .standing,
      ).toBe("invalidated");
      expect(historical).toEqual(canonical);
    },
  );
  it("does not resurrect old approval when the same content is released after quarantine", () => {
    const released = {
      ...canonical,
      securityStatus: "released" as const,
      securityRevision: 5,
    };
    expect(evaluateIntakeSourceStanding(canonical, released).standing).toBe(
      "invalidated",
    );
    // A new binding may become attachable, but that result grants no approval.
    expect(evaluateIntakeSourceStanding(released, released)).toEqual({
      standing: "current",
      durableReference: canonical.evidenceItemId,
    });
  });
  it("refuses missing or deleted canonical source state", () => {
    expect(evaluateIntakeSourceStanding(canonical, null).standing).toBe(
      "invalidated",
    );
  });
});

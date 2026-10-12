import { describe, expect, it } from "vitest";
import { createHonestEmptyDecisionCase } from "./decision-case-honesty";
import { reconcileIntakeCaseReceipt } from "./decision-case-intake-reconciliation";
import type { CanonicalIntakeMapping } from "./decision-case-intake-contract";
const mapping: CanonicalIntakeMapping = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  caseId: "22222222-2222-4222-8222-222222222222",
  caseVersion: 8,
  documentId: "33333333-3333-4333-8333-333333333333",
  evidenceItemId: "44444444-4444-4444-8444-444444444444",
  sourceId: "synthetic-inspection",
  sourceRevision: 2,
  securityRevision: 3,
  contentSha256: "a".repeat(64),
  documentStatus: "indexed",
  securityStatus: "cleared",
  chunkCount: 2,
};
const expected = {
  organizationId: mapping.organizationId,
  caseId: mapping.caseId,
  expectedCaseVersion: 7,
  sourceId: mapping.sourceId,
};
function response() {
  const base = createHonestEmptyDecisionCase(
    "Inspect the synthetic asset",
    "oil-gas",
  );
  return {
    mapping,
    caseState: {
      ...base,
      id: mapping.caseId,
      revision: 8,
      stage: "evidence" as const,
      evidence: [
        {
          id: "synthetic-binding",
          title: "Inspection",
          summary: "Recorded observation",
          quality: "medium" as const,
          state: "Indexed",
          record: "Synthetic inspection",
          finding: "Synthetic observation for contract testing",
          lineage: "Synthetic",
          sourceSystem: "governed intake",
          persistence: "governed_reference" as const,
          durableReference: mapping.evidenceItemId,
          intakeBinding: { ...mapping },
        },
      ],
    },
  };
}
describe("proposed atomic intake case reconciliation", () => {
  it("adopts the server's new revision without another save or mutating transport state", () => {
    const input = response();
    const adopted = reconcileIntakeCaseReceipt(input, expected, mapping);
    expect(adopted.revision).toBe(8);
    expect(adopted.evidence[0].durableReference).toBe(mapping.evidenceItemId);
    expect(adopted).toEqual(input.caseState);
    expect(adopted).not.toBe(input.caseState);
    expect(adopted.humanApproval).toBeUndefined();
  });
  it.each([
    { revision: 7 },
    { id: mapping.documentId },
    { stage: "authority" },
    { humanApproval: { decision: "approved" } },
    { humanDecision: { disposition: "accept" } },
    { evidence: [] },
  ])("refuses stale, misbound or pre-approved case state %j", (change) => {
    const input = response();
    expect(() =>
      reconcileIntakeCaseReceipt(
        { ...input, caseState: { ...input.caseState, ...change } },
        expected,
        mapping,
      ),
    ).toThrow();
  });
  it("refuses duplicate evidence mappings", () => {
    const input = response();
    input.caseState.evidence.push({
      ...input.caseState.evidence[0],
      id: "duplicate",
    });
    expect(() => reconcileIntakeCaseReceipt(input, expected, mapping)).toThrow(
      /exactly one/,
    );
  });
  it("requires the source basis inside the persisted case, not just in the receipt", () => {
    const input = response();
    input.caseState.evidence[0].intakeBinding.securityRevision = 1;
    expect(() => reconcileIntakeCaseReceipt(input, expected, mapping)).toThrow(
      /source basis/,
    );
  });
  it("refuses source changes between the command response and canonical read without rewriting historical response", () => {
    const input = response();
    const original = structuredClone(input);
    expect(() =>
      reconcileIntakeCaseReceipt(input, expected, {
        ...mapping,
        securityRevision: 4,
        securityStatus: "quarantined",
      }),
    ).toThrow();
    expect(input).toEqual(original);
  });
  it("refuses an upload-only response or a missing canonical read", () => {
    expect(() =>
      reconcileIntakeCaseReceipt(
        { source_id: mapping.sourceId, status: "indexed" },
        expected,
        mapping,
      ),
    ).toThrow();
    expect(() =>
      reconcileIntakeCaseReceipt(response(), expected, null),
    ).toThrow();
  });
});

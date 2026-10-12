import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCanonicalIntakeSource,
  DecisionCaseIntakeReconciliationRequired,
} from "./decisionCaseIntakeService";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
const input = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  caseId: "22222222-2222-4222-8222-222222222222",
  expectedCaseVersion: 1,
  sourceId: "synthetic-source",
};
const mapping = {
  ...input,
  caseVersion: 2,
  documentId: "33333333-3333-4333-8333-333333333333",
  evidenceItemId: "44444444-4444-4444-8444-444444444444",
  sourceRevision: 2,
  securityRevision: 3,
  contentSha256: "a".repeat(64),
  documentStatus: "indexed",
  securityStatus: "cleared",
  chunkCount: 1,
};
const response = {
  mapping,
  caseState: {
    id: input.caseId,
    revision: 2,
    stage: "evidence",
    evidence: [
      {
        persistence: "governed_reference",
        durableReference: mapping.evidenceItemId,
        quality: "medium",
        intakeBinding: mapping,
      },
    ],
  },
};
beforeEach(() => {
  rpc.mockReset();
});
describe("atomic canonical intake service", () => {
  it("adopts one atomic command through an independent read without a second write", async () => {
    rpc
      .mockResolvedValueOnce({ data: response })
      .mockResolvedValueOnce({ data: mapping });
    const result = await attachCanonicalIntakeSource(input);
    expect(result.revision).toBe(2);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "attach_decision_case_kb_source",
      "get_decision_case_intake_mapping",
    ]);
  });
  it("requires reload after a lost acknowledgement and does not retry", async () => {
    rpc.mockRejectedValue(new Error("Network lost"));
    await expect(attachCanonicalIntakeSource(input)).rejects.toBeInstanceOf(
      DecisionCaseIntakeReconciliationRequired,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("refuses changed security standing between command and canonical read", async () => {
    rpc.mockResolvedValueOnce({ data: response }).mockResolvedValueOnce({
      data: {
        ...mapping,
        securityStatus: "quarantined",
        securityRevision: 4,
      },
    });
    await expect(attachCanonicalIntakeSource(input)).rejects.toThrow(
      /Reload saved work/,
    );
  });
  it("does not promote a legacy upload response into authoritative evidence", async () => {
    rpc.mockResolvedValueOnce({
      data: { source_id: input.sourceId, status: "indexed" },
    });
    await expect(attachCanonicalIntakeSource(input)).rejects.toThrow(
      /canonical evidence identity/,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { requestLearningStandardRevision, decideLearningStandardRevision } from "./developService";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
beforeEach(() => rpc.mockReset());
const input = { observationId: "observation", content: "New procedure", changeSummary: "Sequence changed", basis: "Execution evidence" };
it("requests a draft from the exact observation without selecting an arbitrary predecessor", async () => {
  rpc.mockResolvedValue({ data: { revisionId: 3, approvalId: "approval", status: "draft" }, error: null });
  await expect(requestLearningStandardRevision(input)).resolves.toEqual({ revisionId: 3, approvalId: "approval", status: "draft" });
  expect(rpc).toHaveBeenCalledWith("request_learning_standard_revision", { p_observation_id: "observation", p_content: input.content, p_change_summary: input.changeSummary, p_basis: input.basis });
});
it.each([null, {}, { revisionId: -1, approvalId: "a", status: "draft" }, { revisionId: 3, approvalId: "", status: "draft" }, { revisionId: 3, approvalId: "a", status: "approved" }])("refuses invalid request receipt %j", async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(requestLearningStandardRevision(input)).rejects.toThrow();
});
it.each(["approved", "rejected"] as const)("preserves the requested %s decision", async outcome => {
  rpc.mockResolvedValue({ data: { revisionId: 3, status: outcome, detail: "Decision recorded, not measured improvement" }, error: null });
  await expect(decideLearningStandardRevision(3, outcome, "Reviewed evidence")).resolves.toMatchObject({ revisionId: 3, status: outcome });
  expect(rpc).toHaveBeenCalledWith("decide_learning_standard_revision", { p_revision_id: 3, p_outcome: outcome, p_note: "Reviewed evidence" });
});
it.each([null, {}, { revisionId: 4, status: "approved", detail: "Wrong revision" }, { revisionId: 3, status: "rejected", detail: "Wrong decision" }, { revisionId: 3, status: "approved", detail: "" }])("refuses invalid decision receipt %j", async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(decideLearningStandardRevision(3, "approved", "Reviewed")).rejects.toThrow();
});
it("surfaces self-adoption refusal", async () => {
  rpc.mockResolvedValue({ data: { error: "The revision requester cannot decide their own adoption" }, error: null });
  await expect(decideLearningStandardRevision(3, "approved", "Reviewed")).rejects.toThrow(/cannot decide/);
});
it("surfaces transport failures", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "Network unavailable" } });
  await expect(requestLearningStandardRevision(input)).rejects.toThrow();
  await expect(decideLearningStandardRevision(3, "approved", "Reviewed")).rejects.toThrow();
});

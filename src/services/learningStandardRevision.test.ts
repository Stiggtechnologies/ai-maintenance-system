import { beforeEach, expect, it, vi } from "vitest";
import { requestLearningStandardRevision, decideLearningStandardRevision, listProjectStandardWork, getObservedProcedure } from "./developService";
const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc, from } }));
beforeEach(() => rpc.mockReset());
const input = { observationId: "observation", content: "New procedure", changeSummary: "Sequence changed", basis: "Execution evidence", safetyCritical: false };
function readQuery(result: object) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(), then: (resolve: (value: object) => unknown) => Promise.resolve(result).then(resolve) };
  from.mockReturnValue(query);
  return query;
}
it("filters revision history by the exact observation while preserving pagination", async () => {
  const query = readQuery({ data: [], error: null });
  await expect(listProjectStandardWork(7, undefined, "observation")).resolves.toEqual([]);
  expect(from).toHaveBeenCalledWith("standard_work");
  expect(query.eq).toHaveBeenCalledWith("source_learning_observation_id", "observation");
  expect(query.gt).toHaveBeenCalledWith("id", 7);
  expect(query.select.mock.calls[0][0]).toContain("procedure_translations_standard_work_id_fkey(id,");
});
it("reads the immutable procedure identity rather than a latest-version substitute", async () => {
  const data = { id: 3, language_code: "en", content: "Observed version", standard: { safety_critical: false, engineering_change_class: null } };
  const query = readQuery({ data, error: null });
  await expect(getObservedProcedure(3)).resolves.toEqual(data);
  expect(from).toHaveBeenCalledWith("procedure_translations");
  expect(query.eq).toHaveBeenCalledWith("id", 3);
  expect(query.single).toHaveBeenCalled();
});
it("does not treat unavailable source content as a valid baseline", async () => {
  readQuery({ data: null, error: null });
  await expect(getObservedProcedure(3)).rejects.toThrow("Observed procedure unavailable");
});
it("surfaces read failures for both source and history", async () => {
  readQuery({ data: null, error: new Error("Read refused") });
  await expect(getObservedProcedure(3)).rejects.toThrow("Read refused");
  await expect(listProjectStandardWork(undefined, undefined, "observation")).rejects.toThrow("Read refused");
});
it("requests a draft from the exact observation without selecting an arbitrary predecessor", async () => {
  rpc.mockResolvedValue({ data: { revisionId: 3, approvalId: "approval", status: "draft" }, error: null });
  await expect(requestLearningStandardRevision(input)).resolves.toEqual({ revisionId: 3, approvalId: "approval", status: "draft", safetyCritical: false, requiredAuthority: null });
  expect(rpc).toHaveBeenCalledWith("request_learning_standard_revision", { p_observation_id: "observation", p_content: input.content, p_change_summary: input.changeSummary, p_basis: input.basis });
});
it("routes declared safety-critical alterations to the designated-authority door", async () => {
  rpc.mockResolvedValue({ data: { revisionId: 3, approvalId: "approval", status: "draft", safetyCritical: true, requiredAuthority: "admin" }, error: null });
  await expect(requestLearningStandardRevision({ ...input, safetyCritical: true })).resolves.toMatchObject({ safetyCritical: true, requiredAuthority: "admin" });
  expect(rpc).toHaveBeenCalledWith("request_safety_critical_learning_standard_revision", { p_observation_id: "observation", p_content: input.content, p_change_summary: input.changeSummary, p_basis: input.basis });
});
it("refuses a safety receipt that omits its designated authority", async () => {
  rpc.mockResolvedValue({ data: { revisionId: 3, approvalId: "approval", status: "draft", safetyCritical: true }, error: null });
  await expect(requestLearningStandardRevision({ ...input, safetyCritical: true })).rejects.toThrow("Invalid learning revision receipt");
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

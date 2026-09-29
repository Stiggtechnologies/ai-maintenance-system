import { beforeEach, describe, expect, it, vi } from "vitest";
import { listStandardWorkObservations, recordStandardWorkObservation } from "./developService";
const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc, from } }));
beforeEach(() => rpc.mockReset());
const input = {
  caseId: "case", procedureId: 3, workOrderId: "work",
  executionEvidenceId: "execution-evidence", outcomeEvidenceId: "outcome-evidence",
  observedAt: "2026-09-28T00:00:00Z", title: "Observed work",
  execution: "Witnessed installation", variationKind: "undetermined" as const,
  variationBasis: "Intermediate steps not visible", outcome: "Observed installation",
  learning: "Retain inspection points", applicability: "Similar installations",
};
describe("standard-work observation history", () => {
  function query(result: object) {
    const chain = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      then: (resolve: (value: object) => unknown) => Promise.resolve(result).then(resolve),
    };
    from.mockReturnValue(chain);
    return chain;
  }
  it("scopes history to the exact case and observation subtype", async () => {
    const chain = query({ data: [{ id: "observation" }], error: null });
    await expect(listStandardWorkObservations("case")).resolves.toEqual([{ id: "observation" }]);
    expect(from).toHaveBeenCalledWith("learning_events");
    expect(chain.eq.mock.calls).toEqual([["development_case_id", "case"], ["event_type", "standard_work_observation"]]);
    expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(chain.gt).not.toHaveBeenCalled();
  });
  it("supports subsequent pages without hiding older observations", async () => {
    const chain = query({ data: [], error: null });
    await expect(listStandardWorkObservations("case", "last-id")).resolves.toEqual([]);
    expect(chain.gt).toHaveBeenCalledWith("id", "last-id");
  });
  it("does not disguise a failed read as empty history", async () => {
    query({ data: null, error: new Error("Read denied") });
    await expect(listStandardWorkObservations("case")).rejects.toThrow("Read denied");
  });
});
describe("standard-work observation receipt", () => {
  it("passes exact source references and preserves observation-only status", async () => {
    rpc.mockResolvedValue({ data: { id: "observation", status: "observed" }, error: null });
    await expect(recordStandardWorkObservation(input)).resolves.toEqual({ id: "observation", status: "observed" });
    expect(rpc).toHaveBeenCalledWith("record_standard_work_observation", {
      p_case_id: "case", p_procedure_id: 3, p_work_order_id: "work",
      p_execution_evidence_id: "execution-evidence", p_outcome_evidence_id: "outcome-evidence",
      p_observed_at: input.observedAt, p_observation: {
        title: input.title, execution: input.execution, variationKind: "undetermined",
        variationBasis: input.variationBasis, outcome: input.outcome,
        learning: input.learning, applicability: input.applicability,
      },
    });
  });
  it.each([null, {}, { id: "", status: "observed" }, { id: "x", status: "approved" }])(
    "refuses malformed or overclaiming receipt %j", async data => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(recordStandardWorkObservation(input)).rejects.toThrow();
    },
  );
  it("surfaces domain refusal", async () => {
    rpc.mockResolvedValue({ data: { error: "Same-tenant evidence required" }, error: null });
    await expect(recordStandardWorkObservation(input)).rejects.toThrow(/Same-tenant/);
  });
  it("surfaces transport failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Network unavailable" } });
    await expect(recordStandardWorkObservation(input)).rejects.toThrow();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  createPersistedDecisionCase,
  DecisionCaseConflictError,
  savePersistedDecisionCase,
} from "./decisionCaseService";

/**
 * Durable receipts under the server-owned command model. A save is only
 * reported when apply_decision_case_command returns a strictly newer
 * canonical version; the browser never writes case_state directly.
 */
const receipt = vi.hoisted(() => ({
  response: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (payload: unknown) => {
        receipt.update(payload);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle: receipt.response })),
          })),
        };
      },
    })),
    rpc: receipt.rpc,
  },
}));
vi.mock("./operatingLoopService", () => ({
  createCoworkWorkspaceFromObjective: receipt.create,
  getCoworkMessages: vi.fn(),
  sendCoworkMessage: vi.fn(),
}));

const id = "0fef8f5b-8d79-4d43-8b83-4bde12345678";
const savedCase = (revision = 3) => ({
  ...createHonestEmptyDecisionCase("Reliability Engineer", "mining"),
  id,
  revision,
  updatedAt: "2026-10-10T05:00:00.001Z",
});

describe("durable decision-case receipts (command model)", () => {
  beforeEach(() => {
    receipt.response.mockReset();
    receipt.create.mockReset();
    receipt.update.mockReset();
    receipt.rpc.mockReset();
    receipt.create.mockResolvedValue({ workspaceId: id });
  });

  it("saves through the versioned command and returns the newer canonical case", async () => {
    const decisionCase = savedCase(3);
    receipt.rpc.mockResolvedValue({
      data: { caseState: { ...decisionCase }, version: 4 },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).resolves.toMatchObject({
      id,
      revision: 4,
    });
    expect(receipt.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({ p_workspace_id: id, p_expected_version: 3 }),
    );
    expect(receipt.update).not.toHaveBeenCalled();
  });

  it("sends only human-entered disposition fields; actor and recordedAt stay server-owned", async () => {
    const decisionCase = {
      ...savedCase(3),
      humanDecision: {
        disposition: "accept" as const,
        rationale: "Synthetic rationale",
        counterfactual: "Synthetic counterfactual",
        recordedAt: "2026-10-21T00:00:00.000Z",
        actor: { id: "forged", name: "Forged", role: "admin" },
      },
    };
    receipt.rpc.mockResolvedValue({ data: { caseState: { ...decisionCase }, version: 4 }, error: null });
    await savePersistedDecisionCase(decisionCase as never, "record_disposition");
    const sent = receipt.rpc.mock.calls[0][1].p_case_state as { humanDecision: Record<string, unknown> };
    expect(sent.humanDecision).toEqual({
      disposition: "accept",
      rationale: "Synthetic rationale",
      counterfactual: "Synthetic counterfactual",
    });
  });

  it("refuses to report a save when the server returns no newer version", async () => {
    receipt.rpc.mockResolvedValue({
      data: { caseState: savedCase(3), version: 3 },
      error: null,
    });
    await expect(savePersistedDecisionCase(savedCase(3))).rejects.toThrow(
      "did not return a newer canonical version",
    );
  });

  it("surfaces a stale write as a conflict, not a save", async () => {
    receipt.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Decision Case conflict: expected 3, current 5" },
    });
    await expect(savePersistedDecisionCase(savedCase(3))).rejects.toBeInstanceOf(
      DecisionCaseConflictError,
    );
  });

  it("requires the canonical revision before any save", async () => {
    await expect(
      savePersistedDecisionCase({ ...savedCase(), revision: undefined }),
    ).rejects.toThrow(
      "canonical revision is missing",
    );
    expect(receipt.rpc).not.toHaveBeenCalled();
  });

  it("dedupes on the import UUID, keeps DRAFT- on the case and never writes case_state directly", async () => {
    receipt.response.mockResolvedValue({ data: { id, case_version: 0 }, error: null });
    receipt.rpc.mockImplementation(
      async (_name: string, input: { p_case_state: unknown }) => ({
        data: { caseState: input.p_case_state, version: 1 },
        error: null,
      }),
    );
    const decisionCase = {
      ...savedCase(),
      id: "draft-12345",
      caseNumber: "DRAFT-12345",
      importKey: "11111111-1111-4111-8111-111111111111",
    };
    await expect(createPersistedDecisionCase(decisionCase, {})).resolves.toMatchObject({
      id,
      revision: 1,
      caseNumber: "DRAFT-12345",
    });
    expect(receipt.create).toHaveBeenCalledWith(decisionCase.objective, {
      importKey: "11111111-1111-4111-8111-111111111111",
    });
    const payload = receipt.update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.case_number).toBe("11111111-1111-4111-8111-111111111111");
    expect(payload).not.toHaveProperty("case_state");
    expect(receipt.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({
        p_command: "initialize",
        p_expected_version: 0,
        p_case_state: expect.objectContaining({
          caseNumber: "DRAFT-12345",
          importKey: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("rejects initialization when the new workspace update returns no row", async () => {
    receipt.response.mockResolvedValue({ data: null, error: null });
    await expect(createPersistedDecisionCase(savedCase(), {})).rejects.toThrow(
      "no tenant-visible workspace row was updated",
    );
    expect(receipt.rpc).not.toHaveBeenCalled();
  });

  it("rejects treating a browser ID as a durable save", async () => {
    await expect(
      savePersistedDecisionCase({ ...savedCase(), id: "draft-local" }),
    ).rejects.toThrow("browser draft cannot be marked durably saved");
    expect(receipt.rpc).not.toHaveBeenCalled();
  });
});

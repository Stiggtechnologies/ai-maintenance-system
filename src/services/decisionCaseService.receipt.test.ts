import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  createPersistedDecisionCase,
  savePersistedDecisionCase,
} from "./decisionCaseService";

const receipt = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (payload: unknown) => {
        receipt.update(payload);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: receipt.maybeSingle,
            })),
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
const savedCase = () => ({
  ...createHonestEmptyDecisionCase("Reliability Engineer", "mining"),
  id,
  revision: 2,
  updatedAt: "2026-10-10T05:00:00.001Z",
});

describe("durable decision-case receipts", () => {
  beforeEach(() => {
    receipt.maybeSingle.mockReset();
    receipt.update.mockReset();
    receipt.rpc.mockReset();
    receipt.create.mockReset();
    receipt.create.mockResolvedValue({ workspaceId: id });
  });

  it("refuses a save that has no canonical revision", async () => {
    const decisionCase = savedCase();
    decisionCase.revision = Number.NaN;
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "canonical revision is missing",
    );
    expect(receipt.rpc).not.toHaveBeenCalled();
  });

  it("rejects a command that does not return a newer canonical version", async () => {
    receipt.rpc.mockResolvedValue({ data: null, error: null });
    await expect(savePersistedDecisionCase(savedCase())).rejects.toThrow(
      "did not return a newer canonical version",
    );
  });

  it("rejects a command result that does not advance the revision", async () => {
    const decisionCase = savedCase();
    receipt.rpc.mockResolvedValue({
      data: { caseState: decisionCase, version: decisionCase.revision },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "did not return a newer canonical version",
    );
  });

  it("returns the canonical case from a newer command receipt", async () => {
    const decisionCase = savedCase();
    receipt.rpc.mockResolvedValue({
      data: {
        caseState: { ...decisionCase, objective: decisionCase.objective },
        version: 3,
      },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase),
    ).resolves.toMatchObject({ id, revision: 3 });
    expect(receipt.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({
        p_workspace_id: id,
        p_expected_version: 2,
        p_command: "record_conversation",
      }),
    );
  });

  it("does not mark a browser draft durably saved", async () => {
    const draft = { ...savedCase(), id: "draft-local" };
    await expect(savePersistedDecisionCase(draft)).resolves.toBe(draft);
    expect(receipt.rpc).not.toHaveBeenCalled();
  });

  it("adopts the import UUID as the case number and leaves the DRAFT number on the case", async () => {
    const importKey = "11111111-1111-4111-8111-111111111111";
    const decisionCase = {
      ...savedCase(),
      id: "draft-12345",
      caseNumber: "DRAFT-12345",
      importKey,
    };
    receipt.maybeSingle.mockResolvedValueOnce({
      data: { id, case_version: 0 },
      error: null,
    });
    receipt.rpc.mockResolvedValueOnce({
      data: {
        caseState: { ...decisionCase, id, revision: 1 },
        version: 1,
      },
      error: null,
    });
    await expect(
      createPersistedDecisionCase(decisionCase, {}),
    ).resolves.toMatchObject({ id, revision: 1 });
    expect(receipt.create).toHaveBeenCalledWith(decisionCase.objective, {
      importKey,
    });
    expect(receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ case_number: importKey }),
    );
    expect(receipt.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ case_state: expect.anything() }),
    );
    const command = receipt.rpc.mock.calls[0][1] as {
      p_case_state: { caseNumber?: string; importKey?: string };
    };
    expect(command.p_case_state.caseNumber).toBe("DRAFT-12345");
    expect(command.p_case_state.importKey).toBe(importKey);
  });

  it("rejects initialization when the new workspace update returns no row", async () => {
    receipt.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(createPersistedDecisionCase(savedCase(), {})).rejects.toThrow(
      "no tenant-visible workspace row was updated",
    );
    expect(receipt.rpc).not.toHaveBeenCalled();
  });
});

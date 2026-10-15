import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  createPersistedDecisionCase,
  savePersistedDecisionCase,
} from "./decisionCaseService";

const receipt = vi.hoisted(() => ({
  response: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (payload: unknown) => {
        receipt.update(payload);
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ returns: receipt.response })),
            })),
          })),
        };
      },
    })),
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
  updatedAt: "2026-10-10T05:00:00.001Z",
});

describe("durable decision-case receipts", () => {
  beforeEach(() => {
    receipt.response.mockReset();
    receipt.create.mockReset();
    receipt.update.mockReset();
    receipt.create.mockResolvedValue({ workspaceId: id });
  });

  it("rejects a zero-row/RLS-filtered update without claiming saved", async () => {
    receipt.response.mockResolvedValue({ data: null, error: null });
    await expect(savePersistedDecisionCase(savedCase())).rejects.toThrow(
      "did not confirm this case revision",
    );
  });

  it("rejects a stale revision receipt", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        id,
        case_state: { ...decisionCase, updatedAt: "older revision" },
      },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "did not confirm this case revision",
    );
  });

  it("accepts the authorized row and exact revision receipt", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: { id, case_state: decisionCase },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase),
    ).resolves.toBeUndefined();
  });

  it("rejects different content even when its timestamp matches", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        id,
        case_state: {
          ...decisionCase,
          objective: "Stale content with the same timestamp",
        },
      },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "did not confirm this case revision",
    );
  });

  it("accepts matching content when JSONB reorders object keys", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        id,
        case_state: Object.fromEntries(Object.entries(decisionCase).reverse()),
      },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase),
    ).resolves.toBeUndefined();
  });

  it("dedupes on the import UUID and leaves the DRAFT- number on the case", async () => {
    receipt.response.mockResolvedValue({ data: null, error: null });
    const decisionCase = {
      ...savedCase(),
      id: "draft-12345",
      caseNumber: "DRAFT-12345",
      importKey: "11111111-1111-4111-8111-111111111111",
    };
    await expect(createPersistedDecisionCase(decisionCase, {})).rejects.toThrow(
      "did not confirm this case revision",
    );
    expect(receipt.create).toHaveBeenCalledWith(decisionCase.objective, {
      importKey: "11111111-1111-4111-8111-111111111111",
    });
    expect(receipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        case_number: "11111111-1111-4111-8111-111111111111",
        case_state: expect.objectContaining({
          caseNumber: "DRAFT-12345",
          importKey: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
    const payload = receipt.update.mock.calls[0][0] as {
      case_number?: string;
    };
    expect(payload.case_number).not.toBe("DRAFT-12345");
  });

  it("rejects initialization when the new workspace update returns no row", async () => {
    receipt.response.mockResolvedValue({ data: null, error: null });
    await expect(createPersistedDecisionCase(savedCase(), {})).rejects.toThrow(
      "did not confirm this case revision",
    );
  });

  it("rejects treating a browser ID as a durable save", async () => {
    await expect(
      savePersistedDecisionCase({ ...savedCase(), id: "draft-local" }),
    ).rejects.toThrow("browser draft cannot be marked durably saved");
    expect(receipt.response).not.toHaveBeenCalled();
  });
});

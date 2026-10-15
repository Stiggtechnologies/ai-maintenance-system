import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  createPersistedDecisionCase,
  savePersistedDecisionCase,
} from "./decisionCaseService";

const receipt = vi.hoisted(() => ({
  response: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(() => ({ returns: receipt.response })),
          })),
        })),
      })),
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

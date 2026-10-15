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
    rpc: receipt.response,
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: receipt.response,
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
  revision: 1,
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
      "did not return a newer canonical version",
    );
  });

  it("rejects a stale revision receipt", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        version: 1,
        caseState: decisionCase,
      },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "did not return a newer canonical version",
    );
  });

  it("accepts the authorized row and exact revision receipt", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: { version: 2, caseState: { ...decisionCase, revision: 2 } },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase),
    ).resolves.toMatchObject({ id, revision: 2 });
  });

  it("rejects different content even when its timestamp matches", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        version: 2,
        caseState: {
          ...decisionCase,
          revision: 2,
          objective: "Stale content with the same timestamp",
        },
      },
      error: null,
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toThrow(
      "did not return a newer canonical version",
    );
  });

  it("accepts matching content when JSONB reorders object keys", async () => {
    const decisionCase = savedCase();
    receipt.response.mockResolvedValue({
      data: {
        version: 2,
        caseState: Object.fromEntries(
          Object.entries({ ...decisionCase, revision: 2 }).reverse(),
        ),
      },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase),
    ).resolves.toMatchObject({ id, revision: 2 });
  });

  it("rejects initialization when the new workspace update returns no row", async () => {
    receipt.response.mockResolvedValue({ data: null, error: null });
    await expect(createPersistedDecisionCase(savedCase(), {})).rejects.toThrow(
      "no valid canonical receipt",
    );
  });

  it("reconciles a repeated create to the same authoritative case and rejects foreign receipts", async () => {
    const seed = savedCase();
    const canonical = { ...seed, revision: 4 };
    receipt.response.mockResolvedValue({
      data: { caseState: canonical, version: 4 },
      error: null,
    });
    await expect(createPersistedDecisionCase(seed, {})).resolves.toEqual(
      canonical,
    );
    await expect(createPersistedDecisionCase(seed, {})).resolves.toEqual(
      canonical,
    );
    expect(receipt.create).not.toHaveBeenCalled();
    receipt.response.mockResolvedValue({
      data: {
        caseState: { ...canonical, objective: "Another customer's case" },
        version: 4,
      },
      error: null,
    });
    await expect(createPersistedDecisionCase(seed, {})).rejects.toThrow(
      "no valid canonical receipt",
    );
  });

  it("rejects treating a browser ID as a durable save", async () => {
    await expect(
      savePersistedDecisionCase({ ...savedCase(), id: "draft-local" }),
    ).rejects.toThrow("browser draft cannot be marked durably saved");
    expect(receipt.response).not.toHaveBeenCalled();
  });
});

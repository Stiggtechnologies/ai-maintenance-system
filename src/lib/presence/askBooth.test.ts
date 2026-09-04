import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BOOTH_UNAVAILABLE_REPLY } from "./booth";

const invoke = vi.fn();
const describeQuotaRefusal = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invoke(...args),
    },
  },
}));

vi.mock("../../services/agentQuota", () => ({
  describeQuotaRefusal: (...args: unknown[]) => describeQuotaRefusal(...args),
}));

import { askBoothConversation } from "./askBooth";

beforeEach(() => {
  invoke.mockReset();
  describeQuotaRefusal.mockReset();
  describeQuotaRefusal.mockResolvedValue(null);
});

describe("askBoothConversation", () => {
  it("calls the existing ReliabilityAgent path with approval required", async () => {
    invoke.mockResolvedValue({
      data: { response: "Backlog is not sourced in this snapshot." },
      error: null,
    });

    const result = await askBoothConversation("QUESTION: How is backlog?");
    expect(invoke).toHaveBeenCalledWith("ai-agent-processor", {
      body: {
        agentType: "ReliabilityAgent",
        query: "QUESTION: How is backlog?",
        requiresApproval: true,
      },
    });
    expect(result).toEqual({
      status: "ok",
      response: "Backlog is not sourced in this snapshot.",
    });
  });

  it("renders a quota refusal instead of inventing an answer", async () => {
    const error = { message: "non-2xx" };
    invoke.mockResolvedValue({ data: null, error });
    describeQuotaRefusal.mockResolvedValue({
      kind: "quota_exceeded",
      message: "Your organization's daily AI request allowance is used up.",
      resetsAt: null,
    });

    const result = await askBoothConversation("QUESTION: status");
    expect(result.status).toBe("quota");
    expect(result.response).toMatch(/daily AI request allowance/);
    expect(result.response).not.toMatch(/plant is healthy/i);
  });

  it("returns the honest unavailable reply when the processor is down", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code" },
    });

    const result = await askBoothConversation("QUESTION: status");
    expect(result).toEqual({
      status: "unavailable",
      response: BOOTH_UNAVAILABLE_REPLY,
    });
  });

  it("does not invent a plant reading when the processor returns empty", async () => {
    invoke.mockResolvedValue({ data: { response: "   " }, error: null });
    const result = await askBoothConversation("QUESTION: OEE?");
    expect(result.status).toBe("unavailable");
    expect(result.response).toBe(BOOTH_UNAVAILABLE_REPLY);
    expect(result.response).not.toMatch(/\b87%\b/);
  });
});

describe("askBooth boundary", () => {
  it("consumes quota refusals and stays on the canonical processor", () => {
    const src = readFileSync("src/lib/presence/askBooth.ts", "utf8");
    expect(src).toContain("describeQuotaRefusal");
    expect(src).toContain("agentQuota");
    expect(src).toContain("ai-agent-processor");
    expect(src).toContain('agentType: "ReliabilityAgent"');
    expect(src).toContain("requiresApproval: true");
    expect(src).not.toMatch(/openclaw|javis|jarvis|sir-orchestrator/i);
  });
});

import { describe, expect, it } from "vitest";
import { createSeedDecisionCases } from "./decision-case";
import {
  reconcileDecisionCaseSave,
  reconcileLoadedDecisionConversation,
} from "./decision-case-save-receipt";

describe("delayed canonical save delivery", () => {
  const submitted = { ...createSeedDecisionCases()[0], revision: 1 };
  const saved = {
    ...submitted,
    revision: 2,
    updatedAt: "2026-10-10T00:00:00Z",
  };
  it("retains a reply and token usage arriving while the user message saves", async () => {
    let deliver!: (value: typeof saved) => void;
    const pending = new Promise<typeof saved>((resolve) => {
      deliver = resolve;
    });
    const reply = {
      ...submitted.messages[0],
      id: "new-reply",
      text: "New analysis",
    };
    const current = {
      ...submitted,
      messages: [...submitted.messages, reply],
      tokensUsed: submitted.tokensUsed + 240,
    };
    deliver(saved);
    const result = reconcileDecisionCaseSave(current, submitted, await pending);
    expect(result.messages.at(-1)).toEqual(reply);
    expect(result.tokensUsed).toBe(current.tokensUsed);
    expect(result.revision).toBe(2);
  });
  it("accepts an unchanged snapshot and ignores a receipt older than current state", () => {
    expect(reconcileDecisionCaseSave(submitted, submitted, saved)).toBe(saved);
    const newer = { ...saved, revision: 3 };
    expect(reconcileDecisionCaseSave(newer, submitted, saved)).toBe(newer);
    expect(reconcileLoadedDecisionConversation(newer, saved)).toBe(newer);
  });
  it("preserves edits and server-added history without duplicate message identities", () => {
    const stamp = { ...submitted.messages[0], id: "server-stamp" };
    const canonical = { ...saved, messages: [...saved.messages, stamp] };
    const current = { ...submitted, title: "Revised question" };
    const result = reconcileDecisionCaseSave(current, submitted, canonical);
    expect(result.title).toBe("Revised question");
    expect(result.messages).toEqual(canonical.messages);
  });
  it("recovers a committed lost response without dropping unsaved dialogue or reviving local authority", () => {
    const reply = {
      ...submitted.messages[0],
      id: "unsaved-reply",
      role: "assistant" as const,
    };
    const forgedStamp = {
      ...reply,
      id: "local-authority",
      actorId: "old-actor",
    };
    const local = {
      ...submitted,
      messages: [...submitted.messages, reply, forgedStamp],
      tokensUsed: submitted.tokensUsed + 240,
      humanApproval: {
        decision: "approved" as const,
        reason: "stale",
        recordedAt: "old",
        basisVersion: 1,
        basisSha256: "old",
        approvalVersion: 2,
      },
    };
    const result = reconcileLoadedDecisionConversation(local, saved);
    expect(result.messages.at(-1)).toEqual(reply);
    expect(result.messages).not.toContain(forgedStamp);
    expect(result.humanApproval).toBe(saved.humanApproval);
    expect(result.revision).toBe(2);
    expect(result.tokensUsed).toBe(local.tokensUsed);
  });
});

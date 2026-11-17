import { describe, expect, it, vi } from "vitest";
import {
  DRAFT_IMPORT_BINDING_KEY,
  draftImportIdempotencyKey,
  importBrowserDraft,
  type DraftImportStorage,
} from "./decision-draft-import";

function memoryStorage(initial: Record<string, string> = {}): DraftImportStorage & {
  snapshot: () => Record<string, string>;
} {
  const values = { ...initial };
  return {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    snapshot: () => ({ ...values }),
  };
}

describe("browser draft import identity", () => {
  it("derives one idempotency key for a draft and case", async () => {
    const first = await draftImportIdempotencyKey("draft-old-1", "case-1");
    const second = await draftImportIdempotencyKey("draft-old-1", "case-1");
    const otherCase = await draftImportIdempotencyKey("draft-old-1", "case-2");
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).toBe(first);
    expect(otherCase).not.toBe(first);
  });

  it("reuses the acknowledged decision and does not call create again", async () => {
    const storage = memoryStorage();
    const createDecision = vi.fn(async () => ({
      decision_id: "decision-1",
      replay: false,
    }));
    const request = {
      storage,
      draftId: "draft-old-1",
      caseId: "case-1",
      question: "Leftover pump draft: Recover production",
      approvalLevel: "Maintenance Superintendent",
      createDecision,
    };
    const first = await importBrowserDraft(request);
    const second = await importBrowserDraft(request);
    expect(first).toEqual({ decisionId: "decision-1", replay: false });
    expect(second).toEqual({ decisionId: "decision-1", replay: true });
    expect(createDecision).toHaveBeenCalledTimes(1);
    expect(storage.snapshot()[DRAFT_IMPORT_BINDING_KEY]).toContain("decision-1");
  });

  it("retries a lost acknowledgement with the same key and no second identity", async () => {
    const storage = memoryStorage();
    const createDecision = vi
      .fn()
      .mockRejectedValueOnce(new Error("acknowledgement lost"))
      .mockResolvedValueOnce({ decision_id: "decision-1", replay: true });
    const request = {
      storage,
      draftId: "draft-old-1",
      caseId: "case-1",
      question: "Leftover pump draft: Recover production",
      approvalLevel: null,
      createDecision,
    };
    await expect(importBrowserDraft(request)).rejects.toThrow(
      "acknowledgement lost",
    );
    const persisted = storage.snapshot()[DRAFT_IMPORT_BINDING_KEY] ?? "";
    expect(persisted).toContain("draft-old-1");
    expect(persisted).not.toContain("decision-1");
    const retried = await importBrowserDraft(request);
    expect(retried).toEqual({ decisionId: "decision-1", replay: true });
    expect(createDecision).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = createDecision.mock.calls;
    expect(firstCall[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(secondCall[0].idempotencyKey).toBe(firstCall[0].idempotencyKey);
    expect(secondCall[0].question).toBe(firstCall[0].question);
  });

  it("writes the idempotency key before the create call", async () => {
    const storage = memoryStorage();
    let keyAtCall: string | null = null;
    await importBrowserDraft({
      storage,
      draftId: "draft-old-1",
      caseId: "case-1",
      question: "Leftover pump draft: Recover production",
      approvalLevel: null,
      createDecision: async (request) => {
        keyAtCall = storage.snapshot()[DRAFT_IMPORT_BINDING_KEY] ?? null;
        expect(keyAtCall).toContain(request.idempotencyKey);
        expect(keyAtCall).not.toContain("decision-9");
        return { decision_id: "decision-9" };
      },
    });
    expect(keyAtCall).not.toBeNull();
  });
});

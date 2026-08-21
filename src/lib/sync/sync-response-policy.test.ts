import { describe, expect, it } from "vitest";
import {
  buildSyncResponsePolicy,
  classifySyncResponseMode,
} from "../../../supabase/functions/_shared/sync-response-policy";

describe("server-authoritative Sync response policy", () => {
  it("keeps greetings and capability questions conversational", () => {
    expect(classifySyncResponseMode("hi")).toBe("conversation");
    expect(classifySyncResponseMode("what can you do for me? ")).toBe(
      "conversation",
    );
    expect(buildSyncResponsePolicy("hello").directive).toContain(
      "Do not launch an unsolicited KPI review",
    );
  });

  it("does not misclassify a real engineering request that begins with help", () => {
    expect(
      classifySyncResponseMode("help me diagnose repeated low-lube trips"),
    ).toBe("engineering");
  });

  it("promotes explicit work products to deliverable mode", () => {
    const policy = buildSyncResponsePolicy("prepare a complete FMEA report");
    expect(policy.mode).toBe("deliverable");
    expect(policy.maxTokens).toBeGreaterThan(5_000);
    expect(policy.directive).toContain("complete requested deliverable");
  });

  it("keeps ordinary engineering answers answer-first and evidence-linked", () => {
    const policy = buildSyncResponsePolicy(
      "what is the highest risk in my operation today?",
    );
    expect(policy.mode).toBe("engineering");
    expect(policy.directive).toContain("first one or two sentences");
    expect(policy.directive).toContain("Cite supplied evidence labels");
  });
});

import { describe, expect, it } from "vitest";
import { syncResponseGuidance } from "./response-guidance";

describe("syncResponseGuidance", () => {
  it("keeps greetings conversational instead of launching an assessment", () => {
    const guidance = syncResponseGuidance("hi", false);

    expect(guidance).toContain("CONVERSATIONAL");
    expect(guidance).toContain("Do not launch an unsolicited KPI review");
  });

  it("keeps a standalone capability/help request conversational", () => {
    expect(syncResponseGuidance("what can you do for me?", false)).toContain(
      "CONVERSATIONAL",
    );
    expect(syncResponseGuidance("help", false)).toContain("CONVERSATIONAL");
  });

  it("does not make substantive help requests artificially brief", () => {
    const guidance = syncResponseGuidance(
      "help me diagnose repeated low lube pressure trips",
      false,
    );

    expect(guidance).toContain("ENGINEERING CONVERSATION");
  });

  it("makes normal engineering answers answer-first and avoids repetition", () => {
    const guidance = syncResponseGuidance(
      "what is the highest risk in my operation today?",
      false,
    );

    expect(guidance).toContain("ENGINEERING CONVERSATION");
    expect(guidance).toContain("first one or two sentences");
    expect(guidance).toContain("Do not repeat facts already established");
  });

  it("preserves full detail for explicit work-product requests", () => {
    const guidance = syncResponseGuidance("prepare a complete FMEA", true);

    expect(guidance).toContain("COMPLETE WORK PRODUCT");
    expect(guidance).toContain("complete requested deliverable");
  });
});

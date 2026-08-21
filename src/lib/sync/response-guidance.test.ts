import { describe, expect, it } from "vitest";
import { syncResponseGuidance } from "./response-guidance";

describe("syncResponseGuidance", () => {
  it("keeps greetings conversational instead of launching an assessment", () => {
    const guidance = syncResponseGuidance("hi", false);

    expect(guidance).toContain("CONVERSATIONAL");
    expect(guidance).toContain("Do not launch an unsolicited KPI review");
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

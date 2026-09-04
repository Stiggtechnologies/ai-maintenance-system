import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOOTH_FRAMING,
  BOOTH_UNAVAILABLE_REPLY,
  buildBoothAskQuery,
  shouldSpeakBoothReply,
  stripForSpeech,
} from "./booth";

describe("booth conversation framing", () => {
  it("grounds the ask in recommend≠authorize and refuses plant execute", () => {
    const query = buildBoothAskQuery({
      question: "How is the mill running?",
      briefLines: ["OEE: 62%"],
      givenName: "Orville",
    });
    expect(query).toContain(BOOTH_FRAMING);
    expect(query).toMatch(/Recommend is not authorize/i);
    expect(query).toMatch(/Do not execute plant actions/i);
    expect(query).toContain("OEE: 62%");
    expect(query).toContain("QUESTION: How is the mill running?");
    expect(query).toContain("Visitor given name: Orville");
    expect(query).not.toMatch(/openclaw|javis|jarvis/i);
  });

  it("does not invent plant data when the welcome brief is empty", () => {
    const query = buildBoothAskQuery({
      question: "Give me plant status",
      briefLines: [
        "No sourced KPI values are available yet.",
        "This welcome does not report plant state.",
      ],
      givenName: null,
    });
    expect(query).toContain("No sourced KPI values are available yet.");
    expect(query).toMatch(/do not invent readings/i);
    expect(query).toContain("Visitor given name is not known");
    expect(query).not.toMatch(/\b87%\b/);
    expect(query).not.toMatch(/plant is healthy/i);
  });
});

describe("booth speech gate", () => {
  it("does not speak replies when muted or signed out", () => {
    expect(
      shouldSpeakBoothReply({
        signedIn: true,
        muted: false,
        voiceOutputEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldSpeakBoothReply({
        signedIn: true,
        muted: true,
        voiceOutputEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldSpeakBoothReply({
        signedIn: false,
        muted: false,
        voiceOutputEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldSpeakBoothReply({
        signedIn: true,
        muted: false,
        voiceOutputEnabled: false,
      }),
    ).toBe(false);
  });

  it("shortens spoken replies without inventing plant claims", () => {
    expect(stripForSpeech("Short answer.")).toBe("Short answer.");
    const long = `${"Word. ".repeat(80)}The mill is fine.`;
    const spoken = stripForSpeech(long, 80);
    expect(spoken.length).toBeLessThanOrEqual(81);
    expect(spoken).not.toMatch(/autonomous control/i);
  });
});

describe("booth honesty copy", () => {
  it("uses an honest unavailable reply with no fabricated plant state", () => {
    expect(BOOTH_UNAVAILABLE_REPLY).toMatch(/does not invent plant state/i);
    expect(BOOTH_UNAVAILABLE_REPLY).toMatch(/no plant action is taken/i);
    expect(BOOTH_UNAVAILABLE_REPLY).not.toMatch(/\b(healthy|87%|online)\b/i);
  });

  it("does not import a parallel orchestrator", () => {
    const src = readFileSync("src/lib/presence/booth.ts", "utf8");
    const imports = src
      .split("\n")
      .filter((line) => line.includes("import "))
      .join("\n");
    expect(imports).not.toMatch(
      /openclaw|javis|jarvis|sir-runtime|autonomous-orchestrator/i,
    );
  });
});

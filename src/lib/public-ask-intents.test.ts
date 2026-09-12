import { describe, expect, it } from "vitest";
import {
  FIRST_PAINT_QUESTIONS,
  createFirstPaintSeed,
} from "./first-paint-seeds";
import { PUBLIC_ASK_INTENTS, publicAskIntentById } from "./public-ask-intents";

describe("public ask intents", () => {
  it("keeps the Bolt pill order and maps each to a locked first-paint seed", () => {
    expect(PUBLIC_ASK_INTENTS.map((item) => item.label)).toEqual([
      "Compare",
      "Troubleshoot",
      "Health",
      "Learn",
      "Fact Check",
    ]);
    expect(PUBLIC_ASK_INTENTS.map((item) => item.showcase)).toEqual([
      "Production opportunity",
      "Repeat failure",
      "Operating risk",
      "PM effectiveness",
      "Downtime evidence",
    ]);
    expect(PUBLIC_ASK_INTENTS.map((item) => item.question)).toEqual([
      FIRST_PAINT_QUESTIONS[0],
      FIRST_PAINT_QUESTIONS[4],
      FIRST_PAINT_QUESTIONS[1],
      FIRST_PAINT_QUESTIONS[3],
      FIRST_PAINT_QUESTIONS[2],
    ]);
  });

  it("does not invent a sixth pill or a P-101 seed", () => {
    expect(PUBLIC_ASK_INTENTS).toHaveLength(5);
    const assets = PUBLIC_ASK_INTENTS.map(
      (item) => createFirstPaintSeed(item.seedIndex).asset,
    );
    expect(new Set(assets).size).toBe(5);
    for (const item of PUBLIC_ASK_INTENTS) {
      const seed = createFirstPaintSeed(item.seedIndex);
      expect(seed.asset).not.toMatch(/P-101/);
      expect(seed.title).not.toMatch(/seal inspection/i);
      expect(
        seed.messages.find((message) => message.role === "user")?.text,
      ).toBe(item.question);
    }
    expect(publicAskIntentById("missing")).toBeUndefined();
    expect(publicAskIntentById("compare")?.seedIndex).toBe(0);
  });
});

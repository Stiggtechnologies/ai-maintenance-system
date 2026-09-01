import { describe, expect, it } from "vitest";
import {
  FIRST_PAINT_QUESTIONS,
  FIRST_PAINT_SEEDS,
  createFirstPaintSeed,
} from "./first-paint-seeds";

describe("first-paint seed catalog", () => {
  it("rotates six conversion questions in the locked order", () => {
    expect(FIRST_PAINT_QUESTIONS).toEqual([
      "What should we fix first to recover the most production?",
      "Can this asset safely run until the next planned shutdown?",
      "Which assets are costing us the most in avoidable downtime?",
      "Which PM tasks can we extend or eliminate?",
      "Why does this equipment keep failing after repair?",
      "Should we repair, redesign, or replace this asset?",
    ]);
    expect(FIRST_PAINT_SEEDS.map((item) => item.question)).toEqual([
      ...FIRST_PAINT_QUESTIONS,
    ]);
  });

  it("loads a distinct seed for each question and keeps P-101 seal inspection out", () => {
    const seeds = FIRST_PAINT_QUESTIONS.map((_, index) =>
      createFirstPaintSeed(index),
    );
    const assets = seeds.map((item) => item.asset);
    const titles = seeds.map((item) => item.title);
    const userTurns = seeds.map(
      (item) => item.messages.find((message) => message.role === "user")?.text,
    );

    expect(new Set(assets).size).toBe(6);
    expect(userTurns).toEqual([...FIRST_PAINT_QUESTIONS]);
    for (const seed of seeds) {
      expect(seed.asset).not.toMatch(/P-101/);
      expect(seed.title).not.toMatch(/seal inspection/i);
      expect(
        seed.messages.some(
          (message) =>
            message.role === "assistant" &&
            /recommendation/i.test(message.meta ?? ""),
        ),
      ).toBe(true);
    }
    expect(titles.some((title) => /P-101/.test(title))).toBe(false);
  });
});

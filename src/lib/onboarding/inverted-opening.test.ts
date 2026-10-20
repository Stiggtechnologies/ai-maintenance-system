import { describe, expect, it } from "vitest";
import {
  INVERTED_EXAMPLE_PROMPTS,
  INVERTED_INTENT_CARDS,
  INVERTED_OPENING_AUTHORITY,
  INVERTED_OPENING_HEADLINE,
  INVERTED_OPENING_SUB,
  isExamplePrompt,
} from "./inverted-opening";

describe("inverted opening P0.1", () => {
  it("frames 20-minute decision and authority once", () => {
    expect(INVERTED_OPENING_HEADLINE).toMatch(/20 minutes/i);
    expect(INVERTED_OPENING_SUB).toMatch(/Ask a real question/i);
    expect(INVERTED_OPENING_SUB).toMatch(/Verify the outcome/i);
    expect(INVERTED_OPENING_AUTHORITY).toMatch(/recommends/i);
    expect(INVERTED_OPENING_AUTHORITY).toMatch(/authorize/i);
  });

  it("exposes two labeled examples and three intent cards", () => {
    expect(INVERTED_EXAMPLE_PROMPTS).toHaveLength(2);
    for (const ex of INVERTED_EXAMPLE_PROMPTS) {
      expect(ex.label).toBe("Example");
      expect(ex.prompt.endsWith("?")).toBe(true);
      expect(ex.prompt.length).toBeGreaterThan(40);
      expect(ex.prompt).not.toMatch(/…/);
    }
    expect(INVERTED_INTENT_CARDS.map((c) => c.id)).toEqual([
      "solve",
      "coordinate",
      "connect",
    ]);
    expect(INVERTED_INTENT_CARDS.map((c) => c.title)).toEqual([
      "Solve an engineering question",
      "Coordinate field work",
      "Connect my site",
    ]);
    expect(
      INVERTED_INTENT_CARDS.find((card) => card.id === "connect")?.body,
    ).toMatch(/Optional after first value/);
    expect(
      INVERTED_INTENT_CARDS.find((card) => card.id === "connect")?.body,
    ).toMatch(/does not add a connector/);
    expect(
      INVERTED_INTENT_CARDS.find((card) => card.id === "connect")?.body,
    ).toMatch(/no connection/);
  });

  it("treats exact example text as non-persistable", () => {
    expect(isExamplePrompt(INVERTED_EXAMPLE_PROMPTS[0].prompt)).toBe(true);
    expect(isExamplePrompt(`  ${INVERTED_EXAMPLE_PROMPTS[1].prompt}  `)).toBe(
      true,
    );
    expect(
      isExamplePrompt(
        "Should we hold the inspection interval on the reclaim pump until the next outage?",
      ),
    ).toBe(false);
  });
});

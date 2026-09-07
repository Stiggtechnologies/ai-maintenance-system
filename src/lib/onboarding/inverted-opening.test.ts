import { describe, expect, it } from "vitest";
import {
  INVERTED_EXAMPLE_PROMPTS,
  INVERTED_INTENT_CARDS,
  INVERTED_OPENING_AUTHORITY,
  INVERTED_OPENING_HEADLINE,
} from "./inverted-opening";

describe("inverted opening P0.1", () => {
  it("frames 20-minute decision and authority once", () => {
    expect(INVERTED_OPENING_HEADLINE).toMatch(/20 minutes/i);
    expect(INVERTED_OPENING_AUTHORITY).toMatch(/recommends/i);
    expect(INVERTED_OPENING_AUTHORITY).toMatch(/authorize/i);
  });

  it("exposes two labeled examples and three intent cards", () => {
    expect(INVERTED_EXAMPLE_PROMPTS).toHaveLength(2);
    for (const ex of INVERTED_EXAMPLE_PROMPTS) {
      expect(ex.label).toBe("Example");
    }
    expect(INVERTED_INTENT_CARDS.map((c) => c.id)).toEqual([
      "solve",
      "coordinate",
      "connect",
    ]);
  });
});

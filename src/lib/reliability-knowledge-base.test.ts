import { describe, expect, it } from "vitest";
import {
  getReliabilityKnowledgeSources,
  retrieveReliabilityKnowledge,
} from "./reliability-knowledge-base";

describe("reliability knowledge base", () => {
  it("retrieves FRACAS grounding from the seed corpus map", () => {
    const results = retrieveReliabilityKnowledge(
      "Create a FRACAS case with corrective action and recurrence verification",
    );

    expect(results[0].id).toBe("mil-hdbk-338b-fracas");
    expect(results[0].confidence).toBe("high");
    expect(results[0].supports.join(" ")).toContain("closed-loop");
  });

  it("keeps source metadata available without embedding raw source documents", () => {
    const sources = getReliabilityKnowledgeSources();

    expect(sources.length).toBeGreaterThan(3);
    expect(sources.every((source) => source.summary.length < 300)).toBe(true);
    expect(sources.map((source) => source.source)).toContain("MIL-HDBK-338B");
  });
});

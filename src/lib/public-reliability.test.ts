import { describe, expect, it } from "vitest";
import {
  PUBLIC_RELIABILITY_STORAGE_KEY,
  generatePublicReliabilityAnalysis,
  hasUsedPublicReliabilityFreeRun,
  parsePublicReliabilityUsage,
  readPublicReliabilityUsage,
  recordPublicReliabilityRun,
} from "./public-reliability";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("public Reliability Engineer", () => {
  it("builds a governed report from approved reference-case data", () => {
    const result = generatePublicReliabilityAnalysis(
      "pump-seal",
      new Date("2026-08-06T00:00:00.000Z"),
    );

    expect(result.report.generatedAt).toBe("2026-08-06T00:00:00.000Z");
    expect(result.userQuestion).toBe(result.scenario.question);
    expect(result.report.badActors[0]).toMatchObject({
      assetId: "P-101",
      topFailureMode: "Seal leak",
    });
    expect(result.report.riskLevel).toBe("high");
    expect(
      result.report.governedRecommendations[0].approvalRequirement,
    ).toContain("Qualified engineering approval");
    expect(result.scenario.hypotheses).toHaveLength(3);
  });

  it("accepts an open-ended reliability question without inventing RAM data", () => {
    const result = generatePublicReliabilityAnalysis(
      "open-question",
      new Date("2026-08-06T00:00:00.000Z"),
      "A haul truck repeatedly derates under load. What should we verify first?",
    );

    expect(result.scenario.hasReferenceData).toBe(false);
    expect(result.report.badActors).toHaveLength(0);
    expect(result.patternSummary).toMatch(/not contain enough structured evidence/i);
  });

  it("records one anonymous run and exposes the conversion gate", () => {
    const storage = memoryStorage();

    expect(readPublicReliabilityUsage(storage)).toBeNull();
    const usage = recordPublicReliabilityRun(
      storage,
      "conveyor-mistracking",
      new Date("2026-08-06T01:02:03.000Z"),
      "Show me the recurring failure mechanism.",
    );

    expect(usage).toEqual({
      runCount: 1,
      scenarioId: "conveyor-mistracking",
      completedAt: "2026-08-06T01:02:03.000Z",
      question: "Show me the recurring failure mechanism.",
    });
    expect(hasUsedPublicReliabilityFreeRun(usage)).toBe(true);
    expect(storage.values.has(PUBLIC_RELIABILITY_STORAGE_KEY)).toBe(true);
  });

  it("uses a bounded custom question in the governed report", () => {
    const result = generatePublicReliabilityAnalysis(
      "compressor-vibration",
      new Date("2026-08-06T00:00:00.000Z"),
      "Compare the repeat trips and tell me what evidence to collect.",
    );

    expect(result.userQuestion).toBe(
      "Compare the repeat trips and tell me what evidence to collect.",
    );
    expect(result.report.recommendations[0]).toContain(
      "Compare the repeat trips",
    );
  });

  it("fails closed when stored usage is malformed", () => {
    expect(parsePublicReliabilityUsage("not-json")).toBeNull();
    expect(
      parsePublicReliabilityUsage(
        JSON.stringify({
          runCount: 1,
          scenarioId: "unknown",
          completedAt: "2026-08-06T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });
});

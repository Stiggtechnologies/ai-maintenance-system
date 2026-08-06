import { describe, expect, it } from "vitest";
import {
  PUBLIC_DEMO_STORAGE_KEY,
  generatePublicReliabilityDemo,
  hasUsedPublicDemo,
  parsePublicDemoUsage,
  readPublicDemoUsage,
  recordPublicDemoRun,
} from "./public-reliability-demo";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("public reliability demo", () => {
  it("builds a governed report from synthetic scenario data", () => {
    const result = generatePublicReliabilityDemo(
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

  it("records one anonymous run and exposes the conversion gate", () => {
    const storage = memoryStorage();

    expect(readPublicDemoUsage(storage)).toBeNull();
    const usage = recordPublicDemoRun(
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
    expect(hasUsedPublicDemo(usage)).toBe(true);
    expect(storage.values.has(PUBLIC_DEMO_STORAGE_KEY)).toBe(true);
  });

  it("uses a bounded custom question in the governed report", () => {
    const result = generatePublicReliabilityDemo(
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
    expect(parsePublicDemoUsage("not-json")).toBeNull();
    expect(
      parsePublicDemoUsage(
        JSON.stringify({
          runCount: 1,
          scenarioId: "unknown",
          completedAt: "2026-08-06T00:00:00.000Z",
        }),
      ),
    ).toBeNull();
  });
});

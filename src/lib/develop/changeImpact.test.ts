import { describe, expect, it } from "vitest";
import {
  aiConsequenceDisclaimer,
  readChangeImpactReports,
  type ChangeImpactReport,
} from "./changeImpact";
import type { ThreadImpactPayload } from "./thread";

const impact = (over: Partial<ThreadImpactPayload> = {}) =>
  ({
    caseId: "c1",
    objectId: 1,
    objectRef: "S5D-DR1",
    refused: false,
    downstreamCount: 2,
    reachedCount: 2,
    affected: [],
    gaps: [],
    ...over,
  }) as unknown as ThreadImpactPayload;

const report = (
  over: Partial<ChangeImpactReport> = {},
): ChangeImpactReport => ({
  id: 1,
  asAt: "2026-12-07T10:00:00Z",
  objectId: 1,
  objectRef: "S5D-DR1",
  objectKind: "drawing",
  refused: false,
  downstreamCount: 2,
  reachedCount: 2,
  gapCount: 0,
  impact: impact(),
  narrative: null,
  model: null,
  aiConsequences: [],
  agentKey: "sync-develop-change-impact",
  advisory: true,
  requestedBy: "Planner",
  ...over,
});

describe("the agent's register never reads as a clean bill (D12.10)", () => {
  it("an empty register says so about ITSELF, not about the thread", () => {
    const reading = readChangeImpactReports({ caseId: "c1", reports: [] });
    expect(reading.headline).toContain("statement about this register");
    expect(reading.headline).not.toContain("0 downstream");
  });

  it("a refused latest reading leads with the REFUSAL and never a count", () => {
    const reading = readChangeImpactReports({
      caseId: "c1",
      reports: [
        report({
          refused: true,
          downstreamCount: null,
          reachedCount: 3,
          gapCount: 2,
        }),
      ],
    });
    expect(reading.headline).toContain("REFUSED");
    expect(reading.headline).toContain("floor");
    expect(reading.refusedCount).toBe(1);
    expect(reading.latest?.downstreamCount).toBeNull();
  });

  it("an answered reading states the count and that there was no gap", () => {
    const reading = readChangeImpactReports({
      caseId: "c1",
      reports: [report()],
    });
    expect(reading.headline).toContain("touches 2 downstream object(s)");
    expect(reading.headline).toContain("no gap");
  });

  it("counts every refusal in the register, not only the latest", () => {
    const reading = readChangeImpactReports({
      caseId: "c1",
      reports: [
        report({ id: 3 }),
        report({ id: 2, refused: true, downstreamCount: null }),
        report({ id: 1, refused: true, downstreamCount: null }),
      ],
    });
    expect(reading.refusedCount).toBe(2);
    expect(reading.latest?.id).toBe(3);
  });
});

describe("model output is labelled wherever it is shown", () => {
  it("names the model and states what the agent cannot do", () => {
    const line = aiConsequenceDisclaimer("some-model");
    expect(line).toContain("AI-GENERATED (some-model)");
    expect(line).toContain("cannot acknowledge a receipt");
    expect(line).toContain("can block a gate");
  });

  it("still labels the output when the model name is missing", () => {
    expect(aiConsequenceDisclaimer(null)).toContain("AI-GENERATED (model)");
  });
});

describe("readChangeImpactReports — a null count is a refusal, not a number", () => {
  it("renders a refused report as a refusal with no count", () => {
    const r = readChangeImpactReports({
      caseId: "c1",
      reports: [
        report({
          refused: true,
          downstreamCount: null,
          gapCount: 2,
          reachedCount: 3,
        }),
      ],
    } as never);
    expect(r.headline).toContain("REFUSED");
    expect(r.headline).not.toMatch(/touches/);
  });

  it("never interpolates a null count into the 'touches N' sentence", () => {
    // The regression: `touches ${latest.downstreamCount}` rendered "touches
    // null downstream object(s), with no gap on the way" the moment a report
    // carried a null count without `refused`. The table's CHECK makes that
    // pair unrepresentable today, which is exactly why the client was written
    // as though it could not happen — and "touches null" and "touches 0" are
    // the two ways this one sentence goes wrong.
    const r = readChangeImpactReports({
      caseId: "c1",
      reports: [report({ refused: false, downstreamCount: null })],
    } as never);
    expect(r.headline).not.toContain("touches null");
    expect(r.headline).not.toContain("touches 0");
    expect(r.headline).toContain("NO downstream count");
  });
});

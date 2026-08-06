import { describe, expect, it } from "vitest";
import {
  generateReliabilityReport,
  parseWorkOrderCsv,
  SAMPLE_FAILURE_HISTORY_CSV,
  summarizeBadActors,
} from "./reliability-report-engine";

describe("reliability report engine", () => {
  it("parses work-order CSV into normalized failure records", () => {
    const records = parseWorkOrderCsv(SAMPLE_FAILURE_HISTORY_CSV);

    expect(records).toHaveLength(7);
    expect(records[0]).toMatchObject({
      assetId: "P-101",
      failureMode: "Seal leak",
      downtimeHours: 18,
      repairHours: 6,
      maintenanceCost: 4200,
    });
  });

  it("summarizes bad actors by downtime, failures, and cost", () => {
    const badActors = summarizeBadActors(
      parseWorkOrderCsv(SAMPLE_FAILURE_HISTORY_CSV),
    );

    expect(badActors[0]).toMatchObject({
      assetId: "P-101",
      failures: 4,
      downtimeHours: 65,
      repairHours: 22,
      maintenanceCost: 15000,
      topFailureMode: "Seal leak",
    });
    expect(badActors[1].assetId).toBe("C-330");
  });

  it("generates a concrete report with calculations and workflow actions", () => {
    const report = generateReliabilityReport({
      mode: "RCA",
      prompt: "Analyze chronic pump seal failures.",
      csvText: SAMPLE_FAILURE_HISTORY_CSV,
      inputs: {
        operatingHours: 10000,
        failures: 20,
        repairHours: 100,
        repairEvents: 20,
        missionTimeHours: 100,
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    expect(report.metrics.mtbf).toBe(500);
    expect(report.metrics.mttr).toBe(5);
    expect(report.metrics.inherentAvailability).toBeCloseTo(0.990099, 6);
    expect(report.metrics.costOfUnreliability).toBe(25750);
    expect(report.badActors[0].assetId).toBe("P-101");
    expect(report.recommendations.join(" ")).toContain("P-101");
    expect(report.governedRecommendations[0]).toMatchObject({
      ownerRole: "Reliability engineer",
      confidence: "medium",
    });
    expect(report.governedRecommendations[0].evidenceUsed.join(" ")).toContain(
      "P-101",
    );
    expect(report.sources[0].source).toBeTruthy();
    expect(report.actions.join(" ")).toContain("Confirm problem statement");
    expect(report.markdown).toContain("# RCA Reliability Analysis");
    expect(report.markdown).toContain("## Bad Actors");
    expect(report.markdown).toContain("## Governed Recommendations");
    expect(report.markdown).toContain("## Source Grounding");
    expect(report.markdown).toContain("## Data Quality Findings");
    expect(report.markdown).toContain("P-101");
  });

  it("keeps evidence gaps explicit when no failure data is supplied", () => {
    const report = generateReliabilityReport({
      mode: "FRACAS",
      prompt: "Create a FRACAS case.",
      csvText: "",
      inputs: {
        operatingHours: 1000,
        failures: 2,
        repairHours: 12,
        repairEvents: 2,
        missionTimeHours: 24,
      },
    });

    expect(report.dataSummary.recordCount).toBe(0);
    expect(report.confidence).toBe("low");
    expect(report.dataQualityFindings[0].severity).toBe("high");
    expect(report.evidenceGaps).toContain(
      "Asset hierarchy and operating context",
    );
    expect(report.markdown).toContain("No structured failure-history rows");
  });
});

import { describe, expect, it } from "vitest";
import {
  CLIMATE_RESILIENCE_HAZARDS,
  OPTION_COMPARISON_DIMENSIONS,
  RECORDED_OPTION_DIMENSIONS,
  assessConceptSelectionCompleteness,
} from "./sustainability";

describe("concept-selection sustainability and climate completeness", () => {
  it("pins the eleven dimensions and eight future-condition hazards", () => {
    expect(OPTION_COMPARISON_DIMENSIONS).toEqual([
      "capex",
      "opex",
      "safety",
      "reliability",
      "carbon",
      "energy",
      "water",
      "land",
      "waste",
      "social_effect",
      "climate_resilience",
    ]);
    expect(CLIMATE_RESILIENCE_HAZARDS).toEqual([
      "extreme_temperature",
      "wildfire",
      "flood",
      "precipitation",
      "water_availability",
      "freeze_thaw",
      "permafrost",
      "storm_severity",
    ]);
  });

  it("reports every missing dimension and hazard without manufacturing a score", () => {
    const result = assessConceptSelectionCompleteness({
      dimensions: [{ dimension: "capex" }],
      hazards: [{ hazard: "wildfire" }],
      climateAssessmentReviewed: false,
    });
    expect(result.complete).toBe(false);
    expect(result.recordedDimensions).toBe(1);
    expect(result.missingDimensions).toContain("climate_resilience");
    expect(result.missingHazards).toHaveLength(7);
    expect(result.reason).toContain("No option score or ranking is inferred");
    expect(result).not.toHaveProperty("score");
  });

  it("becomes complete only with ten recorded dimensions and all eight reviewed hazards", () => {
    const result = assessConceptSelectionCompleteness({
      dimensions: RECORDED_OPTION_DIMENSIONS.map((dimension) => ({ dimension })),
      hazards: CLIMATE_RESILIENCE_HAZARDS.map((hazard) => ({ hazard })),
      climateAssessmentReviewed: true,
    });
    expect(result.complete).toBe(true);
    expect(result.recordedDimensions).toBe(11);
    expect(result.recordedHazards).toBe(8);
    expect(result.missingDimensions).toEqual([]);
    expect(result.reason).toContain("not a preferred option");
  });

  it("does not treat eight recorded hazards as reviewed engineering assurance", () => {
    const result = assessConceptSelectionCompleteness({
      dimensions: RECORDED_OPTION_DIMENSIONS.map((dimension) => ({ dimension })),
      hazards: CLIMATE_RESILIENCE_HAZARDS.map((hazard) => ({ hazard })),
      climateAssessmentReviewed: false,
    });
    expect(result.complete).toBe(false);
    expect(result.missingDimensions).toEqual(["climate_resilience"]);
    expect(result.missingHazards).toEqual([]);
    expect(result.reason).toContain("not been independently reviewed");
  });
});


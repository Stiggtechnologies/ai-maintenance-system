/**
 * D2.08 / D4.08 / D4.09 — concept-selection completeness vocabulary.
 *
 * These functions assess whether recorded evidence covers the specification;
 * they do not score an option, rank it, certify resilience, or select a
 * preferred concept. A missing dimension remains a named gap.
 */

export const OPTION_COMPARISON_DIMENSIONS = [
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
] as const;

export type OptionComparisonDimension =
  (typeof OPTION_COMPARISON_DIMENSIONS)[number];

export const RECORDED_OPTION_DIMENSIONS = OPTION_COMPARISON_DIMENSIONS.filter(
  (dimension) => dimension !== "climate_resilience",
) as Exclude<OptionComparisonDimension, "climate_resilience">[];

export const CLIMATE_RESILIENCE_HAZARDS = [
  "extreme_temperature",
  "wildfire",
  "flood",
  "precipitation",
  "water_availability",
  "freeze_thaw",
  "permafrost",
  "storm_severity",
] as const;

export type ClimateResilienceHazard =
  (typeof CLIMATE_RESILIENCE_HAZARDS)[number];

export interface OptionDimensionRecord {
  dimension: Exclude<OptionComparisonDimension, "climate_resilience">;
}

export interface ClimateHazardRecord {
  hazard: ClimateResilienceHazard;
}

export interface ConceptSelectionCompleteness {
  complete: boolean;
  recordedDimensions: number;
  requiredDimensions: number;
  missingDimensions: OptionComparisonDimension[];
  recordedHazards: number;
  requiredHazards: number;
  missingHazards: ClimateResilienceHazard[];
  reason: string;
}

export function assessConceptSelectionCompleteness(input: {
  dimensions: OptionDimensionRecord[];
  hazards: ClimateHazardRecord[];
  climateAssessmentReviewed: boolean;
}): ConceptSelectionCompleteness {
  const recordedDimensions = new Set(input.dimensions.map((row) => row.dimension));
  const recordedHazards = new Set(input.hazards.map((row) => row.hazard));
  const missingHazards = CLIMATE_RESILIENCE_HAZARDS.filter(
    (hazard) => !recordedHazards.has(hazard),
  );
  const climateComplete =
    input.climateAssessmentReviewed && missingHazards.length === 0;
  const missingDimensions = OPTION_COMPARISON_DIMENSIONS.filter((dimension) =>
    dimension === "climate_resilience"
      ? !climateComplete
      : !recordedDimensions.has(dimension),
  );

  return {
    complete: missingDimensions.length === 0,
    recordedDimensions:
      recordedDimensions.size + (climateComplete ? 1 : 0),
    requiredDimensions: OPTION_COMPARISON_DIMENSIONS.length,
    missingDimensions,
    recordedHazards: recordedHazards.size,
    requiredHazards: CLIMATE_RESILIENCE_HAZARDS.length,
    missingHazards,
    reason:
      missingDimensions.length === 0
        ? "All eleven concept-selection dimensions are evidence-backed, including a human-reviewed assessment of all eight climate-resilience hazards. This establishes comparison completeness, not a preferred option or resilience certification."
        : `Comparison incomplete: ${missingDimensions.join(", ")}. ` +
          (missingHazards.length > 0
            ? `Climate hazards still missing: ${missingHazards.join(", ")}. `
            : input.climateAssessmentReviewed
              ? ""
              : "The eight-hazard climate assessment has not been independently reviewed. ") +
          "No option score or ranking is inferred from incomplete evidence.",
  };
}


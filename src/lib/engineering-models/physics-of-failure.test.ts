import { describe, expect, it } from "vitest";
import {
  applyMaintenanceIntervention,
  assessVerificationDebt,
  calculateArchardWearVolumeM3,
  calculateArrheniusAccelerationFactor,
  calculateCoffinMansonCycles,
  calculateCreepDamage,
  calculateMinerDamage,
  calculateParisLawCycles,
  combineMechanismHazards,
  compareModelEstimates,
  comparePhysicalAndEconomicRul,
  extractRainflowCycles,
  rankMechanismHypotheses,
  runParameterSweep,
  updateGaussianDamageState,
} from "./physics-of-failure";

describe("physics-of-failure deterministic kernels", () => {
  it("calculates cumulative fatigue but refuses to invent its action threshold", () => {
    expect(
      calculateMinerDamage([{ appliedCycles: 5, allowableCycles: 10 }]),
    ).toMatchObject({
      damageFraction: 0.5,
      thresholdStatus: "unassessed",
      refusal: { code: "approved_damage_threshold_missing" },
    });
    expect(
      calculateMinerDamage([{ appliedCycles: 5, allowableCycles: 10 }], 0.8),
    ).toMatchObject({
      thresholdStatus: "within_approved_threshold",
    });
  });

  it("implements bounded ALT, strain-life, crack-growth, creep, and wear primitives", () => {
    expect(
      calculateArrheniusAccelerationFactor({
        activationEnergyEv: 0.7,
        useTemperatureK: 300,
        acceleratedTemperatureK: 350,
      }),
    ).toBeGreaterThan(1);
    expect(
      calculateCoffinMansonCycles({
        plasticStrainAmplitude: 0.01,
        fatigueDuctilityCoefficient: 0.5,
        fatigueDuctilityExponent: -0.5,
      }),
    ).toBeGreaterThan(0);
    expect(
      calculateParisLawCycles({
        initialCrackM: 0.001,
        finalCrackM: 0.002,
        parisC: 1e-28,
        parisM: 3,
        geometryFactor: 1.1,
        stressRangePa: 80e6,
      }),
    ).toBeGreaterThan(0);
    expect(
      calculateCreepDamage([
        { durationHours: 10, approvedRuptureTimeHours: 100 },
      ]).damageFraction,
    ).toBeCloseTo(0.1);
    expect(
      calculateArchardWearVolumeM3({
        wearCoefficient: 1e-4,
        normalLoadN: 1_000,
        slidingDistanceM: 10,
        hardnessPa: 1e9,
      }),
    ).toBeCloseTo(1e-9);
  });

  it("extracts a durable cycle spectrum without treating an empty history as evidence", () => {
    expect(extractRainflowCycles([0, 10, 0, -10, 0]).length).toBeGreaterThan(0);
    expect(() => extractRainflowCycles([0])).toThrow(/two load samples/);
  });

  it("adds hazards only when independence or an interaction model is established", () => {
    expect(
      combineMechanismHazards({
        hazardsPerHour: [0.01, 0.02],
        independenceEstablished: true,
      }).totalHazardPerHour,
    ).toBeCloseTo(0.03);
    expect(
      combineMechanismHazards({
        hazardsPerHour: [0.01, 0.02],
        independenceEstablished: false,
      }),
    ).toMatchObject({
      totalHazardPerHour: null,
      refusal: { code: "mechanism_interaction_unmodelled" },
    });
  });

  it("updates a hidden damage state with its uncertainty visible", () => {
    const result = updateGaussianDamageState({
      priorMean: 0.4,
      priorVariance: 0.04,
      measurement: 0.6,
      measurementVariance: 0.01,
    });
    expect(result.mean).toBeCloseTo(0.56);
    expect(result.variance).toBeCloseTo(0.008);
  });

  it("ranks competing mechanisms without selecting an RCA on the human's behalf", () => {
    const ranked = rankMechanismHypotheses([
      {
        mechanismKey: "fatigue",
        physicsConsistency: 0.9,
        evidenceSupport: 0.8,
        contradictingEvidence: 0.1,
        predictionAccuracy: 0.8,
      },
      {
        mechanismKey: "corrosion",
        physicsConsistency: 0.7,
        evidenceSupport: 0.2,
        contradictingEvidence: 0.5,
        predictionAccuracy: null,
      },
    ]);
    expect(ranked[0]).toMatchObject({
      mechanismKey: "fatigue",
      rank: 1,
      humanSelectionRequired: true,
    });
  });

  it("blocks expired or blocking verification debt", () => {
    const result = assessVerificationDebt(
      [
        { id: "field", description: "Field case", blocking: true },
        {
          id: "temporary",
          description: "Temporary advisory approval",
          blocking: false,
          expiresAt: "2026-01-01T00:00:00Z",
        },
      ],
      new Date("2026-09-05T00:00:00Z"),
    );
    expect(result.productionEligible).toBe(false);
    expect(result.expired).toHaveLength(1);
  });

  it("models intervention effects only from an approved reset and separates economic from safe RUL", () => {
    expect(
      applyMaintenanceIntervention({
        currentDamage: 0.8,
        effect: "partial_reset",
      }),
    ).toMatchObject({
      postInterventionDamage: null,
      refusal: { code: "intervention_effect_missing" },
    });
    expect(
      applyMaintenanceIntervention({
        currentDamage: 0.8,
        effect: "partial_reset",
        approvedResetFraction: 0.25,
      }).postInterventionDamage,
    ).toBeCloseTo(0.6);
    expect(
      comparePhysicalAndEconomicRul({
        safeRulHours: 200,
        economicReplacementHours: 500,
        consequenceClass: "safety_critical",
      }),
    ).toMatchObject({
      planningHorizonHours: 200,
      humanApprovalRequired: true,
    });
  });

  it("surfaces model disagreement and creates reproducible parameter sweeps", () => {
    expect(
      compareModelEstimates([
        {
          modelKey: "empirical",
          value: 1_800,
          unit: "h",
          lower: 1_700,
          upper: 1_900,
        },
        {
          modelKey: "pof",
          value: 1_250,
          unit: "h",
          lower: 1_150,
          upper: 1_350,
        },
      ]),
    ).toMatchObject({ conflict: true });
    expect(runParameterSweep([1, 2, 3], (value) => value ** 2)).toEqual([
      { input: 1, output: 1 },
      { input: 2, output: 4 },
      { input: 3, output: 9 },
    ]);
  });
});

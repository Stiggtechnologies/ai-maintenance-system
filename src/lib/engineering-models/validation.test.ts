import { describe, expect, it } from "vitest";
import { shaftResonanceModelPack } from "./resonance";
import type { ModelEvaluationContext, ModelPromotionEvidence } from "./types";
import {
  assessModelApplicability,
  assessModelPromotion,
  checkModelPortCompatibility,
  downstreamModelKeys,
  validatePhysicsModelPack,
} from "./validation";

function clonePack() {
  return structuredClone(shaftResonanceModelPack);
}

const quality = {
  calibrationCurrent: true,
  samplingAdequate: true,
  missingFraction: 0,
  driftDetected: false,
};

function applicableContext(): ModelEvaluationContext {
  return {
    assetFamily: "rotating_fluid_equipment",
    componentCategory: "shaft",
    operatingState: "running_steady",
    activeConditionCodes: [],
    configurationBaselineId: "6f5cfffd-2ad2-4d5b-a0f8-ea53866e4d39",
    inputs: {
      rpm: {
        value: 1_800,
        unit: "r/min",
        evidenceItemId: "ev-rpm",
        sourceReference: "historian:PI/RPM",
        evidenceGrade: "B",
        measurementQuality: quality,
      },
      forcing_order: {
        value: 1,
        unit: "1",
        evidenceItemId: "ev-order",
        sourceReference: "engineering:forcing-order",
        evidenceGrade: "A",
        measurementQuality: quality,
      },
      dominant_peak_hz: {
        value: 30,
        unit: "Hz",
        evidenceItemId: "ev-spectrum",
        sourceReference: "vibration:spectrum-1",
        evidenceGrade: "B",
        measurementQuality: quality,
      },
      modal_mass_kg: {
        value: 100,
        unit: "kg",
        evidenceItemId: "ev-mass",
        sourceReference: "modal:test-1",
        evidenceGrade: "B",
        measurementQuality: quality,
      },
      modal_stiffness_n_m: {
        value: 3_553_057.584,
        unit: "N/m",
        evidenceItemId: "ev-stiffness",
        sourceReference: "modal:test-1",
        evidenceGrade: "B",
        measurementQuality: quality,
      },
      match_tolerance_pct: {
        value: 2,
        unit: "%",
        evidenceItemId: "ev-tolerance",
        sourceReference: "engineering:approved-match-tolerance",
        evidenceGrade: "A",
        measurementQuality: quality,
      },
    },
  };
}

describe("engineering model supply-chain validation", () => {
  it("accepts the complete reference pack contract", () => {
    expect(validatePhysicsModelPack(clonePack())).toEqual([]);
  });

  it("rejects incomplete GPD provenance, path traversal, and missing verification families", () => {
    const pack = clonePack();
    pack.authoring.tool = "gpd";
    pack.authoring.sourceLicense = "unknown";
    pack.artifacts[0].path = "../../PROJECT.md";
    pack.verification.checks = pack.verification.checks.filter(
      (check) => check.kind !== "adversarial",
    );
    expect(
      validatePhysicsModelPack(pack).map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Apache-2.0/),
        expect.stringMatching(/traversal-free/),
        expect.stringMatching(/adversarial/),
      ]),
    );
  });

  it("rejects a pack that weakens closed-loop PoF assurance", () => {
    const pack = clonePack();
    pack.reliabilityAssurance.learning.counterfactualReviewRequired = false;
    pack.reliabilityAssurance.decisionSupport.probabilityOfDetectionRequired = false;
    pack.uncertainty.components = pack.uncertainty.components.filter(
      (component) => component.kind !== "model_form",
    );
    expect(validatePhysicsModelPack(pack).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "reliabilityAssurance.learning.counterfactualReviewRequired",
        "reliabilityAssurance.decisionSupport.probabilityOfDetectionRequired",
        "uncertainty.components",
      ]),
    );
  });

  it("rejects incomplete model definitions, empty mechanisms, and empty applicability ranges", () => {
    const pack = clonePack();
    pack.governingEquations = [];
    pack.mechanismKeys = [];
    pack.applicability.rules[0].range = {
      min: 1,
      max: 1,
      minInclusive: false,
    };
    pack.environment.packageLockSha256 = "not-a-digest";
    expect(validatePhysicsModelPack(pack).map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "modelDefinition",
        "mechanismKeys",
        "applicability.rules.rpm",
        "environment.packageLockSha256",
      ]),
    );
  });

  it("refuses a model outside its asset, configuration, units, evidence, and measurement envelope", () => {
    const context = applicableContext();
    context.assetFamily = "pressure_equipment";
    context.configurationBaselineId = undefined;
    context.activeConditionCodes = ["sensor_saturation"];
    context.inputs.rpm.unit = "Hz";
    context.inputs.rpm.evidenceItemId = undefined;
    context.inputs.rpm.measurementQuality = { ...quality, driftDetected: true };
    const result = assessModelApplicability(clonePack(), context);
    expect(result.applicable).toBe(false);
    expect(result.refusals.map((refusal) => refusal.code)).toEqual(
      expect.arrayContaining([
        "asset_family_outside_envelope",
        "excluded_condition_present",
        "configuration_baseline_missing",
        "input_unit_mismatch",
        "canonical_evidence_missing",
        "measurement_quality_insufficient",
      ]),
    );
  });

  it("accepts an evidenced context within the declared envelope", () => {
    expect(assessModelApplicability(clonePack(), applicableContext())).toEqual({
      applicable: true,
      refusals: [],
    });
  });

  it("refuses malformed contexts and non-finite measurement quality", () => {
    const malformed = assessModelApplicability(clonePack(), {
      ...applicableContext(),
      activeConditionCodes: null,
    } as unknown as ModelEvaluationContext);
    expect(malformed.refusals).toContainEqual(
      expect.objectContaining({ code: "invalid_evaluation_context" }),
    );

    const context = applicableContext();
    context.inputs.rpm.sourceReference = "";
    context.inputs.rpm.measurementQuality = {
      ...quality,
      missingFraction: Number.NaN,
    };
    const assessed = assessModelApplicability(clonePack(), context);
    expect(assessed.refusals.map((refusal) => refusal.code)).toEqual(
      expect.arrayContaining([
        "evidence_metadata_missing",
        "measurement_quality_insufficient",
      ]),
    );
  });

  it("catches semantic producer/consumer mismatches even when units match", () => {
    const output = clonePack().ports.find(
      (port) =>
        port.code === "shaft_frequency_hz" && port.direction === "output",
    )!;
    const input = {
      ...output,
      direction: "input" as const,
      basis: "instantaneous peak",
    };
    const result = checkModelPortCompatibility(output, input);
    expect(result.compatible).toBe(false);
    expect(
      result.refusals.some((refusal) => refusal.message.includes("basis")),
    ).toBe(true);
  });

  it("rejects a dependency that includes a boundary excluded by the consumer", () => {
    const producer = clonePack().ports.find(
      (port) =>
        port.code === "shaft_frequency_hz" && port.direction === "output",
    )!;
    const consumer = {
      ...producer,
      direction: "input" as const,
      validRange: { min: 0, minInclusive: false },
    };
    expect(checkModelPortCompatibility(producer, consumer).compatible).toBe(
      false,
    );
  });

  it("refuses an unbounded producer when the consumer requires a bounded port", () => {
    const output = clonePack().ports.find(
      (port) =>
        port.code === "shaft_frequency_hz" && port.direction === "output",
    )!;
    const producer = { ...output, validRange: undefined };
    const consumer = {
      ...output,
      direction: "input" as const,
      validRange: { min: 0, max: 100, minInclusive: false },
    };
    expect(checkModelPortCompatibility(producer, consumer).compatible).toBe(
      false,
    );
  });

  it("requires every promotion rung and blocks production without validation, competency, evidence, or cleared debt", () => {
    const evidence: ModelPromotionEvidence = {
      verificationResults: [],
      evidenceRequirementKeys: [],
      benchValidationEvidenceIds: [],
      fieldValidationEvidenceIds: [],
      blockingDebtCount: 1,
      reviewerUserId: "reviewer",
      authorUserId: "author",
      reviewerCompetencies: [],
      applicabilityMachineReadable: false,
    };
    const skipped = assessModelPromotion(
      clonePack(),
      "draft",
      "production_eligible",
      evidence,
    );
    expect(skipped.allowed).toBe(false);
    expect(skipped.refusals.map((refusal) => refusal.code)).toEqual(
      expect.arrayContaining([
        "invalid_lifecycle_transition",
        "verification_check_not_passed",
        "bench_validation_missing",
        "field_validation_missing",
        "reviewer_competency_missing",
        "blocking_verification_debt",
        "applicability_not_machine_readable",
        "production_evidence_missing",
      ]),
    );
  });

  it("computes downstream impact and rejects a dependency cycle", () => {
    const edges = [
      { producerModelKey: "load", consumerModelKey: "stress" },
      { producerModelKey: "stress", consumerModelKey: "damage" },
      { producerModelKey: "damage", consumerModelKey: "rul" },
    ];
    expect(downstreamModelKeys("load", edges)).toEqual([
      "stress",
      "damage",
      "rul",
    ]);
    expect(() =>
      downstreamModelKeys("load", [
        ...edges,
        { producerModelKey: "rul", consumerModelKey: "load" },
      ]),
    ).toThrow(/cycle/);
  });
});

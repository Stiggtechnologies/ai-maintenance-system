import type { EvidenceReference, ReviewState } from "./types";

export type PhysicsDomain =
  | "rotating_machinery"
  | "bearing_kinematics"
  | "gear_mesh"
  | "hydraulics"
  | "pneumatics"
  | "thermal"
  | "structural"
  | "tribology"
  | "electrical_machines"
  | "fluid_flow"
  | "rope_mechanics"
  | "material_handling";

export type PhysicsCalculationKind =
  | "deterministic_calculation"
  | "constraint_check"
  | "diagnostic_feature";

export interface PhysicsVariableDefinition {
  code: string;
  name: string;
  unit: string;
  description: string;
  required: boolean;
}

export interface PhysicsCalculationDefinition {
  code: string;
  name: string;
  kind: PhysicsCalculationKind;
  description: string;
  inputCodes: string[];
  outputCodes: string[];
  assumptions: string[];
  formulaReference: string;
}

export interface PhysicsCapabilityGovernance {
  reviewState: ReviewState;
  engineeringApprovalRequired: true;
  customerOverridesRequireApproval: true;
  autonomousOperationalActionAllowed: false;
  thresholdsPolicy: "approved_source_only";
  intendedUse: "engineering_decision_support";
}

export interface PhysicsCapabilityDefinition {
  schemaVersion: string;
  code: string;
  name: string;
  domain: PhysicsDomain;
  description: string;
  applicableAssetFamilies: string[];
  applicableSharedComponentCategories: string[];
  inputs: PhysicsVariableDefinition[];
  outputs: PhysicsVariableDefinition[];
  calculations: PhysicsCalculationDefinition[];
  evidence: EvidenceReference[];
  governance: PhysicsCapabilityGovernance;
}

export interface PhysicsCapabilityValidationIssue {
  path: string;
  message: string;
}

export function validatePhysicsCapabilityLibrary(
  capabilities: PhysicsCapabilityDefinition[],
): PhysicsCapabilityValidationIssue[] {
  const issues: PhysicsCapabilityValidationIssue[] = [];
  const capabilityCodes = new Set<string>();

  for (const [capabilityIndex, capability] of capabilities.entries()) {
    const path = `capabilities[${capabilityIndex}]`;
    if (!capability.code.trim()) {
      issues.push({ path: `${path}.code`, message: "Physics capability code is required." });
    }
    if (capabilityCodes.has(capability.code)) {
      issues.push({ path: `${path}.code`, message: `Duplicate physics capability code ${capability.code}.` });
    }
    capabilityCodes.add(capability.code);

    if (!capability.name.trim()) {
      issues.push({ path: `${path}.name`, message: "Physics capability name is required." });
    }
    if (capability.calculations.length === 0) {
      issues.push({ path: `${path}.calculations`, message: "At least one governed calculation is required." });
    }
    if (capability.governance.engineeringApprovalRequired !== true) {
      issues.push({
        path: `${path}.governance.engineeringApprovalRequired`,
        message: "Engineering approval must remain required.",
      });
    }
    if (capability.governance.autonomousOperationalActionAllowed !== false) {
      issues.push({
        path: `${path}.governance.autonomousOperationalActionAllowed`,
        message: "Autonomous operational action must remain prohibited.",
      });
    }
    if (capability.governance.thresholdsPolicy !== "approved_source_only") {
      issues.push({
        path: `${path}.governance.thresholdsPolicy`,
        message: "Thresholds must remain approved-source-only.",
      });
    }
    if (capability.governance.reviewState === "approved" && capability.evidence.length === 0) {
      issues.push({
        path: `${path}.evidence`,
        message: "Approved physics capabilities require supporting evidence.",
      });
    }

    const inputCodes = new Set<string>();
    for (const [inputIndex, input] of capability.inputs.entries()) {
      const inputPath = `${path}.inputs[${inputIndex}]`;
      if (!input.code.trim()) issues.push({ path: `${inputPath}.code`, message: "Input code is required." });
      if (inputCodes.has(input.code)) {
        issues.push({ path: `${inputPath}.code`, message: `Duplicate input code ${input.code}.` });
      }
      inputCodes.add(input.code);
      if (!input.unit.trim()) issues.push({ path: `${inputPath}.unit`, message: "Input unit is required." });
    }

    const outputCodes = new Set<string>();
    for (const [outputIndex, output] of capability.outputs.entries()) {
      const outputPath = `${path}.outputs[${outputIndex}]`;
      if (!output.code.trim()) issues.push({ path: `${outputPath}.code`, message: "Output code is required." });
      if (outputCodes.has(output.code)) {
        issues.push({ path: `${outputPath}.code`, message: `Duplicate output code ${output.code}.` });
      }
      outputCodes.add(output.code);
      if (!output.unit.trim()) issues.push({ path: `${outputPath}.unit`, message: "Output unit is required." });
    }

    const calculationCodes = new Set<string>();
    for (const [calculationIndex, calculation] of capability.calculations.entries()) {
      const calculationPath = `${path}.calculations[${calculationIndex}]`;
      if (!calculation.code.trim()) {
        issues.push({ path: `${calculationPath}.code`, message: "Calculation code is required." });
      }
      if (calculationCodes.has(calculation.code)) {
        issues.push({
          path: `${calculationPath}.code`,
          message: `Duplicate calculation code ${calculation.code}.`,
        });
      }
      calculationCodes.add(calculation.code);
      if (!calculation.formulaReference.trim()) {
        issues.push({
          path: `${calculationPath}.formulaReference`,
          message: "A formula reference or derivation identifier is required.",
        });
      }
      for (const [inputIndex, inputCode] of calculation.inputCodes.entries()) {
        if (!inputCodes.has(inputCode)) {
          issues.push({
            path: `${calculationPath}.inputCodes[${inputIndex}]`,
            message: `Unknown physics input ${inputCode}.`,
          });
        }
      }
      for (const [outputIndex, outputCode] of calculation.outputCodes.entries()) {
        if (!outputCodes.has(outputCode)) {
          issues.push({
            path: `${calculationPath}.outputCodes[${outputIndex}]`,
            message: `Unknown physics output ${outputCode}.`,
          });
        }
      }
    }
  }

  return issues;
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new Error(`${name} must be non-negative.`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new Error(`${name} must be greater than zero.`);
}

export function rpmToHertz(rpm: number): number {
  assertNonNegative(rpm, "rpm");
  return rpm / 60;
}

export function rpmToAngularVelocityRadPerSecond(rpm: number): number {
  return rpmToHertz(rpm) * 2 * Math.PI;
}

export interface RotationalSurfaceSpeedInput {
  diameterM: number;
  rpm: number;
}

export function calculateRotationalSurfaceSpeedMps(input: RotationalSurfaceSpeedInput): number {
  assertPositive(input.diameterM, "diameterM");
  return Math.PI * input.diameterM * rpmToHertz(input.rpm);
}

export interface RotationalKineticEnergyInput {
  inertiaKgM2: number;
  rpm: number;
}

export function calculateRotationalKineticEnergyJ(input: RotationalKineticEnergyInput): number {
  assertNonNegative(input.inertiaKgM2, "inertiaKgM2");
  const angularVelocity = rpmToAngularVelocityRadPerSecond(input.rpm);
  return 0.5 * input.inertiaKgM2 * angularVelocity ** 2;
}

export interface BearingCharacteristicFrequencyInput {
  rpm: number;
  rollingElementCount: number;
  rollingElementDiameterMm: number;
  pitchDiameterMm: number;
  contactAngleDegrees: number;
}

export interface BearingCharacteristicFrequencies {
  shaftFrequencyHz: number;
  fundamentalTrainFrequencyHz: number;
  ballPassFrequencyOuterHz: number;
  ballPassFrequencyInnerHz: number;
  ballSpinFrequencyHz: number;
}

/**
 * Calculates idealized rolling-element bearing kinematic frequencies.
 *
 * These are geometry-based reference frequencies, not alarm limits. Real observed
 * frequencies can shift with slip, load, geometry variation, and measurement error.
 */
export function calculateBearingCharacteristicFrequencies(
  input: BearingCharacteristicFrequencyInput,
): BearingCharacteristicFrequencies {
  assertNonNegative(input.rpm, "rpm");
  if (!Number.isInteger(input.rollingElementCount) || input.rollingElementCount < 1) {
    throw new Error("rollingElementCount must be a positive integer.");
  }
  assertPositive(input.rollingElementDiameterMm, "rollingElementDiameterMm");
  assertPositive(input.pitchDiameterMm, "pitchDiameterMm");
  if (input.rollingElementDiameterMm >= input.pitchDiameterMm) {
    throw new Error("rollingElementDiameterMm must be less than pitchDiameterMm.");
  }
  assertFinite(input.contactAngleDegrees, "contactAngleDegrees");
  if (input.contactAngleDegrees < 0 || input.contactAngleDegrees > 90) {
    throw new Error("contactAngleDegrees must be between 0 and 90 degrees.");
  }

  const shaftFrequencyHz = rpmToHertz(input.rpm);
  const contactAngleRadians = (input.contactAngleDegrees * Math.PI) / 180;
  const diameterRatio = input.rollingElementDiameterMm / input.pitchDiameterMm;
  const geometryFactor = diameterRatio * Math.cos(contactAngleRadians);

  return {
    shaftFrequencyHz,
    fundamentalTrainFrequencyHz: 0.5 * shaftFrequencyHz * (1 - geometryFactor),
    ballPassFrequencyOuterHz:
      0.5 * input.rollingElementCount * shaftFrequencyHz * (1 - geometryFactor),
    ballPassFrequencyInnerHz:
      0.5 * input.rollingElementCount * shaftFrequencyHz * (1 + geometryFactor),
    ballSpinFrequencyHz:
      0.5 *
      (input.pitchDiameterMm / input.rollingElementDiameterMm) *
      shaftFrequencyHz *
      (1 - geometryFactor ** 2),
  };
}

import { describe, expect, it } from "vitest";
import {
  calculateBearingCharacteristicFrequencies,
  calculateRotationalKineticEnergyJ,
  calculateRotationalSurfaceSpeedMps,
  rpmToAngularVelocityRadPerSecond,
  rpmToHertz,
  type PhysicsCapabilityDefinition,
  validatePhysicsCapabilityLibrary,
} from "./physics-capability";
import {
  bearingKinematicsPhysicsCapability,
  getPhysicsCapability,
  physicsCapabilityLibrary,
  rotatingMachineryPhysicsCapability,
} from "./physics-capability-library";

describe("physics capability library", () => {
  it("keeps the governed registry valid and unique", () => {
    expect(validatePhysicsCapabilityLibrary(physicsCapabilityLibrary)).toEqual([]);
    expect(new Set(physicsCapabilityLibrary.map((capability) => capability.code)).size).toBe(
      physicsCapabilityLibrary.length,
    );
    expect(getPhysicsCapability(rotatingMachineryPhysicsCapability.code)).toBe(
      rotatingMachineryPhysicsCapability,
    );
    expect(getPhysicsCapability(bearingKinematicsPhysicsCapability.code)).toBe(
      bearingKinematicsPhysicsCapability,
    );
  });

  it("performs deterministic rotational calculations", () => {
    expect(rpmToHertz(1200)).toBe(20);
    expect(rpmToAngularVelocityRadPerSecond(1200)).toBeCloseTo(40 * Math.PI, 10);
    expect(calculateRotationalSurfaceSpeedMps({ diameterM: 0.5, rpm: 60 })).toBeCloseTo(
      0.5 * Math.PI,
      10,
    );
    expect(calculateRotationalKineticEnergyJ({ inertiaKgM2: 2, rpm: 60 })).toBeCloseTo(
      4 * Math.PI ** 2,
      10,
    );
  });

  it("calculates idealized rolling-element bearing characteristic frequencies", () => {
    const frequencies = calculateBearingCharacteristicFrequencies({
      rpm: 1200,
      rollingElementCount: 8,
      rollingElementDiameterMm: 10,
      pitchDiameterMm: 50,
      contactAngleDegrees: 0,
    });

    expect(frequencies.shaftFrequencyHz).toBeCloseTo(20, 10);
    expect(frequencies.fundamentalTrainFrequencyHz).toBeCloseTo(8, 10);
    expect(frequencies.ballPassFrequencyOuterHz).toBeCloseTo(64, 10);
    expect(frequencies.ballPassFrequencyInnerHz).toBeCloseTo(96, 10);
    expect(frequencies.ballSpinFrequencyHz).toBeCloseTo(48, 10);
  });

  it("rejects invalid physical inputs", () => {
    expect(() => rpmToHertz(-1)).toThrow("rpm must be non-negative");
    expect(() => calculateRotationalSurfaceSpeedMps({ diameterM: 0, rpm: 60 })).toThrow(
      "diameterM must be greater than zero",
    );
    expect(() =>
      calculateBearingCharacteristicFrequencies({
        rpm: 1200,
        rollingElementCount: 0,
        rollingElementDiameterMm: 10,
        pitchDiameterMm: 50,
        contactAngleDegrees: 0,
      }),
    ).toThrow("rollingElementCount must be a positive integer");
    expect(() =>
      calculateBearingCharacteristicFrequencies({
        rpm: 1200,
        rollingElementCount: 8,
        rollingElementDiameterMm: 50,
        pitchDiameterMm: 50,
        contactAngleDegrees: 0,
      }),
    ).toThrow("rollingElementDiameterMm must be less than pitchDiameterMm");
  });

  it("rejects duplicate capabilities and broken calculation references", () => {
    const brokenReference: PhysicsCapabilityDefinition = {
      ...rotatingMachineryPhysicsCapability,
      code: "PHYS-ROT-BROKEN",
      calculations: [
        {
          ...rotatingMachineryPhysicsCapability.calculations[0],
          code: "ROT-BROKEN-INPUT",
          inputCodes: ["unknown_input"],
        },
      ],
    };

    const duplicateIssues = validatePhysicsCapabilityLibrary([
      rotatingMachineryPhysicsCapability,
      rotatingMachineryPhysicsCapability,
    ]);
    const referenceIssues = validatePhysicsCapabilityLibrary([brokenReference]);

    expect(duplicateIssues.some((issue) => issue.message.includes("Duplicate physics capability"))).toBe(
      true,
    );
    expect(referenceIssues.some((issue) => issue.message.includes("Unknown physics input"))).toBe(true);
  });

  it("requires evidence before a physics capability can be approved", () => {
    const approvedWithoutEvidence: PhysicsCapabilityDefinition = {
      ...rotatingMachineryPhysicsCapability,
      code: "PHYS-ROT-UNSUPPORTED-APPROVAL",
      evidence: [],
      governance: {
        ...rotatingMachineryPhysicsCapability.governance,
        reviewState: "approved",
      },
    };

    expect(
      validatePhysicsCapabilityLibrary([approvedWithoutEvidence]).some((issue) =>
        issue.message.includes("Approved physics capabilities require supporting evidence"),
      ),
    ).toBe(true);
  });
});

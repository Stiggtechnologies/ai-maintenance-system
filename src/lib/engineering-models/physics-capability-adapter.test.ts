import { describe, expect, it } from "vitest";
import { validatePhysicsCapabilityLibrary } from "../asset-twins/physics-capability";
import { toPhysicsCapabilityDefinition } from "./physics-capability-adapter";
import { shaftResonanceModelPack } from "./resonance";

describe("engineering-model asset-twin capability adapter", () => {
  it("feeds the existing governed physics definition without duplicating evidence", () => {
    const capability = toPhysicsCapabilityDefinition(shaftResonanceModelPack);
    expect(validatePhysicsCapabilityLibrary([capability])).toEqual([]);
    expect(capability).toMatchObject({
      code: "MODEL:pof.shaft-resonance.screening@1.0.0",
      domain: "rotating_machinery",
      evidence: [],
      governance: {
        reviewState: "draft",
        engineeringApprovalRequired: true,
        autonomousOperationalActionAllowed: false,
      },
    });
    expect(capability.inputs.map((input) => input.code)).toContain("rpm");
    expect(capability.outputs.map((output) => output.code)).toContain(
      "natural_frequency_hz",
    );
  });

  it("refuses an engineering domain the asset-twin contract cannot represent", () => {
    expect(() =>
      toPhysicsCapabilityDefinition({
        ...shaftResonanceModelPack,
        domain: "unmapped_quantum_domain",
      }),
    ).toThrow(/not an asset-twin physics domain/);
  });
});

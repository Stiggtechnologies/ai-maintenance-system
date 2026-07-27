import { describe, expect, it } from "vitest";
import {
  electricRopeShovelTemplate,
  getAssetClassTemplate,
  miningAssetClassLibrary,
  validateAssetClassTemplate,
} from ".";

describe("mining asset twin library", () => {
  it("contains unique asset class codes", () => {
    const codes = miningAssetClassLibrary.map((template) => template.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("ships a complete canonical electric rope shovel subsystem hierarchy", () => {
    const componentCodes = electricRopeShovelTemplate.components.map((component) => component.code);

    expect(componentCodes).toEqual(
      expect.arrayContaining([
        "ERS-STRUCT",
        "ERS-HOIST",
        "ERS-CROWD",
        "ERS-SWING",
        "ERS-ELEC",
        "ERS-LUBE",
        "ERS-DIPPER",
        "ERS-PROPEL",
        "ERS-BRAKE",
        "ERS-COOL",
        "ERS-CONTROL",
      ]),
    );
    expect(new Set(componentCodes).size).toBe(componentCodes.length);
    expect(validateAssetClassTemplate(electricRopeShovelTemplate)).toEqual([]);
  });

  it("keeps every failure mode assigned to its canonical component", () => {
    for (const component of electricRopeShovelTemplate.components) {
      expect(component.failureModes.every((failure) => failure.componentCode === component.code)).toBe(true);
    }
  });

  it("resolves templates by canonical code", () => {
    expect(getAssetClassTemplate("MIN-LOAD-ERS")?.name).toBe("Electric rope shovel");
    expect(getAssetClassTemplate("UNKNOWN")).toBeUndefined();
  });
});

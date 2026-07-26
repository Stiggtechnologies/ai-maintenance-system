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

  it("ships a detailed electric rope shovel template", () => {
    expect(electricRopeShovelTemplate.components.length).toBeGreaterThanOrEqual(6);
    expect(validateAssetClassTemplate(electricRopeShovelTemplate)).toEqual([]);
  });

  it("resolves templates by canonical code", () => {
    expect(getAssetClassTemplate("MIN-LOAD-ERS")?.name).toBe("Electric rope shovel");
    expect(getAssetClassTemplate("UNKNOWN")).toBeUndefined();
  });
});

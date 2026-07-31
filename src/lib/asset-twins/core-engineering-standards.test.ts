import { describe, expect, it } from "vitest";
import {
  getEngineeringStandard,
  getEngineeringStandardsByCategory,
  validateEngineeringStandardsLibrary,
} from "./core-engineering-standards";
import { coreEngineeringStandardsLibrary } from "./core-engineering-standards-library";

describe("core engineering standards", () => {
  it("validates the governed canonical library", () => {
    expect(validateEngineeringStandardsLibrary(coreEngineeringStandardsLibrary)).toEqual([]);
  });

  it("keeps codes unique and retrievable", () => {
    const codes = coreEngineeringStandardsLibrary.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(getEngineeringStandard(coreEngineeringStandardsLibrary, "FM-FATIGUE")?.name).toBe("Fatigue");
  });

  it("supports category lookups", () => {
    const detectionMethods = getEngineeringStandardsByCategory(
      coreEngineeringStandardsLibrary,
      "detection_method",
    );
    expect(detectionMethods.length).toBeGreaterThan(0);
    expect(detectionMethods.every((entry) => entry.category === "detection_method")).toBe(true);
  });

  it("prohibits autonomous operational action and unsupported sources", () => {
    expect(
      coreEngineeringStandardsLibrary.every(
        (entry) =>
          entry.permitsAutonomousOperationalAction === false &&
          entry.sourcePolicy === "approved_source_required",
      ),
    ).toBe(true);
  });

  it("detects duplicate and unsafe entries", () => {
    const unsafe = {
      ...coreEngineeringStandardsLibrary[0],
      sourcePolicy: "uncontrolled" as never,
      permitsAutonomousOperationalAction: true as never,
    };
    const issues = validateEngineeringStandardsLibrary([
      coreEngineeringStandardsLibrary[0],
      unsafe,
    ]);
    expect(issues.some((issue) => issue.message.includes("Duplicate code"))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith("sourcePolicy"))).toBe(true);
    expect(issues.some((issue) => issue.path.endsWith("permitsAutonomousOperationalAction"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  ALBERTA_LIFE_SAFETY_REFERENCE_NODES,
  ALBERTA_LIFE_SAFETY_REQUIREMENTS,
  albertaLifeSafetyDrafts,
  albertaLifeSafetyRecords,
} from "./alberta-life-safety-requirements";
import { apartmentBuildingReferenceModel } from "./asset-twins/apartment-building-reference-model";
import { residentialDwellingReferenceModel } from "./asset-twins/residential-dwelling-reference-model";

const noNumericLimit =
  /\d+\s?(%|°|deg|kpa|psi|bar|volts?|ppm|lux|hours?|hrs|minutes?|seconds?|days?|weeks?|months?|years?|annual|monthly|weekly|daily)\b|\b(annual|annually|monthly|weekly|daily|quarterly|semi-annual)\b/i;

describe("Alberta housing life-safety template", () => {
  it("covers alarms, fire alarm, extinguishers, emergency lighting, sprinklers, parkade gas and rental minimums", () => {
    expect(ALBERTA_LIFE_SAFETY_REQUIREMENTS.map((r) => r.key)).toEqual([
      "smoke_alarm_operational",
      "co_alarm_operational",
      "fire_alarm_inspection_testing",
      "extinguisher_inspection",
      "emergency_lighting_testing",
      "sprinkler_inspection",
      "parkade_gas_detection_operational",
      "rental_unit_minimum_standards",
    ]);
  });

  it("passes the same validation the server applies", () => {
    const records = albertaLifeSafetyRecords();
    expect(records).toHaveLength(ALBERTA_LIFE_SAFETY_REQUIREMENTS.length);
    for (const r of records) {
      expect(r.key).toMatch(/^[a-z][a-z0-9_]{2,79}$/);
      expect(r.applicability_basis.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("asserts nothing: undetermined, advisory, no mandatory basis, clause left to a named reviewer", () => {
    for (const r of ALBERTA_LIFE_SAFETY_REQUIREMENTS) {
      expect(r.applicability, r.key).toBe("undetermined");
      expect(r.obligation, r.key).toBe("advisory");
      expect(r.mandatoryBasis).toBe("");
      expect(r.authorityReference).toMatch(/clause to be cited by reviewer/);
    }
  });

  it("states no interval, frequency or limit", () => {
    expect(JSON.stringify(ALBERTA_LIFE_SAFETY_REQUIREMENTS)).not.toMatch(
      noNumericLimit,
    );
  });

  it("points each requirement at reference-model nodes that exist", () => {
    const codes = new Set(
      [
        ...apartmentBuildingReferenceModel.nodes,
        ...residentialDwellingReferenceModel.nodes,
      ].map((n) => n.code),
    );
    for (const r of ALBERTA_LIFE_SAFETY_REQUIREMENTS) {
      const nodes = ALBERTA_LIFE_SAFETY_REFERENCE_NODES[r.key];
      expect(nodes, r.key).toBeDefined();
      for (const code of nodes) expect(codes.has(code), code).toBe(true);
    }
  });

  it("hands out independent copies", () => {
    const a = albertaLifeSafetyDrafts();
    a[0].applicability = "applicable";
    expect(ALBERTA_LIFE_SAFETY_REQUIREMENTS[0].applicability).toBe(
      "undetermined",
    );
  });
});

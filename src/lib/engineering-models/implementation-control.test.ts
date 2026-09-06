import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ENGINEERING_MODEL_REQUIREMENT_CONTROLS,
  ENGINEERING_MODEL_SOURCE_CONTROL,
} from "./implementation-control";

describe("engineering model implementation control", () => {
  it("pins the complete source discussion that was implemented", () => {
    expect(ENGINEERING_MODEL_SOURCE_CONTROL).toEqual({
      lineCount: 1109,
      byteCount: 53436,
      sha256:
        "7e5220417ca293674e4500671472e94ad8b2fac2832b235010f1fb61be11fb40",
    });
  });

  it("keeps every requirement implemented, uniquely identified and traceable", () => {
    expect(ENGINEERING_MODEL_REQUIREMENT_CONTROLS).toHaveLength(55);
    expect(
      new Set(ENGINEERING_MODEL_REQUIREMENT_CONTROLS.map((item) => item.id))
        .size,
    ).toBe(55);
    for (const item of ENGINEERING_MODEL_REQUIREMENT_CONTROLS) {
      expect(item.status, item.id).toBe("implemented");
      expect(
        item.implementationRefs.length,
        `${item.id} implementation refs`,
      ).toBeGreaterThan(0);
      expect(
        item.verificationRefs.length,
        `${item.id} verification refs`,
      ).toBeGreaterThan(0);
      for (const path of [
        ...item.implementationRefs,
        ...item.verificationRefs,
      ]) {
        expect(
          existsSync(path),
          `${item.id} missing traceability file ${path}`,
        ).toBe(true);
      }
    }
  });

  it("covers every control family from the discussion", () => {
    const categories = new Set(
      ENGINEERING_MODEL_REQUIREMENT_CONTROLS.map((item) => item.category),
    );
    for (const category of [
      "boundary",
      "artifacts",
      "registry",
      "governance",
      "runtime",
      "provenance",
      "verification",
      "reproducibility",
      "semantics",
      "dependencies",
      "applicability",
      "configuration",
      "measurement",
      "fmmea",
      "pof",
      "stress-history",
      "damage",
      "interactions",
      "state-estimation",
      "ram",
      "calibration",
      "uncertainty",
      "decisions",
      "inspection",
      "intervention",
      "escalation",
      "rul",
      "arbitration",
      "rca",
      "learning",
      "retirement",
      "product",
      "traceability",
      "evidence",
      "competency",
      "sources",
      "chemistry",
      "domains",
      "pilot",
      "closed-loop",
    ]) {
      expect(
        categories.has(category),
        `missing ${category} control family`,
      ).toBe(true);
    }
  });
});

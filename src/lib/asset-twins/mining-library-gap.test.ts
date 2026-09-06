import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { conveyorSystemTemplate } from "./conveyor-system";
import { draglineTemplate } from "./dragline";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";
import {
  getAssetClassTemplate,
  miningAssetClassLibrary,
  validateAssetClassTemplate,
} from "./index";
import { electricRopeShovelTemplate } from "./mining-library";
import { primaryCrusherTemplate } from "./primary-crusher";
import { stackerReclaimerTemplate } from "./stacker-reclaimer";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";
import type { AssetClassTemplate } from "./types";

/**
 * Issue #67 required mining classes versus what the TypeScript library
 * actually ships. This is an inventory, not a production-approval claim.
 */
const requiredIssue67Classes: Array<{
  issueName: string;
  code: string;
  template: AssetClassTemplate;
}> = [
  {
    issueName: "electric rope shovel",
    code: "MIN-LOAD-ERS",
    template: electricRopeShovelTemplate,
  },
  {
    issueName: "haul truck",
    code: "MIN-HAUL-TRUCK",
    template: ultraClassHaulTruckTemplate,
  },
  {
    issueName: "hydraulic shovel/excavator",
    code: "MIN-HYD-SHOVEL",
    template: hydraulicMiningShovelTemplate,
  },
  {
    issueName: "dragline",
    code: "MIN-DRAGLINE",
    template: draglineTemplate,
  },
  {
    issueName: "conveyor",
    code: "FP-CONVEYOR-BELT",
    template: conveyorSystemTemplate,
  },
  {
    issueName: "crusher",
    code: "MIN-CRUSH-PRI",
    template: primaryCrusherTemplate,
  },
  {
    issueName: "stacker/reclaimer",
    code: "MIN-STACK-RECLAIM",
    template: stackerReclaimerTemplate,
  },
];

const retiredParallelStarterCodes = [
  "MIN-LOAD-HMS",
  "MIN-LOAD-WL",
  "MIN-CONV",
];

describe("issue #67 mining library gap matrix", () => {
  it("ships a production-shaped draft template for every required class", () => {
    for (const required of requiredIssue67Classes) {
      expect(required.template.code).toBe(required.code);
      expect(required.template.reviewState).toBe("draft");
      expect(required.template.components.length).toBeGreaterThan(0);
      expect(
        required.template.components.some(
          (component) => (component.sharedComponentDnaCodes ?? []).length > 0,
        ),
      ).toBe(true);
      expect(validateAssetClassTemplate(required.template)).toEqual([]);
      expect(getAssetClassTemplate(required.code)).toBe(required.template);
    }
  });

  it("does not keep empty starter shells as a second hierarchy for populated classes", () => {
    const libraryCodes = miningAssetClassLibrary.map((template) => template.code);
    expect(new Set(libraryCodes).size).toBe(libraryCodes.length);
    for (const retired of retiredParallelStarterCodes) {
      expect(libraryCodes).not.toContain(retired);
      expect(getAssetClassTemplate(retired)).toBeUndefined();
    }
    expect(getAssetClassTemplate("MIN-HYD-SHOVEL")).toBe(
      hydraulicMiningShovelTemplate,
    );
    expect(getAssetClassTemplate("FP-CONVEYOR-BELT")).toBe(
      conveyorSystemTemplate,
    );
  });

  it("keeps remaining catalogue shells honest and distinct from the required seven", () => {
    const shells = miningAssetClassLibrary.filter(
      (template) => template.components.length === 0,
    );
    expect(shells.map((template) => template.code).sort()).toEqual([
      "MIN-DOZER",
      "MIN-GRADER",
      "MIN-MOBILE-CRUSH",
    ]);
    for (const shell of shells) {
      expect(shell.reviewState).toBe("draft");
      expect(shell.description).toMatch(/requires evidence/i);
    }
  });

  it("compiles each required class deterministically without inventing a second schema", () => {
    const compiledCodes = requiredIssue67Classes.map((required) => {
      const first = compileAssetTwin(
        required.template,
        {
          assetId: `${required.code}-A`,
          assetClassCode: required.code,
          siteId: "MINE-1",
          operatingContext: {},
          telemetryMap: {},
          customerOverrides: {},
          baselineStatus: "not_started",
        },
        undefined,
        new Date("2026-09-06T12:00:00.000Z"),
      );
      const second = compileAssetTwin(
        required.template,
        {
          assetId: `${required.code}-A`,
          assetClassCode: required.code,
          siteId: "MINE-1",
          operatingContext: {},
          telemetryMap: {},
          customerOverrides: {},
          baselineStatus: "not_started",
        },
        undefined,
        new Date("2026-09-06T12:00:00.000Z"),
      );
      expect(first).toEqual(second);
      expect(first.schemaVersion).toBe(required.template.schemaVersion);
      return first.provenance.assetClassCode;
    });

    expect(new Set(compiledCodes).size).toBe(requiredIssue67Classes.length);
  });
});

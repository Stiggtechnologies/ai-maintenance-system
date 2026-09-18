import { describe, expect, it } from "vitest";
import {
  INDUSTRY_CATALOG,
  getIndustryCatalogEntry,
  getIndustryLabel,
  normalizeIndustryCode,
  toStoredIndustryCode,
} from "./industry-catalog";
import { INDUSTRY_PROFILES } from "./industry-profiles";
import { INDUSTRY_TEMPLATE_PACKS } from "./industry-template-packs";
import {
  getIndustryRiskFocus,
  getRiskIndustryPackCatalog,
} from "./risk-operating-system";

describe("canonical industry catalog", () => {
  it("covers every existing template and executable profile exactly once", () => {
    const catalogCodes = INDUSTRY_CATALOG.map((entry) => entry.code);
    expect(new Set(catalogCodes).size).toBe(catalogCodes.length);

    for (const code of Object.keys(INDUSTRY_TEMPLATE_PACKS)) {
      expect(catalogCodes).toContain(code);
    }
    for (const profile of INDUSTRY_PROFILES) {
      expect(catalogCodes).toContain(profile.industryCode);
    }
  });

  it("exposes all packs plus a custom organization-defined option", () => {
    const riskCatalog = getRiskIndustryPackCatalog();
    expect(riskCatalog).toHaveLength(20);
    expect(riskCatalog.at(-1)).toMatchObject({
      industryCode: "custom",
      readiness: "custom",
    });
  });

  it("distinguishes executable bindings, template guidance, and focus drafts", () => {
    expect(getIndustryRiskFocus("oil_sands")).toMatchObject({
      readiness: "kernel_bound",
      validationStatus: "draft",
      focusSource: "template_guidance",
    });
    // Aviation was the template_only exemplar. It now carries both reusable
    // failure-context bindings and the governed airworthiness/MSG-3/LLP module,
    // while content remains draft until authorized review.
    expect(getIndustryRiskFocus("aviation")).toMatchObject({
      readiness: "kernel_bound",
      validationStatus: "draft",
    });
    expect(getIndustryRiskFocus("aviation")?.domainModules[0].methods).toEqual([
      "airworthiness-compliance",
      "msg3-trace",
      "life-limited-part",
    ]);
    // template_only is now unreachable by construction: every pack has a profile
    // and industry-profiles.test.ts fails if one is added without. The state stays
    // in the union deliberately — it is what a newly added pack would report for
    // the moment before its profile lands, and the guard turns that into a red
    // test rather than a silent claim of coverage.
    expect(
      getRiskIndustryPackCatalog().filter(
        (p) => p.readiness === "template_only",
      ),
    ).toEqual([]);
    expect(getIndustryRiskFocus("buildings_infrastructure")).toMatchObject({
      readiness: "kernel_bound",
      validationStatus: "draft",
      focusSource: "curated",
    });
  });

  it("preserves a bounded custom label without pretending it is a pack", () => {
    const stored = toStoredIndustryCode(
      "custom",
      `  Renewable   district energy ${"x".repeat(140)}  `,
    );
    expect(stored.startsWith("custom:Renewable district energy")).toBe(true);
    expect(stored.slice("custom:".length)).toHaveLength(120);
    expect(getIndustryCatalogEntry(stored)?.code).toBe("custom");
    expect(getIndustryLabel("custom:Renewable district energy")).toBe(
      "Renewable district energy (Custom)",
    );
  });

  it("normalizes legacy identifiers without splitting the catalog", () => {
    expect(normalizeIndustryCode("oil-gas")).toBe("oil_gas");
    expect(getIndustryCatalogEntry("data-centers")?.code).toBe("data_centers");
    expect(getIndustryLabel("military")).toBe("Defense");
    expect(toStoredIndustryCode("power", "")).toBe("power_generation");
    expect(toStoredIndustryCode("bess", "")).toBe("battery_energy_storage");
    expect(toStoredIndustryCode("other", "District energy")).toBe(
      "custom:District energy",
    );
  });

  it("does not silently map unknown industry identities", () => {
    expect(getIndustryCatalogEntry("unknown-sector")).toBeNull();
    expect(getIndustryRiskFocus("unknown-sector")).toBeNull();
  });
});

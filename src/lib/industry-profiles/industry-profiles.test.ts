import { describe, expect, it } from "vitest";
import {
  assessProfile,
  checkDifferentiation,
  FAILURE_CONTEXTS,
  INDUSTRY_PROFILES,
} from "./index";
import {
  INDUSTRY_TEMPLATE_PACKS,
  listIndustryTemplatePacks,
} from "../industry-template-packs";
import { INDUSTRY_CATALOG } from "../industry-catalog";

describe("the kernel-profile architecture (E1.01)", () => {
  it("binds every profile context to a real failure context", () => {
    // A profile naming a context that does not exist is a wiring error the
    // assessment must surface loudly, so first prove none exist today.
    for (const p of INDUSTRY_PROFILES) {
      const a = assessProfile(p);
      expect(
        a.unknownContexts,
        `${p.industryCode} has unknown contexts`,
      ).toEqual([]);
    }
  });

  it("every profile points at an industry pack that actually exists", () => {
    for (const p of INDUSTRY_PROFILES) {
      expect(
        INDUSTRY_TEMPLATE_PACKS[p.industryCode],
        `profile ${p.industryCode} has no matching pack`,
      ).toBeDefined();
    }
  });

  it("every industry pack has a profile — a pack without one is prose", () => {
    // The gap this closes: five packs (food_beverage, aviation, marine_shipping,
    // defense, aerospace_launch) shipped 2,400 lines of asset classes and risk
    // drivers with NO binding to an engine. They registered as coverage in the
    // signup catalog and computed nothing — the same shell pattern assessProfile
    // exists to kill, one level up. A pack is only a capability once a profile
    // says which failure contexts it contains.
    const profiled = new Set<string>(
      INDUSTRY_PROFILES.map((p) => p.industryCode),
    );
    const unbound = listIndustryTemplatePacks()
      .map((p) => p.industryCode as string)
      .filter((code) => !profiled.has(code));
    expect(unbound, "packs with no profile behind them").toEqual([]);
  });

  it("has a governed pack for every non-custom catalog entry", () => {
    const packed = new Set(
      listIndustryTemplatePacks().map((p) => p.industryCode as string),
    );
    const withoutPack = INDUSTRY_CATALOG.filter(
      (e) => e.kind === "pack" && !packed.has(e.code),
    ).map((e) => e.code);
    expect(withoutPack).toEqual([]);
  });

  it("every failure context binds to at least two engines and names its data", () => {
    for (const c of FAILURE_CONTEXTS) {
      expect(c.engines.length, c.key).toBeGreaterThanOrEqual(2);
      expect(c.requiredData.length, c.key).toBeGreaterThan(0);
    }
  });

  it("reports the RBI domain module as executable without claiming full API 581", () => {
    const petro = assessProfile(
      INDUSTRY_PROFILES.find((p) => p.industryCode === "petrochemical")!,
    );
    expect(petro.domainModules.map((module) => module.key)).toEqual([
      "petrochemical-rbi",
    ]);
    expect(petro.domainModules[0].methods).toContain("rbi-corrosion-loop");
    expect(petro.proseOnly).toEqual([]);
    expect(petro.operationalShare).toBe(1);
  });

  it("counts governed domain modules in operational share", () => {
    const mfg = assessProfile(
      INDUSTRY_PROFILES.find((p) => p.industryCode === "manufacturing")!,
    );
    expect(mfg.domainModules[0].methods).toEqual([
      "line-balancing",
      "robot-health",
    ]);
    expect(mfg.operationalShare).toBe(1);
  });

  it("surfaces a wiring error rather than dropping it", () => {
    const broken = assessProfile({
      industryCode: "oil_sands",
      registerRef: "test",
      contexts: ["process_trip", "context_that_does_not_exist"],
      domainModules: [],
      proseOnly: [],
    });
    expect(broken.unknownContexts).toEqual(["context_that_does_not_exist"]);
    expect(broken.reason).toMatch(/WIRING ERROR/);
  });
});

describe("differentiated risk models per failure context (E1.06)", () => {
  it("a compressor trip and a haul-truck failure get different treatment", () => {
    // The register's own example: compressor trip ≠ haul truck.
    const r = checkDifferentiation("process_trip", "mobile_plant_failure");
    expect(r.differentiated).toBe(true);
    expect(r.differentWorkflow).toBe(true); // safety_investigation vs reliability_analysis
    expect(r.distinctA).toContain("pfd_sil");
    expect(r.distinctB).toContain("censored_weibull");
  });

  it("a weld defect differs from both", () => {
    const vsTrip = checkDifferentiation("quality_loss", "process_trip");
    const vsTruck = checkDifferentiation(
      "quality_loss",
      "mobile_plant_failure",
    );
    expect(vsTrip.differentiated).toBe(true);
    expect(vsTruck.differentiated).toBe(true);
    expect(vsTrip.differentWorkflow).toBe(true);
  });

  it("shared engines are named as legitimate, not hidden", () => {
    // Turnarounds and network outages both use monte_carlo and schedule_risk —
    // the kernel is COMMON by design (E1.01), and the check must say that
    // rather than pretending full disjointness.
    const r = checkDifferentiation("turnaround_execution", "network_outage");
    expect(r.differentiated).toBe(true);
    expect(r.sharedEngines.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/kernel is common by design/);
  });

  it("every pair of contexts is genuinely differentiated", () => {
    // If two contexts collapse to identical engines AND workflow, one of them
    // is decorative and the taxonomy is padding itself.
    for (let i = 0; i < FAILURE_CONTEXTS.length; i++) {
      for (let j = i + 1; j < FAILURE_CONTEXTS.length; j++) {
        const r = checkDifferentiation(
          FAILURE_CONTEXTS[i].key,
          FAILURE_CONTEXTS[j].key,
        );
        expect(
          r.differentiated,
          `${FAILURE_CONTEXTS[i].key} vs ${FAILURE_CONTEXTS[j].key} are indistinguishable`,
        ).toBe(true);
      }
    }
  });

  it("refuses an unknown context", () => {
    const r = checkDifferentiation("process_trip", "nonsense");
    expect(r.differentiated).toBe(false);
    expect(r.reason).toMatch(/Unknown context/);
  });
});

describe("pack validation honesty", () => {
  it("no pack claims customer validation the customer base cannot support", () => {
    // Historical packs claimed 'customer_validated' without enough signed
    // customer evidence. The status ladder means something or it means nothing.
    for (const pack of listIndustryTemplatePacks()) {
      expect(
        pack.validationStatus,
        `${pack.industryCode} claims a validation level nobody has signed`,
      ).not.toBe("customer_validated");
    }
  });

  it("does not invent Buildings criticality thresholds before adoption", () => {
    expect(
      INDUSTRY_TEMPLATE_PACKS.buildings_infrastructure.criticalityModel
        .criticalityThresholds,
    ).toEqual({ low: null, medium: null, high: null, critical: null });
  });
});

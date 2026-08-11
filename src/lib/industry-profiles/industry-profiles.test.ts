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

  it("every failure context binds to at least two engines and names its data", () => {
    for (const c of FAILURE_CONTEXTS) {
      expect(c.engines.length, c.key).toBeGreaterThanOrEqual(2);
      expect(c.requiredData.length, c.key).toBeGreaterThan(0);
    }
  });

  it("reports prose-only claims instead of hiding them", () => {
    const petro = assessProfile(
      INDUSTRY_PROFILES.find((p) => p.industryCode === "petrochemical")!,
    );
    // RBI is in the standards register (API 580/581) and the engine is not
    // built. The assessment must say so, not count the claim as coverage.
    expect(petro.proseOnly.join(" ")).toMatch(/API 580/);
    expect(petro.reason).toMatch(/must not read as coverage/);
    expect(petro.operationalShare).toBeLessThan(1);
  });

  it("computes operational share over ALL claims, not just the bound ones", () => {
    const mfg = assessProfile(
      INDUSTRY_PROFILES.find((p) => p.industryCode === "manufacturing")!,
    );
    // 3 operational, 2 prose → 3/5. Dividing by bound contexts only would
    // always yield 100%, which is the shell pattern this exists to kill.
    expect(mfg.operationalShare).toBeCloseTo(3 / 5, 6);
  });

  it("surfaces a wiring error rather than dropping it", () => {
    const broken = assessProfile({
      industryCode: "oil_sands",
      registerRef: "test",
      contexts: ["process_trip", "context_that_does_not_exist"],
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
    // 15 of 16 packs claimed 'customer_validated' on a platform with roughly
    // one customer. The status ladder means something or it means nothing.
    for (const pack of listIndustryTemplatePacks()) {
      expect(
        pack.validationStatus,
        `${pack.industryCode} claims a validation level nobody has signed`,
      ).not.toBe("customer_validated");
    }
  });
});

/**
 * D3.04/D3.03/D11.14 pure-lib tests: every refusal path names its factor, a
 * representative matrix of factor combinations pins the max() composition,
 * the compiler matches deterministically and never defaults, and the
 * inheritance walk takes the nearest carrier or states the absence.
 */
import { describe, expect, it } from "vitest";
import {
  FACTOR_RATING_SCALES,
  GATE_READINESS_CATEGORIES,
  GOVERNANCE_FACTORS,
  GOVERNANCE_INTENSITY_LEVELS,
  compileGovernanceRegime,
  computeGovernanceIntensity,
  intensityRank,
  resolveProfileFromChain,
  type GovernanceFactorInputs,
  type OrgChainNode,
  type TailoringRule,
  type ValueThresholds,
} from "./governance";

const T: ValueThresholds = {
  standardFromUsd: 5_000_000,
  elevatedFromUsd: 50_000_000,
  fullFromUsd: 250_000_000,
};

function inputs(
  over: Partial<GovernanceFactorInputs> = {},
): GovernanceFactorInputs {
  return {
    valueUsd: 1_000_000,
    risk: "low",
    complexity: "low",
    novelty: "proven",
    regulatoryExposure: "none",
    interfaces: "isolated",
    ...over,
  };
}

describe("the six factors are the spec's, and the levels are four", () => {
  it("factors verbatim from I.2, in its order", () => {
    expect(GOVERNANCE_FACTORS).toEqual([
      "value",
      "risk",
      "complexity",
      "novelty",
      "regulatory_exposure",
      "interfaces",
    ]);
  });

  it("light < standard < elevated < full", () => {
    expect(GOVERNANCE_INTENSITY_LEVELS).toEqual([
      "light",
      "standard",
      "elevated",
      "full",
    ]);
    expect(intensityRank("light")).toBe(1);
    expect(intensityRank("full")).toBe(4);
    expect(intensityRank("nonsense")).toBe(0);
    expect(intensityRank(null)).toBe(0);
  });
});

describe("D4.14 cyber is a first-class gate-readiness category", () => {
  it("publishes the §44 seven plus cyber, in the SQL vocabulary's order", () => {
    expect([...GATE_READINESS_CATEGORIES]).toEqual([
      "business",
      "technical",
      "risk",
      "cost_schedule",
      "operations",
      "supply",
      "regulatory",
      "cyber",
    ]);
  });
});

describe("refusals name the missing factor — every path", () => {
  it("missing value refuses naming value", () => {
    const r = computeGovernanceIntensity(inputs({ valueUsd: null }), T);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toHaveLength(1);
      expect(r.missing[0]).toContain("value");
      expect(r.reason).toContain("not computable");
    }
  });

  for (const factor of ["risk", "complexity", "novelty"] as const) {
    it(`missing ${factor} refuses naming ${factor} with its scale`, () => {
      const r = computeGovernanceIntensity(inputs({ [factor]: null }), T);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.missing.some((m) => m.startsWith(factor))).toBe(true);
        expect(r.missing.find((m) => m.startsWith(factor))).toContain(
          FACTOR_RATING_SCALES[factor][0],
        );
      }
    });
  }

  it("missing regulatory_exposure refuses under the spec's factor name", () => {
    const r = computeGovernanceIntensity(inputs({ regulatoryExposure: "" }), T);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.some((m) => m.startsWith("regulatory_exposure"))).toBe(
        true,
      );
    }
  });

  it("missing interfaces refuses naming interfaces", () => {
    const r = computeGovernanceIntensity(inputs({ interfaces: null }), T);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.some((m) => m.startsWith("interfaces"))).toBe(true);
    }
  });

  it("EVERY missing factor is named at once, not one at a time", () => {
    const r = computeGovernanceIntensity(
      {
        valueUsd: null,
        risk: null,
        complexity: null,
        novelty: null,
        regulatoryExposure: null,
        interfaces: null,
      },
      T,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toHaveLength(6);
      for (const f of GOVERNANCE_FACTORS) {
        expect(r.missing.some((m) => m.startsWith(f))).toBe(true);
      }
    }
  });

  it("an off-scale rating refuses naming the factor and the stated scale", () => {
    const r = computeGovernanceIntensity(inputs({ risk: "extreme" }), T);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing[0]).toContain("risk");
      expect(r.missing[0]).toContain("extreme");
      expect(r.missing[0]).toContain("low, medium, high, critical");
    }
  });

  it("absent thresholds refuse — the value band is configuration, not science", () => {
    const r = computeGovernanceIntensity(inputs(), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]).toContain("value_thresholds");
  });

  it("non-ascending thresholds refuse", () => {
    const r = computeGovernanceIntensity(inputs(), {
      standardFromUsd: 50,
      elevatedFromUsd: 50,
      fullFromUsd: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("ascend");
  });
});

describe("the composition is max(), with named drivers", () => {
  it("all factors at minimum → light, all six named as drivers", () => {
    const r = computeGovernanceIntensity(inputs(), T);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.level).toBe("light");
      expect(r.drivers).toEqual([...GOVERNANCE_FACTORS]);
    }
  });

  it("a single critical factor forces full, whatever the rest say", () => {
    const r = computeGovernanceIntensity(inputs({ risk: "critical" }), T);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.level).toBe("full");
      expect(r.drivers).toEqual(["risk"]);
    }
  });

  it("value bands by the thresholds: boundaries are inclusive lower bounds", () => {
    const at = (v: number) =>
      computeGovernanceIntensity(inputs({ valueUsd: v }), T);
    expect(at(4_999_999)).toMatchObject({ level: "light" });
    expect(at(5_000_000)).toMatchObject({ level: "standard" });
    expect(at(50_000_000)).toMatchObject({ level: "elevated" });
    expect(at(249_999_999)).toMatchObject({ level: "elevated" });
    expect(at(250_000_000)).toMatchObject({ level: "full" });
  });

  it("representative matrix: level = max over the factor levels", () => {
    const cases: Array<[Partial<GovernanceFactorInputs>, string, string[]]> = [
      [{ complexity: "medium" }, "standard", ["complexity"]],
      [{ novelty: "adapted" }, "elevated", ["novelty"]],
      [
        { regulatoryExposure: "major_approval" },
        "full",
        ["regulatory_exposure"],
      ],
      [
        { interfaces: "multiple", risk: "high" },
        "elevated",
        ["risk", "interfaces"],
      ],
      [
        { valueUsd: 120_000_000, novelty: "adapted" },
        "elevated",
        ["value", "novelty"],
      ],
      [
        { valueUsd: 300_000_000, risk: "critical", complexity: "very_high" },
        "full",
        ["value", "risk", "complexity"],
      ],
    ];
    for (const [over, level, drivers] of cases) {
      const r = computeGovernanceIntensity(inputs(over), T);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.level).toBe(level);
        expect(r.drivers).toEqual(drivers);
      }
    }
  });
});

describe("the tailoring compiler is deterministic and never defaults", () => {
  const rules: TailoringRule[] = [
    {
      id: 1,
      priority: 10,
      description: "greenfield/capacity run major capital",
      lifecycleTypes: ["greenfield", "capacity"],
      minValueUsd: null,
      maxValueUsd: null,
      minIntensity: null,
      maxIntensity: null,
      frameworkName: "Major Capital Projects — Mining & Metals",
      intensityFloor: null,
    },
    {
      id: 2,
      priority: 20,
      description: "routine sustaining below the elevated band runs light",
      lifecycleTypes: [
        "sustaining_capital",
        "replacement",
        "reliability_improvement",
      ],
      minValueUsd: null,
      maxValueUsd: 50_000_000,
      minIntensity: null,
      maxIntensity: null,
      frameworkName: "Sustaining Capital — Light Governance",
      intensityFloor: null,
    },
    {
      id: 3,
      priority: 30,
      description: "big sustaining is governed as major capital",
      lifecycleTypes: [
        "sustaining_capital",
        "replacement",
        "reliability_improvement",
      ],
      minValueUsd: 50_000_000,
      maxValueUsd: null,
      minIntensity: null,
      maxIntensity: null,
      frameworkName: "Major Capital Projects — Mining & Metals",
      intensityFloor: null,
    },
    {
      id: 4,
      priority: 40,
      description: "operating-site work runs brownfield with an elevated floor",
      lifecycleTypes: [
        "brownfield",
        "life_extension",
        "regulatory",
        "decommissioning",
      ],
      minValueUsd: null,
      maxValueUsd: null,
      minIntensity: null,
      maxIntensity: null,
      frameworkName: "Brownfield Modification — Operating Site",
      intensityFloor: "elevated",
    },
  ];

  it("first match in priority order wins", () => {
    const r = compileGovernanceRegime(
      rules,
      inputs({ valueUsd: 1_000_000 }),
      "sustaining_capital",
      T,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rule.priority).toBe(20);
      expect(r.frameworkName).toBe("Sustaining Capital — Light Governance");
      expect(r.effectiveLevel).toBe("light");
    }
  });

  it("value bounds are [min, max): the boundary case moves to the next rule", () => {
    const r = compileGovernanceRegime(
      rules,
      inputs({ valueUsd: 50_000_000 }),
      "replacement",
      T,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rule.priority).toBe(30);
  });

  it("a rule floor RAISES the intensity, never lowers it", () => {
    const raised = compileGovernanceRegime(
      rules,
      inputs({ valueUsd: 1_000_000 }),
      "brownfield",
      T,
    );
    expect(raised.ok).toBe(true);
    if (raised.ok) {
      expect(raised.computedLevel).toBe("light");
      expect(raised.effectiveLevel).toBe("elevated");
    }
    const notLowered = compileGovernanceRegime(
      rules,
      inputs({ valueUsd: 300_000_000 }),
      "brownfield",
      T,
    );
    expect(notLowered.ok).toBe(true);
    if (notLowered.ok) {
      expect(notLowered.computedLevel).toBe("full");
      expect(notLowered.effectiveLevel).toBe("full");
    }
  });

  it("no matching rule is a NAMED refusal, never a silent default", () => {
    const r = compileGovernanceRegime(
      rules.slice(0, 1),
      inputs(),
      "decommissioning",
      T,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("no tailoring rule matches");
      expect(r.reason).toContain("decommissioning");
    }
  });

  it("missing factors refuse BEFORE any rule is consulted", () => {
    const r = compileGovernanceRegime(
      rules,
      inputs({ complexity: null }),
      "greenfield",
      T,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing?.some((m) => m.startsWith("complexity"))).toBe(true);
    }
  });
});

describe("org-tree inheritance takes the nearest carrier or states the absence", () => {
  const chain: OrgChainNode[] = [
    {
      nodeId: "site",
      name: "Mine Site",
      orgLevel: "site",
      depth: 0,
      governanceProfile: null,
    },
    {
      nodeId: "bu",
      name: "Mining BU",
      orgLevel: "business_unit",
      depth: 1,
      governanceProfile: {
        frameworkId: "fw-bu",
        name: "Brownfield Modification — Operating Site",
        version: 2,
      },
    },
    {
      nodeId: "ent",
      name: "Enterprise",
      orgLevel: "enterprise",
      depth: 2,
      governanceProfile: {
        frameworkId: "fw-ent",
        name: "Major Capital Projects — Mining & Metals",
        version: 1,
      },
    },
  ];

  it("the nearest ancestor carrying a profile wins over a farther one", () => {
    const r = resolveProfileFromChain(chain);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profile.frameworkId).toBe("fw-bu");
      expect(r.inheritedFrom.orgLevel).toBe("business_unit");
    }
  });

  it("depth 0 (the node itself) wins when it carries one", () => {
    const own: OrgChainNode[] = [
      {
        ...chain[0],
        governanceProfile: {
          frameworkId: "fw-own",
          name: "Sustaining Capital — Light Governance",
          version: 1,
        },
      },
      chain[1],
    ];
    const r = resolveProfileFromChain(own);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.frameworkId).toBe("fw-own");
  });

  it("nothing on the chain is an absence stated as one", () => {
    const r = resolveProfileFromChain([
      { ...chain[0], governanceProfile: null },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("carries a governance profile");
  });
});

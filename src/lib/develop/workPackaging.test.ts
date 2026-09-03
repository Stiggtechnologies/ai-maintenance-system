import { describe, expect, it } from "vitest";
import {
  AWP_ACRONYMS,
  AWP_CHAIN,
  AWP_PACKAGE_TYPES,
  BURNDOWN_FORECASTS,
  CONSTRAINT_KINDS_NOT_HAND_CLEARABLE,
  CONSTRAINT_STATES,
  SPEC28_CONSTRAINT_TYPES,
  SPEC28_TO_CANONICAL_KIND,
  WORK_PACKAGE_STATUSES,
  awpLevel,
  awpParentType,
  canClearByHand,
  canonicalConstraintKind,
  eligibleParents,
  isAwpPackageType,
  parseBurndownHorizon,
  parseClearanceProbability,
  parseScheduleImpactDays,
} from "./workPackaging";

describe("the AWP chain is typed and ordered (D7.10, spec II.4)", () => {
  it("orders the five §27 types EWP → PWP → CWP → IWP → commissioning", () => {
    expect(AWP_CHAIN).toEqual([
      "engineering",
      "procurement",
      "construction",
      "installation",
      "commissioning",
    ]);
    expect(AWP_PACKAGE_TYPES).toHaveLength(5);
    expect(AWP_CHAIN.map(awpLevel)).toEqual([1, 2, 3, 4, 5]);
  });

  it("names every level with its industry acronym", () => {
    expect(AWP_ACRONYMS.engineering).toBe("EWP");
    expect(AWP_ACRONYMS.procurement).toBe("PWP");
    expect(AWP_ACRONYMS.construction).toBe("CWP");
    expect(AWP_ACRONYMS.installation).toBe("IWP");
    expect(Object.keys(AWP_ACRONYMS).sort()).toEqual(
      [...AWP_PACKAGE_TYPES].sort(),
    );
  });

  it("gives every type exactly the parent one level up", () => {
    expect(awpParentType("engineering")).toBeNull();
    expect(awpParentType("procurement")).toBe("engineering");
    expect(awpParentType("construction")).toBe("procurement");
    expect(awpParentType("installation")).toBe("construction");
    expect(awpParentType("commissioning")).toBe("installation");
  });

  it("refuses a type it has never heard of rather than calling it level zero", () => {
    // A level of 0 would sort BELOW engineering and read as the head of the
    // chain. Null is a refusal; zero is a wrong answer.
    expect(awpLevel("field_execution")).toBeNull();
    expect(awpLevel("")).toBeNull();
    expect(awpLevel("ENGINEERING")).toBeNull();
    expect(isAwpPackageType("field_execution")).toBe(false);
    expect(isAwpPackageType("installation")).toBe(true);
  });

  it("distinguishes 'has no parent' from 'is not a package type'", () => {
    // Both return null from awpParentType, and treating an unknown type as
    // "no parent required" is how a typed chain quietly becomes an untyped
    // one — the trigger distinguishes them and so must this.
    expect(awpParentType("engineering")).toBeNull();
    expect(isAwpPackageType("engineering")).toBe(true);
    expect(awpParentType("nonsense")).toBeNull();
    expect(isAwpPackageType("nonsense")).toBe(false);
  });

  it("offers only parents one level up, and offers none for the chain's head", () => {
    const packages = [
      { packageCode: "E1", packageType: "engineering" },
      { packageCode: "P1", packageType: "procurement" },
      { packageCode: "C1", packageType: "construction" },
    ];
    expect(
      eligibleParents("procurement", packages).map((p) => p.packageCode),
    ).toEqual(["E1"]);
    expect(
      eligibleParents("installation", packages).map((p) => p.packageCode),
    ).toEqual(["C1"]);
    // A skipped level is not offered: an installation package is never given
    // an engineering parent to choose.
    expect(
      eligibleParents("installation", packages).map((p) => p.packageType),
    ).not.toContain("engineering");
    expect(eligibleParents("engineering", packages)).toEqual([]);
    expect(eligibleParents("nonsense", packages)).toEqual([]);
  });

  it("mirrors the work_packages.status vocabulary — and only states a door can reach", () => {
    // THREE, NOT SIX. An earlier draft also listed 'planned', 'executing' and
    // 'complete'. Nothing could ever set them: `release_work_package` writes
    // 'released', `cancel_work_package` writes 'cancelled', and every other
    // door leaves the row in 'draft'. A vocabulary containing states no door
    // can produce invites a reader to filter on one and get an always-empty
    // answer, and invites the next author to assume the EXECUTION lifecycle
    // lives here. It does not — that is `work_orders.status` (RULING 19).
    expect(WORK_PACKAGE_STATUSES).toEqual(["draft", "released", "cancelled"]);
  });
});

describe("the §28 Constraint vocabulary (D7.18, RULING 20)", () => {
  it("names the spec's exactly ten types", () => {
    expect(SPEC28_CONSTRAINT_TYPES).toEqual([
      "drawing",
      "material",
      "access",
      "labour",
      "crane",
      "permit",
      "isolation",
      "scaffold",
      "predecessor",
      "inspection",
    ]);
    expect(SPEC28_CONSTRAINT_TYPES).toHaveLength(10);
  });

  it("maps all ten onto the canonical restoration_constraints vocabulary", () => {
    for (const type of SPEC28_CONSTRAINT_TYPES) {
      expect(canonicalConstraintKind(type), type).not.toBeNull();
    }
    // The two the spec names differently from this repository. Adding a
    // second word for one idea is how a vocabulary forks.
    expect(SPEC28_TO_CANONICAL_KIND.predecessor).toBe("precedence");
    expect(SPEC28_TO_CANONICAL_KIND.inspection).toBe("quality_hold");
    // The three added to the canonical store by this slice.
    expect(SPEC28_TO_CANONICAL_KIND.drawing).toBe("drawing");
    expect(SPEC28_TO_CANONICAL_KIND.access).toBe("access");
    expect(SPEC28_TO_CANONICAL_KIND.scaffold).toBe("scaffold");
  });

  it("does not silently accept a kind that is not one of the ten", () => {
    expect(canonicalConstraintKind("weather")).toBeNull();
    expect(canonicalConstraintKind("component_life")).toBeNull();
    expect(canonicalConstraintKind("")).toBeNull();
    // …but it is case- and space-tolerant, exactly as the SQL mapper is.
    expect(canonicalConstraintKind("  PREDECESSOR ")).toBe("precedence");
  });

  it("keeps permit, isolation and asset-state out of hand-clearing", () => {
    // Recovery's rule (20260921090000), preserved rather than exempted for
    // the project path. Offering the control and letting the server refuse
    // teaches the user the refusal is arbitrary.
    expect(CONSTRAINT_KINDS_NOT_HAND_CLEARABLE).toEqual([
      "permit",
      "isolation",
      "asset_state",
    ]);
    expect(canClearByHand("permit")).toBe(false);
    expect(canClearByHand("isolation")).toBe(false);
    expect(canClearByHand("asset_state")).toBe(false);
    expect(canClearByHand("scaffold")).toBe(true);
    expect(canClearByHand("quality_hold")).toBe(true);
  });

  it("mirrors the constraint state vocabulary and the five forecast buckets", () => {
    expect(CONSTRAINT_STATES).toEqual([
      "unknown",
      "satisfied",
      "blocked",
      "not_applicable",
    ]);
    // FIVE, WITH `lapsed` FIRST. A classifier that never compares a forecast
    // to today puts a still-open constraint whose expected clear date has
    // already passed into `expected_clear`, and the projection then names a
    // constraint-free date in the PAST with no refusal beside it. Time alone
    // produces that state; no bad write is needed. `lapsed` is the bucket
    // that names it, and it is first because it is asked first.
    expect(BURNDOWN_FORECASTS).toEqual([
      "lapsed",
      "will_block",
      "expected_clear",
      "unforecast",
      "not_assessable",
    ]);
    expect(BURNDOWN_FORECASTS[0]).toBe("lapsed");
  });
});

describe("probability of clearance refuses every shape the server refuses", () => {
  const basis = "Vendor confirmed the drawing issue date in writing on 12 May";

  it("accepts a stated probability with a stated basis", () => {
    const parsed = parseClearanceProbability("0.7", basis);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.probability).toBe(0.7);
      expect(parsed.value.basis).toBe(basis);
    }
    expect(parseClearanceProbability("0", basis).ok).toBe(true);
    expect(parseClearanceProbability("1", basis).ok).toBe(true);
  });

  it("refuses NaN and both infinities", () => {
    // 'NaN'::numeric = 'NaN'::numeric is TRUE in Postgres, so the range check
    // alone does not keep it out on either side of the wire.
    for (const raw of ["NaN", "nan", "Infinity", "-Infinity", "abc"]) {
      const parsed = parseClearanceProbability(raw, basis);
      expect(parsed.ok, raw).toBe(false);
      if (!parsed.ok) expect(parsed.refusal).toContain("finite number");
    }
  });

  it("refuses a number outside [0,1] and says why", () => {
    for (const raw of ["-0.1", "1.01", "70"]) {
      const parsed = parseClearanceProbability(raw, basis);
      expect(parsed.ok, raw).toBe(false);
      if (!parsed.ok) expect(parsed.refusal).toContain("not a probability");
    }
  });

  it("refuses a probability with no stated basis", () => {
    const parsed = parseClearanceProbability("0.7", "too short");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.refusal).toContain("basis");
  });

  it("refuses an empty probability rather than defaulting it", () => {
    const parsed = parseClearanceProbability("   ", basis);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.refusal).toContain("State a probability");
  });
});

describe("schedule impact refuses every shape the server refuses", () => {
  const basis = "Crane remobilisation quote";

  it("accepts a finite non-negative number of days with a basis", () => {
    const parsed = parseScheduleImpactDays("4", basis);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.days).toBe(4);
    expect(parseScheduleImpactDays("0", basis).ok).toBe(true);
  });

  it("refuses non-finite, negative and unsourced impacts", () => {
    expect(parseScheduleImpactDays("NaN", basis).ok).toBe(false);
    expect(parseScheduleImpactDays("Infinity", basis).ok).toBe(false);
    expect(parseScheduleImpactDays("-1", basis).ok).toBe(false);
    expect(parseScheduleImpactDays("", basis).ok).toBe(false);
    const unsourced = parseScheduleImpactDays("4", "short");
    expect(unsourced.ok).toBe(false);
    if (!unsourced.ok) expect(unsourced.refusal).toContain("basis");
  });
});

describe("the burn-down horizon refuses a window that projects nothing", () => {
  it("accepts a whole number of days inside the server's own bounds", () => {
    const parsed = parseBurndownHorizon("90");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe(90);
    expect(parseBurndownHorizon("1").ok).toBe(true);
    expect(parseBurndownHorizon("1825").ok).toBe(true);
  });

  it("refuses zero, negative, over-long, fractional and non-finite windows", () => {
    for (const raw of ["0", "-30", "1826", "NaN", "Infinity", "abc", ""]) {
      expect(parseBurndownHorizon(raw).ok, raw).toBe(false);
    }
    const fractional = parseBurndownHorizon("30.5");
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.refusal).toContain("whole number");
  });
});

describe("what this module refuses to contain", () => {
  it("exports no burn-down calculation and no readiness verdict", async () => {
    // The reachability gate caught `packageLateness` in 6A and 6B deleted
    // `warrantyCover`: both were client copies of a server answer, and the
    // pair disagreed inside one rendered payload. There is ONE forward
    // projection (get_package_constraint_burndown) and ONE readiness verdict
    // (release_work_package), both server-side.
    const mod = (await import("./workPackaging")) as Record<string, unknown>;
    const names = Object.keys(mod);
    for (const banned of [
      "burndown",
      "burnDown",
      "projectBurndown",
      "packageReadiness",
      "isPackageReady",
      "constraintFreePercent",
    ]) {
      expect(names, banned).not.toContain(banned);
    }
    expect(
      names.filter((n) => /burn|readiness|ready|percent|free/i.test(n)),
    ).toEqual(["BURNDOWN_FORECASTS", "parseBurndownHorizon"]);
  });
});

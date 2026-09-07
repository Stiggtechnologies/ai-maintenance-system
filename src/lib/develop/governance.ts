/**
 * Sync Develop — GovernanceIntensity (D3.04, spec I.2) and the tailoring
 * compiler (D3.03, spec I.1), pure and refusal-first.
 *
 * THE SIX FACTORS ARE THE SPEC'S, VERBATIM: Value, Risk, Complexity,
 * Novelty, RegulatoryExposure, Interfaces. The composition is max() —
 * governance intensity is a protection function, so one critical exposure
 * cannot be averaged away by five mild factors — and the factors AT the max
 * are returned as named drivers.
 *
 * REFUSAL DISCIPLINE (the assessGate posture): a missing factor refuses the
 * calculation NAMING EVERY missing factor; an unrecognized rating refuses
 * naming the factor and the stated scale. No default, no zero, no guess.
 *
 * THIS FILE IS THE DELIBERATE MIRROR of the SQL in migration
 * 20261120090200 (apply_case_governance + governance_factor_rating_level):
 * the lib gives the workspace an instant preview; the SQL computes the
 * persisted, enforced determination. A documented repeat of the
 * assessGate / record_case_gate_review precedent — the slice's static test
 * pins both sides to the same vocabularies so they cannot drift silently.
 */

export const GOVERNANCE_INTENSITY_LEVELS = [
  "light",
  "standard",
  "elevated",
  "full",
] as const;

export type GovernanceIntensityLevel =
  (typeof GOVERNANCE_INTENSITY_LEVELS)[number];

/**
 * First-class gate-readiness categories (D4.14 / spec §44 seven + cyber).
 * Mirrors `sync_gate_readiness_categories()`. An unmet mandatory criterion
 * in any of these blocks at any readiness percentage — cyber included.
 * There is no "every design gate must carry a cyber criterion" rule.
 */
export const GATE_READINESS_CATEGORIES = [
  "business",
  "technical",
  "risk",
  "cost_schedule",
  "operations",
  "supply",
  "regulatory",
  "cyber",
] as const;

export type GateReadinessCategory =
  (typeof GATE_READINESS_CATEGORIES)[number];

/** Spec I.2's six factors, in its own order and naming. */
export const GOVERNANCE_FACTORS = [
  "value",
  "risk",
  "complexity",
  "novelty",
  "regulatory_exposure",
  "interfaces",
] as const;

export type GovernanceFactor = (typeof GOVERNANCE_FACTORS)[number];

/**
 * The five stated-classification scales, each ascending 1→4. Value is not
 * here: it bands from the case's stated number against the adopted rule
 * set's thresholds. These arrays mirror governance_factor_rating_level in
 * 20261120090200 exactly.
 */
export const FACTOR_RATING_SCALES = {
  risk: ["low", "medium", "high", "critical"],
  complexity: ["low", "medium", "high", "very_high"],
  novelty: ["proven", "incremental", "adapted", "first_of_a_kind"],
  regulatory_exposure: [
    "none",
    "notification",
    "permit_required",
    "major_approval",
  ],
  interfaces: ["isolated", "limited", "multiple", "extensive"],
} as const;

export type RatedFactor = keyof typeof FACTOR_RATING_SCALES;

export interface GovernanceFactorInputs {
  /** Sanctioned value, else estimated capex — the case's own stated number. */
  valueUsd: number | null;
  risk: string | null;
  complexity: string | null;
  novelty: string | null;
  regulatoryExposure: string | null;
  interfaces: string | null;
}

/** Ascending USD band boundaries from the ADOPTED tailoring rule set. */
export interface ValueThresholds {
  standardFromUsd: number;
  elevatedFromUsd: number;
  fullFromUsd: number;
}

export interface GovernanceIntensityResult {
  ok: true;
  level: GovernanceIntensityLevel;
  factorLevels: Record<GovernanceFactor, number>;
  /** The factors sitting at the max — why the level is what it is. */
  drivers: GovernanceFactor[];
}

export interface GovernanceIntensityRefusal {
  ok: false;
  /** Every missing/invalid input, each named with its stated scale. */
  missing: string[];
  reason: string;
}

export function intensityRank(level: string | null | undefined): number {
  const i = GOVERNANCE_INTENSITY_LEVELS.indexOf(
    (level ?? "") as GovernanceIntensityLevel,
  );
  return i === -1 ? 0 : i + 1;
}

function ratingLevel(factor: RatedFactor, rating: string): number {
  const i = (FACTOR_RATING_SCALES[factor] as readonly string[]).indexOf(rating);
  return i === -1 ? 0 : i + 1;
}

function scaleText(factor: RatedFactor): string {
  return FACTOR_RATING_SCALES[factor].join(", ");
}

/**
 * The D3.04 calculation. Refuses — naming the factor — on any absent input
 * and on any rating off its stated scale; thresholds must be complete and
 * ascending or the value band is not computable.
 */
export function computeGovernanceIntensity(
  inputs: GovernanceFactorInputs,
  thresholds: ValueThresholds | null,
): GovernanceIntensityResult | GovernanceIntensityRefusal {
  const missing: string[] = [];

  if (
    thresholds == null ||
    !Number.isFinite(thresholds.standardFromUsd) ||
    !Number.isFinite(thresholds.elevatedFromUsd) ||
    !Number.isFinite(thresholds.fullFromUsd)
  ) {
    return {
      ok: false,
      missing: [
        "value_thresholds (standard_from_usd, elevated_from_usd, full_from_usd)",
      ],
      reason:
        "governance intensity is not computable: the adopted tailoring rule set states no value band thresholds",
    };
  }
  if (!(
    thresholds.standardFromUsd < thresholds.elevatedFromUsd &&
    thresholds.elevatedFromUsd < thresholds.fullFromUsd
  )) {
    return {
      ok: false,
      missing: ["value_thresholds (ascending order)"],
      reason:
        "governance intensity is not computable: value thresholds must ascend standard_from_usd < elevated_from_usd < full_from_usd",
    };
  }

  if (inputs.valueUsd == null || !Number.isFinite(inputs.valueUsd)) {
    missing.push(
      "value (the case states no sanctioned value and no estimated capex)",
    );
  }

  const rated: Array<[RatedFactor, string | null]> = [
    ["risk", inputs.risk],
    ["complexity", inputs.complexity],
    ["novelty", inputs.novelty],
    ["regulatory_exposure", inputs.regulatoryExposure],
    ["interfaces", inputs.interfaces],
  ];
  for (const [factor, raw] of rated) {
    const rating = (raw ?? "").trim();
    if (rating === "") {
      missing.push(`${factor} (${scaleText(factor)})`);
    } else if (ratingLevel(factor, rating) === 0) {
      missing.push(
        `${factor} ("${rating}" is not on the stated scale: ${scaleText(factor)})`,
      );
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: `governance intensity is not computable: ${missing.length} of the six I.2 factors are missing or not on their stated scales`,
    };
  }

  const value = inputs.valueUsd as number;
  const valueLevel =
    value >= thresholds.fullFromUsd
      ? 4
      : value >= thresholds.elevatedFromUsd
        ? 3
        : value >= thresholds.standardFromUsd
          ? 2
          : 1;

  const factorLevels: Record<GovernanceFactor, number> = {
    value: valueLevel,
    risk: ratingLevel("risk", (inputs.risk as string).trim()),
    complexity: ratingLevel("complexity", (inputs.complexity as string).trim()),
    novelty: ratingLevel("novelty", (inputs.novelty as string).trim()),
    regulatory_exposure: ratingLevel(
      "regulatory_exposure",
      (inputs.regulatoryExposure as string).trim(),
    ),
    interfaces: ratingLevel("interfaces", (inputs.interfaces as string).trim()),
  };

  const max = Math.max(...Object.values(factorLevels));
  const drivers = GOVERNANCE_FACTORS.filter((f) => factorLevels[f] === max);

  return {
    ok: true,
    level: GOVERNANCE_INTENSITY_LEVELS[max - 1],
    factorLevels,
    drivers,
  };
}

/* ────────────────────────── tailoring compiler (D3.03) ────────────────────── */

export interface TailoringRule {
  id: number;
  priority: number;
  description: string;
  /** Empty array means "any lifecycle type". */
  lifecycleTypes: string[];
  minValueUsd: number | null;
  maxValueUsd: number | null;
  minIntensity: string | null;
  maxIntensity: string | null;
  frameworkName: string;
  /** May raise the computed intensity, never lower it. */
  intensityFloor: string | null;
}

export interface RegimeSelection {
  ok: true;
  rule: TailoringRule;
  frameworkName: string;
  computedLevel: GovernanceIntensityLevel;
  /** max(computed, rule floor) — the level enforcement binds to. */
  effectiveLevel: GovernanceIntensityLevel;
  drivers: GovernanceFactor[];
  factorLevels: Record<GovernanceFactor, number>;
}

export interface RegimeRefusal {
  ok: false;
  reason: string;
  missing?: string[];
}

/**
 * Deterministic regime selection: compute the six-factor intensity, then the
 * FIRST rule in ascending priority order whose predicates all hold. No
 * matching rule is a named refusal — the compiler never defaults a
 * framework silently. Mirrors apply_case_governance's SQL exactly.
 */
export function compileGovernanceRegime(
  rules: TailoringRule[],
  inputs: GovernanceFactorInputs,
  lifecycleType: string,
  thresholds: ValueThresholds | null,
): RegimeSelection | RegimeRefusal {
  const intensity = computeGovernanceIntensity(inputs, thresholds);
  if (!intensity.ok) {
    return { ok: false, reason: intensity.reason, missing: intensity.missing };
  }

  const computedRank = intensityRank(intensity.level);
  const value = inputs.valueUsd as number;
  const match = [...rules]
    .sort((a, b) => a.priority - b.priority)
    .find(
      (r) =>
        (r.lifecycleTypes.length === 0 ||
          r.lifecycleTypes.includes(lifecycleType)) &&
        (r.minValueUsd == null || value >= r.minValueUsd) &&
        (r.maxValueUsd == null || value < r.maxValueUsd) &&
        (r.minIntensity == null ||
          computedRank >= intensityRank(r.minIntensity)) &&
        (r.maxIntensity == null ||
          computedRank <= intensityRank(r.maxIntensity)),
    );

  if (!match) {
    return {
      ok: false,
      reason: `no tailoring rule matches this case (lifecycle ${lifecycleType}, value $${value.toLocaleString()}, computed intensity ${intensity.level}) — the compiler selects nothing silently`,
    };
  }

  const effectiveRank = Math.max(
    computedRank,
    intensityRank(match.intensityFloor),
  );

  return {
    ok: true,
    rule: match,
    frameworkName: match.frameworkName,
    computedLevel: intensity.level,
    effectiveLevel: GOVERNANCE_INTENSITY_LEVELS[effectiveRank - 1],
    drivers: intensity.drivers,
    factorLevels: intensity.factorLevels,
  };
}

/* ─────────────────── org-tree profile inheritance (D11.14) ────────────────── */

export interface OrgChainNode {
  nodeId: string;
  name: string;
  orgLevel: string;
  /** Depth 0 = the case's own node; ascending toward the root. */
  depth: number;
  /** The ADOPTED framework this node carries, if any. */
  governanceProfile: {
    frameworkId: string;
    name: string;
    version: number;
  } | null;
}

export interface InheritedProfile {
  ok: true;
  profile: { frameworkId: string; name: string; version: number };
  inheritedFrom: OrgChainNode;
}

export interface InheritanceAbsence {
  ok: false;
  reason: string;
}

/**
 * The inheritance walk, pure: nearest node (smallest depth) carrying a
 * profile wins; nothing on the whole chain is an absence stated as one.
 * Mirrors resolve_org_governance_profile (20261120090000).
 */
export function resolveProfileFromChain(
  chain: OrgChainNode[],
): InheritedProfile | InheritanceAbsence {
  const carrier = [...chain]
    .sort((a, b) => a.depth - b.depth)
    .find((n) => n.governanceProfile != null);
  if (!carrier) {
    return {
      ok: false,
      reason:
        "no organization on this case's tree carries a governance profile — attach one (set_org_governance_profile) or select a framework explicitly",
    };
  }
  return {
    ok: true,
    profile: carrier.governanceProfile as InheritedProfile["profile"],
    inheritedFrom: carrier,
  };
}

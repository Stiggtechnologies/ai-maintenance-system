/**
 * Quantitative risk-based inspection planning (BOK-05), API RP 580-aligned.
 *
 * Before this kernel the platform's "RBI" stored an owner-supplied inspection
 * interval. RBI is the calculation that produces that interval: risk is the
 * probability of failure times its consequence, PoF grows as damage
 * accumulates, and inspection is due before risk crosses the owner's target
 * (API RP 580, 4th ed. 2023, §§9–13; API RP 581 Part 1 §4 for the
 * PoF = gff · D_f(t) · F_MS form).
 *
 * What this kernel is NOT: an implementation of API RP 581's copyrighted
 * damage-factor tables, consequence-area equations or management-system
 * scoring. Those values must come from a licensed copy of the standard or a
 * documented engineering method, and arrive here as inputs with a basis. The
 * output therefore claims API 580 alignment, never API 581 compliance.
 *
 * Damage-factor growth is supplied per mechanism as (years, D_f) points from
 * the owner's degradation assessment and interpolated linearly; the kernel
 * does not extrapolate past the last point (it reports the horizon instead).
 *
 * Pure: no I/O, no randomness, no LLM.
 */

export interface Basis {
  basis: string;
}

export interface DamageMechanism extends Basis {
  mechanism: string;
  /** (years from assessment, damage factor) points, years ascending from 0. */
  curve: { years: number; df: number }[];
}

export type DamageCombination = "additive" | "governing";

export interface RbiInput {
  componentId: string;
  genericFailureFrequency: { perYear: number } & Basis;
  mechanisms: DamageMechanism[];
  /** "additive" sums mechanism D_f (conservative); "governing" takes the max. */
  combination: DamageCombination;
  combinationBasis: string;
  managementSystemFactor: { value: number } & Basis;
  consequence: { value: number; unit: "m2" | "currency" } & Basis;
  riskTarget: { value: number } & Basis;
}

export interface RbiResult {
  componentId: string;
  pofNow: number;
  riskNow: number;
  riskTarget: number;
  /** Years until risk reaches the target; 0 when already over; null if not within the assessed horizon. */
  yearsToTarget: number | null;
  horizonYears: number;
  exceedsTargetNow: boolean;
  governingMechanism: string;
  standardClaim: "API 580-aligned; API 581 values supplied by owner";
  reason: string;
}

const needBasis = (what: string, b: Basis) => {
  if (!b.basis || b.basis.trim().length < 10)
    throw new Error(
      `${what} needs a stated basis (licensed standard table, study, or inspection record).`,
    );
};

function dfAt(m: DamageMechanism, years: number): number {
  const c = m.curve;
  if (years <= c[0].years) return c[0].df;
  for (let i = 1; i < c.length; i++) {
    if (years <= c[i].years) {
      const w = (years - c[i - 1].years) / (c[i].years - c[i - 1].years);
      return c[i - 1].df + w * (c[i].df - c[i - 1].df);
    }
  }
  return c[c.length - 1].df;
}

function validate(input: RbiInput) {
  needBasis("Generic failure frequency", input.genericFailureFrequency);
  if (!(input.genericFailureFrequency.perYear > 0))
    throw new Error("The generic failure frequency must be positive.");
  needBasis("Management-system factor", input.managementSystemFactor);
  if (!(input.managementSystemFactor.value > 0))
    throw new Error("The management-system factor must be positive.");
  needBasis("Consequence", input.consequence);
  if (!(input.consequence.value > 0))
    throw new Error("The consequence must be positive.");
  needBasis("Risk target", input.riskTarget);
  if (!(input.riskTarget.value > 0))
    throw new Error("The risk target must be positive.");
  if (!input.combinationBasis || input.combinationBasis.trim().length < 10)
    throw new Error(
      "State why damage factors are combined additively or by the governing mechanism.",
    );
  if (input.mechanisms.length === 0)
    throw new Error(
      "At least one active damage mechanism is required; with none, RBI has nothing to plan against.",
    );
  for (const m of input.mechanisms) {
    needBasis(`Mechanism "${m.mechanism}"`, m);
    if (m.curve.length < 2)
      throw new Error(
        `Mechanism "${m.mechanism}" needs at least two damage-factor points.`,
      );
    if (m.curve[0].years !== 0)
      throw new Error(
        `Mechanism "${m.mechanism}" must start at year 0 (the assessment date).`,
      );
    for (let i = 0; i < m.curve.length; i++) {
      if (!(m.curve[i].df > 0))
        throw new Error(
          `Mechanism "${m.mechanism}" has a non-positive damage factor.`,
        );
      if (i > 0 && !(m.curve[i].years > m.curve[i - 1].years))
        throw new Error(
          `Mechanism "${m.mechanism}" points must be in ascending years.`,
        );
      if (i > 0 && m.curve[i].df < m.curve[i - 1].df)
        throw new Error(
          `Mechanism "${m.mechanism}": damage cannot decrease without inspection or repair.`,
        );
    }
  }
}

function totalDf(
  input: RbiInput,
  years: number,
): { total: number; governing: string } {
  const dfs = input.mechanisms.map((m) => ({
    m: m.mechanism,
    df: dfAt(m, years),
  }));
  const gov = dfs.reduce((a, b) => (b.df > a.df ? b : a));
  const total =
    input.combination === "additive"
      ? dfs.reduce((s, x) => s + x.df, 0)
      : gov.df;
  return { total, governing: gov.m };
}

export function planRiskBasedInspection(input: RbiInput): RbiResult {
  validate(input);
  const horizon = Math.min(
    ...input.mechanisms.map((m) => m.curve[m.curve.length - 1].years),
  );
  const risk = (y: number) => {
    const { total } = totalDf(input, y);
    return (
      input.genericFailureFrequency.perYear *
      total *
      input.managementSystemFactor.value *
      input.consequence.value
    );
  };
  const now = totalDf(input, 0);
  const pofNow =
    input.genericFailureFrequency.perYear *
    now.total *
    input.managementSystemFactor.value;
  const riskNow = pofNow * input.consequence.value;
  const target = input.riskTarget.value;
  const unit = input.consequence.unit === "m2" ? "m²/yr" : "per yr";
  const base = {
    componentId: input.componentId,
    pofNow,
    riskNow,
    riskTarget: target,
    horizonYears: horizon,
    governingMechanism: now.governing,
    standardClaim: "API 580-aligned; API 581 values supplied by owner" as const,
  };
  if (riskNow >= target)
    return {
      ...base,
      yearsToTarget: 0,
      exceedsTargetNow: true,
      reason: `Risk ${riskNow.toPrecision(3)} ${unit} already exceeds the target ${target.toPrecision(3)}; inspect or mitigate now. Governing mechanism: ${now.governing}.`,
    };
  if (risk(horizon) < target)
    return {
      ...base,
      yearsToTarget: null,
      exceedsTargetNow: false,
      reason: `Risk stays below target for the whole assessed horizon (${horizon} years). Re-assess before the horizon; the kernel does not extrapolate damage beyond the owner's curve.`,
    };
  let lo = 0;
  let hi = horizon;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (risk(mid) < target) lo = mid;
    else hi = mid;
  }
  const yrs = (lo + hi) / 2;
  return {
    ...base,
    yearsToTarget: yrs,
    exceedsTargetNow: false,
    reason: `Risk reaches the target in ${yrs.toFixed(2)} years (governing mechanism at that point: ${totalDf(input, yrs).governing}). Inspection of sufficient effectiveness is due before then; the interval is a recommendation for the integrity owner to adopt, not an adopted plan.`,
  };
}

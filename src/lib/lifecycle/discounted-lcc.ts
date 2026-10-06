/**
 * Discounted life-cycle cost and equivalent annual cost (BOK-07).
 *
 * The existing lifecycle engine compares repair / replace / redesign options
 * undiscounted, deliberately, because a discount rate is a corporate decision.
 * That posture is right about ownership and wrong about the arithmetic: with
 * no discounting, an option whose costs fall late always looks cheaper than
 * it is, and options with different lives cannot be compared at all. IEC
 * 60300-3-3 (2017) §5.4, Blanchard & Fabrycky (Systems Engineering and
 * Analysis, ch. 17) and the DoD O&S Cost-Estimating Guide all compare options
 * on present value and equivalent annual cost.
 *
 * This kernel keeps the ownership rule — the rate is REQUIRED, with a named
 * owner and basis, and never defaulted — and adds the arithmetic:
 *   NPV  = Σ C_t / (1 + r)^t
 *   EAC  = NPV · CRF(r, n),  CRF = r(1+r)^n / ((1+r)^n − 1)   (= 1/n at r = 0)
 * plus a sensitivity sweep over caller-supplied rates that reports whether
 * the ranking flips, so a decision that hinges on the rate is visible as one.
 *
 * Comparing options of different lives on EAC assumes each would be renewed
 * like-for-like at the end of its life (the standard repeatability
 * assumption). When that is false — a technology step-change, a fixed closure
 * date — compare NPVs over a common study period instead; the result carries
 * this assumption in its reason text so it is never implicit.
 *
 * Sign convention: costs are positive. Lower EAC is better.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

export interface CashFlow {
  /** Years from decision (0 = now). */
  year: number;
  amount: number;
  label?: string;
}

export interface LccOption {
  name: string;
  lifeYears: number;
  cashFlows: CashFlow[];
}

export interface DiscountPolicy {
  /** Real annual discount rate, e.g. 0.07. */
  rate: number;
  /** Who set it (finance function, role). */
  owner: string;
  /** Where it comes from (WACC memo, treasury policy, regulator). */
  basis: string;
}

export function presentValue(flows: CashFlow[], rate: number): number {
  if (!(rate > -1)) throw new Error("The discount rate must exceed −100%.");
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, f.year), 0);
}

export function capitalRecoveryFactor(rate: number, years: number): number {
  if (!(years > 0)) throw new Error("The analysis life must be positive.");
  if (Math.abs(rate) < 1e-12) return 1 / years;
  const g = Math.pow(1 + rate, years);
  return (rate * g) / (g - 1);
}

export interface OptionResult {
  name: string;
  lifeYears: number;
  npv: number;
  eac: number;
  undiscountedEac: number;
  rank: number;
}

export interface LccComparison {
  policy: DiscountPolicy;
  options: OptionResult[];
  preferred: string;
  sensitivity: { rate: number; preferred: string }[];
  rankingSensitiveToRate: boolean;
  /** True when undiscounted EAC would have picked a different option. */
  undiscountedWouldMislead: boolean;
  reason: string;
}

function validateOption(o: LccOption) {
  if (!o.name?.trim()) throw new Error("Every option needs a name.");
  if (!(o.lifeYears > 0))
    throw new Error(`Option ${o.name}: life must be positive.`);
  if (o.cashFlows.length === 0)
    throw new Error(`Option ${o.name}: no cash flows were supplied.`);
  for (const f of o.cashFlows) {
    if (!(f.year >= 0))
      throw new Error(`Option ${o.name}: cash-flow years must be ≥ 0.`);
    if (f.year > o.lifeYears)
      throw new Error(
        `Option ${o.name}: a cash flow at year ${f.year} falls after its ${o.lifeYears}-year life.`,
      );
    if (!Number.isFinite(f.amount))
      throw new Error(`Option ${o.name}: a cash flow is not a number.`);
  }
}

function evaluate(options: LccOption[], rate: number): OptionResult[] {
  const res = options.map((o) => {
    const npv = presentValue(o.cashFlows, rate);
    const total = o.cashFlows.reduce((s, f) => s + f.amount, 0);
    return {
      name: o.name,
      lifeYears: o.lifeYears,
      npv,
      eac: npv * capitalRecoveryFactor(rate, o.lifeYears),
      undiscountedEac: total / o.lifeYears,
      rank: 0,
    };
  });
  [...res].sort((a, b) => a.eac - b.eac).forEach((r, i) => (r.rank = i + 1));
  return res.sort((a, b) => a.rank - b.rank);
}

/** Compare options on EAC at a governed discount rate, with a rate sweep. */
export function compareLifeCycleOptions(
  options: LccOption[],
  policy: DiscountPolicy,
  sensitivityRates: number[] = [],
): LccComparison {
  if (options.length < 2)
    throw new Error("A comparison needs at least two options.");
  if (!(policy.rate >= 0 && policy.rate < 1))
    throw new Error(
      "The discount rate must be in [0, 1); it is a corporate input, not assumed here.",
    );
  if (!policy.owner?.trim() || !policy.basis || policy.basis.trim().length < 15)
    throw new Error(
      "The discount rate needs a named owner and a stated basis.",
    );
  options.forEach(validateOption);
  const results = evaluate(options, policy.rate);
  const preferred = results[0].name;
  const sensitivity = [...new Set(sensitivityRates)]
    .filter((r) => r >= 0 && r < 1)
    .sort((a, b) => a - b)
    .map((rate) => ({ rate, preferred: evaluate(options, rate)[0].name }));
  const rankingSensitiveToRate = sensitivity.some(
    (s) => s.preferred !== preferred,
  );
  const undiscPreferred = [...results].sort(
    (a, b) => a.undiscountedEac - b.undiscountedEac,
  )[0].name;
  const undiscountedWouldMislead = undiscPreferred !== preferred;
  const parts = [
    `${preferred} has the lowest equivalent annual cost at ${(policy.rate * 100).toFixed(1)}% (set by ${policy.owner}).`,
  ];
  if (rankingSensitiveToRate)
    parts.push(
      "The preferred option changes within the sensitivity range: this decision depends on the discount rate and should say so.",
    );
  if (undiscountedWouldMislead)
    parts.push(
      `An undiscounted comparison would have picked ${undiscPreferred}.`,
    );
  if (new Set(options.map((o) => o.lifeYears)).size > 1)
    parts.push(
      "Lives differ, so EAC assumes each option is renewed like-for-like; if not, compare NPV over a common study period.",
    );
  return {
    policy,
    options: results,
    preferred,
    sensitivity,
    rankingSensitiveToRate,
    undiscountedWouldMislead,
    reason: parts.join(" "),
  };
}

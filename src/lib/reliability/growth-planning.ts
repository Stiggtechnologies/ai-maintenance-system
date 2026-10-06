/**
 * Reliability growth PLANNING (BOK-10) — the idealized growth curve of
 * MIL-HDBK-189C §5.2 (Duane/Crow power-law form).
 *
 * The platform already TRACKS growth (Crow-AMSAA in ./index.ts). Planning
 * answers the questions asked before an early-life or new-equipment programme
 * starts: how much operating/test time does the target MTBF need at a stated
 * growth rate, or what growth rate does the available time require?
 *
 *   cumulative MTBF  Mc(t) = M_I · (t / t_I)^α            for t ≥ t_I
 *   instantaneous    M(t)  = Mc(t) / (1 − α)
 *
 * M_I (initial MTBF), t_I (end of the initial phase) and α (growth rate) are
 * programme inputs with a stated basis; none is defaulted. Growth rates above
 * about 0.5 are rarely achieved in practice (MIL-HDBK-189C §5.2.3), so the
 * result flags them rather than silently planning on them.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

export interface GrowthPlanInput {
  initialMtbf: number;
  initialPhaseEnd: number;
  growthRate: number;
}

function validate({
  initialMtbf,
  initialPhaseEnd,
  growthRate,
}: GrowthPlanInput) {
  if (!(initialMtbf > 0)) throw new Error("Initial MTBF must be positive.");
  if (!(initialPhaseEnd > 0))
    throw new Error("The initial phase end time must be positive.");
  if (!(growthRate > 0 && growthRate < 1))
    throw new Error(
      "The growth rate must be in (0, 1); at α ≥ 1 the model is undefined.",
    );
}

/** Instantaneous MTBF on the idealized curve at time t. */
export function idealizedMtbf(input: GrowthPlanInput, t: number): number {
  validate(input);
  if (t < input.initialPhaseEnd)
    throw new Error(
      "The idealized curve applies only from the end of the initial phase.",
    );
  const mc =
    input.initialMtbf * Math.pow(t / input.initialPhaseEnd, input.growthRate);
  return mc / (1 - input.growthRate);
}

export interface TimeToTarget {
  time: number;
  aggressive: boolean;
  reason: string;
}

/** Test/operating time for the instantaneous MTBF to reach a target. */
export function timeToReachMtbf(
  input: GrowthPlanInput,
  targetMtbf: number,
): TimeToTarget {
  validate(input);
  if (!(targetMtbf > 0)) throw new Error("Target MTBF must be positive.");
  const ratio = ((1 - input.growthRate) * targetMtbf) / input.initialMtbf;
  const time =
    ratio <= 1
      ? input.initialPhaseEnd
      : input.initialPhaseEnd * Math.pow(ratio, 1 / input.growthRate);
  const aggressive = input.growthRate > 0.5;
  return {
    time,
    aggressive,
    reason: aggressive
      ? `This plan assumes a growth rate of ${input.growthRate}, above the ~0.5 rarely exceeded in practice; the time is likely optimistic.`
      : `At α = ${input.growthRate}, the target is reached at t = ${time.toFixed(0)}.`,
  };
}

/** Growth rate required to reach the target MTBF by time T (bisection). */
export function requiredGrowthRate(
  initialMtbf: number,
  initialPhaseEnd: number,
  targetMtbf: number,
  availableTime: number,
): { growthRate: number | null; aggressive: boolean; reason: string } {
  if (!(availableTime > initialPhaseEnd))
    throw new Error("The available time must extend beyond the initial phase.");
  const f = (a: number) =>
    (initialMtbf * Math.pow(availableTime / initialPhaseEnd, a)) / (1 - a) -
    targetMtbf;
  let lo = 1e-6;
  let hi = 0.999;
  if (f(lo) >= 0)
    return {
      growthRate: 0,
      aggressive: false,
      reason: "The target is met without growth.",
    };
  if (f(hi) < 0)
    return {
      growthRate: null,
      aggressive: true,
      reason:
        "No growth rate below 1 reaches the target in the time available.",
    };
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  const a = (lo + hi) / 2;
  return {
    growthRate: a,
    aggressive: a > 0.5,
    reason:
      a > 0.5
        ? `Requires α = ${a.toFixed(2)}, above what programmes normally achieve.`
        : `Requires α = ${a.toFixed(2)}.`,
  };
}

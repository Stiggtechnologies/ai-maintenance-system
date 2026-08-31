/**
 * Integrated risk-cost-schedule simulation (Sync Develop Slice 4C — D5.09,
 * D5.15, D5.07/D5.32).
 *
 * ── THIS IS AN EXTENSION OF THE KERNEL, NOT A SECOND SIMULATOR ─────────────
 *
 * It computes nothing the kernel already computes. The critical path comes
 * from `criticalPath` in ./schedule-risk; the random source, the triangular
 * sampler and the percentile function come from ./random. The overlap map's
 * ruling on D5.09 is "EXTEND the kernel — never a second simulator", and what
 * this file adds is the RISK LAYER the existing schedule simulation has no
 * concept of: a risk that occurs with a stated probability, delays a named
 * activity by a sampled number of days, and costs money both directly and
 * through the days.
 *
 * ── THE RULE THIS FILE EXISTS TO OBEY ──────────────────────────────────────
 *
 * NEVER MANUFACTURE A DISTRIBUTION. Every refusal below is a case where it
 * would be trivial to produce a plausible spread and completely dishonest to
 * do it:
 *
 *   * an activity with no optimistic/pessimistic range is held FIXED and
 *     reported, never given a default variance;
 *   * a risk with no three-point delay cannot exist (the database refuses it
 *     at the schema) and is refused here too rather than trusted;
 *   * a run where NOTHING varies returns `simulated: false` with a reason,
 *     because percentiles off a degenerate sample are the deterministic
 *     answer wearing percentile labels;
 *   * a quality gate that did not pass returns `simulated: false` and names
 *     the failing classes — spec II.6, "Monte Carlo on poor logic is not
 *     useful". There is no "run anyway with a caveat" path, because a
 *     caveated P80 and a clean P80 are read identically.
 *
 * ── DETERMINISM ────────────────────────────────────────────────────────────
 *
 * Seeded, always. The same (activities, risks, seed, iterations) produce the
 * same output for ever, and the seed travels with the result into the
 * recorded lineage run. `Math.random` is not used and must not be: a number
 * nobody can reproduce cannot be defended in a review, and the whole point of
 * recording the seed server-side is that anybody can re-run this and check.
 *
 * ── HOW ATTRIBUTION IS COMPUTED (D5.09) ────────────────────────────────────
 *
 * Marginally, out of the simulation, not out of an ordering somebody assumed.
 * The full run gives P80. Then for each risk the SAME run is repeated with
 * that one risk suppressed — same seed, same iteration count, same everything
 * else, and (see `streamSeed` below) literally the same activity samples and
 * the same samples for every other risk — so the difference in P80 is what
 * THAT risk contributes to the commitment percentile and is not partly a
 * re-randomisation. That answers spec I.10's question in its own words:
 * "Compressor delivery currently contributes 17 days of P80 schedule exposure
 * and $14.2M expected economic exposure."
 *
 * Marginal contributions do not sum to the total when risks interact through
 * the network (two risks on parallel paths can each contribute nothing alone
 * and a fortnight together). That is a property of the project, not an error,
 * and it is reported rather than normalised away — normalising would make the
 * numbers add up and stop them being true.
 */
import { criticalPath, type ScheduleTask } from "./schedule-risk";
import { mulberry32, percentile, sampleTriangular } from "./random";

/** The server's §50 verdict. Produced by `get_case_schedule_quality`. */
export interface ScheduleQualityGate {
  permitted: boolean;
  failingClasses: string[];
  notDiagnosableClasses: string[];
  minimumScore: number;
  refusal: string | null;
}

/** One risk edge: spec I.10's risk → probability → activity. */
export interface RiskImpact {
  riskId: string;
  riskTitle: string;
  /** The activity id (task_key) this risk threatens. */
  activityId: string;
  /** (0,1]. The link's own probability — never a register score rescaled. */
  probability: number;
  delayDaysOptimistic: number;
  delayDaysLikely: number;
  delayDaysPessimistic: number;
  /** Direct cost if it occurs. All three or none. */
  costOptimistic: number | null;
  costLikely: number | null;
  costPessimistic: number | null;
}

/**
 * Whether the schedule's LOGIC is logic this kernel models.
 *
 * `criticalPath` reads every edge as finish-to-start with zero lag. It has no
 * concept of SS/FF/SF or of a lag. The server hashes the link type and the lag
 * into the input digest, so before this check a schedule using them produced a
 * distribution over a DIFFERENT network under a digest that claimed otherwise
 * — proven in review: changing one relationship from FS/0h to SS/120h left the
 * percentiles byte-identical while the real network finishes ~46% sooner.
 * Growing a second CPM here would be a second answer to the question this
 * kernel exists to answer, so the run is REFUSED instead and says so.
 */
export interface ScheduleLogicSupport {
  supported: boolean;
  nonFinishToStartCount: number;
  laggedCount: number;
  unstatedLinkTypeCount: number;
  refusal: string | null;
  assumptionNote: string | null;
}

export interface IntegratedRiskInput {
  activities: ScheduleTask[];
  risks: RiskImpact[];
  /** Server verdict. A simulation is refused when it did not pass. */
  gate: ScheduleQualityGate;
  /** Server verdict on the logic. A simulation is refused when unsupported. */
  logicSupport?: ScheduleLogicSupport;
  /**
   * The published cap on attributed risks. Enforced here, BEFORE sampling:
   * the marginal attribution costs one full extra pass per risk, so 200 edges
   * at 2000 iterations ran 202 simulations in the browser and only then had
   * the result refused at the door — the cap exists to stop the tab freezing
   * and was being applied after the freeze.
   */
  maximumAttributedRisks?: number;
  iterations: number;
  seed: number;
  /** Money per day of overall project delay. Null = the hop is refused. */
  delayCostPerDay: number | null;
  /** The deterministic cost forecast the exposure is added to. */
  costBase: number | null;
  currency: string | null;
}

export interface RiskAttributionRow {
  riskId: string;
  riskTitle: string;
  activityId: string;
  /** Fraction of iterations in which this risk occurred. */
  occurrenceRate: number;
  /** P80 project hours WITH this risk minus P80 with it suppressed. */
  p80HoursContribution: number;
  /** The same figure in days, which is how I.10 states it. */
  p80DaysContribution: number;
  /** Mean money this risk added per iteration: direct cost + delay cost. */
  meanCostContribution: number | null;
  /** P80 of this risk's own cost contribution across iterations. */
  p80CostContribution: number | null;
  reason: string;
}

export interface IntegratedRiskResult {
  simulated: boolean;
  seed: number;
  iterations: number;
  sampleCount: number;
  kernelVersion: string;
  deterministicHours: number;
  p10Hours: number | null;
  p50Hours: number | null;
  p80Hours: number | null;
  p90Hours: number | null;
  probabilityOnPlan: number | null;
  /** Risk-driven cost exposure. Null when nothing costed was simulated. */
  costExposureP50: number | null;
  costExposureP80: number | null;
  costBase: number | null;
  currency: string | null;
  delayCostPerDay: number | null;
  attribution: RiskAttributionRow[];
  criticality: {
    id: string;
    label: string;
    criticalityIndex: number;
    deterministicFloat: number;
  }[];
  activitiesWithoutRanges: string[];
  refusals: string[];
  reason: string;
}

/**
 * The code identity recorded on every run. Bump it when the sampling changes,
 * NOT when a comment does: a version that moves on unchanged behaviour makes
 * every recorded distribution's version stop meaning anything.
 */
export const INTEGRATED_RISK_KERNEL_VERSION = "integrated-risk/4C/2026-12-02";

/** Hours per day for the days↔hours conversion. Elapsed, per migration R2. */
export const HOURS_PER_DAY = 24;

function emptyResult(
  input: IntegratedRiskInput,
  deterministicHours: number,
  reason: string,
  refusals: string[],
): IntegratedRiskResult {
  return {
    simulated: false,
    seed: input.seed,
    iterations: input.iterations,
    sampleCount: 0,
    kernelVersion: INTEGRATED_RISK_KERNEL_VERSION,
    deterministicHours,
    p10Hours: null,
    p50Hours: null,
    p80Hours: null,
    p90Hours: null,
    probabilityOnPlan: null,
    costExposureP50: null,
    costExposureP80: null,
    costBase: input.costBase,
    currency: input.currency,
    delayCostPerDay: input.delayCostPerDay,
    attribution: [],
    criticality: [],
    activitiesWithoutRanges: [],
    refusals,
    reason,
  };
}

/**
 * COMMON RANDOM NUMBERS, AND WHY THE ATTRIBUTION DEPENDS ON THEM.
 *
 * The first version of this file drew every sample from one `mulberry32(seed)`
 * stream: activity durations first, then each risk's occurrence and delay.
 * That looks harmless and destroys the attribution. A risk consumes a VARIABLE
 * number of draws per iteration (one to occur, two more if it does), so
 * suppressing one risk shifts every subsequent draw in the stream — the
 * marginal pass then differs from the full run in the suppressed risk AND in
 * a fresh randomisation of everything else. A risk on an activity with 260
 * hours of float measured a tenth of a day of "contribution" that was pure
 * stream displacement, and a risk with probability 1e-12 moved the P80 by six
 * hours while never once occurring.
 *
 * So each source of randomness gets its OWN stream, seeded from the one
 * recorded seed mixed with a stable key: the activities have a stream, and
 * each risk has a stream keyed by its own id. Suppressing a risk now leaves
 * the activity samples and every other risk's samples byte-identical, which
 * is what makes the difference in P80 attributable to that risk and nothing
 * else. Determinism is unchanged — every stream still derives from the single
 * seed that is recorded in the lineage run.
 *
 * The mix is FNV-1a over the key folded into a splitmix-style avalanche.
 * Adjacent seeds (`seed + i`) would have been cheaper and are correlated in
 * mulberry32's first outputs, which would have put a correlation between two
 * risks that have nothing to do with each other.
 */
function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function streamSeed(seed: number, key: string): number {
  let z = ((seed >>> 0) ^ fnv1a(key)) >>> 0;
  z = (z + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

function hasRange(t: ScheduleTask): boolean {
  return (
    t.optimistic != null &&
    t.pessimistic != null &&
    Number.isFinite(t.optimistic) &&
    Number.isFinite(t.pessimistic) &&
    t.pessimistic > t.optimistic
  );
}

function riskIsSimulable(r: RiskImpact): boolean {
  return (
    Number.isFinite(r.probability) &&
    r.probability > 0 &&
    r.probability <= 1 &&
    Number.isFinite(r.delayDaysOptimistic) &&
    Number.isFinite(r.delayDaysLikely) &&
    Number.isFinite(r.delayDaysPessimistic) &&
    r.delayDaysOptimistic >= 0 &&
    r.delayDaysOptimistic <= r.delayDaysLikely &&
    r.delayDaysLikely <= r.delayDaysPessimistic &&
    r.delayDaysPessimistic > r.delayDaysOptimistic
  );
}

function riskHasCost(r: RiskImpact): boolean {
  return (
    r.costOptimistic != null &&
    r.costLikely != null &&
    r.costPessimistic != null &&
    Number.isFinite(r.costOptimistic) &&
    Number.isFinite(r.costLikely) &&
    Number.isFinite(r.costPessimistic) &&
    r.costPessimistic > r.costOptimistic
  );
}

/** One pass. Returned sorted so percentiles can be read straight off it. */
interface Pass {
  durations: number[];
  /** Total risk-driven money per iteration (direct + delay), or null. */
  costs: number[] | null;
  occurrences: Map<string, number>;
  criticalCount: Map<string, number>;
}

/**
 * The sampler. One implementation, used by the full run and by every marginal
 * pass, so a suppressed-risk pass differs from the full run in exactly one
 * thing: the risk that was suppressed.
 *
 * Every stream is re-seeded from the SAME recorded seed on every pass, and
 * the streams are SPLIT per source (see `streamSeed`). Common random numbers
 * make the marginal difference a property of the risk rather than of sampling
 * noise, which is the whole reason the attribution is worth reading.
 */
function runPass(
  input: IntegratedRiskInput,
  activeRisks: RiskImpact[],
  deterministicHours: number,
): Pass {
  const rngActivity = mulberry32(streamSeed(input.seed, "activities"));
  const rngByRisk = new Map(
    activeRisks.map((r) => [
      r.riskId,
      mulberry32(streamSeed(input.seed, r.riskId)),
    ]),
  );
  const durations: number[] = [];
  const occurrences = new Map<string, number>();
  const criticalCount = new Map<string, number>(
    input.activities.map((t) => [t.id, 0]),
  );
  for (const r of activeRisks) occurrences.set(r.riskId, 0);

  const costed = activeRisks.some(riskHasCost);
  const delayPriced =
    input.delayCostPerDay != null &&
    Number.isFinite(input.delayCostPerDay) &&
    input.delayCostPerDay > 0;
  const costs: number[] | null = costed || delayPriced ? [] : null;

  for (let i = 0; i < input.iterations; i++) {
    const sampled = new Map<string, number>();
    for (const t of input.activities) {
      // NO DEFAULT VARIANCE. An activity with no range is held at its stated
      // duration and its contribution to the spread is understated, which is
      // reported, rather than invented, which is not detectable afterwards.
      sampled.set(
        t.id,
        hasRange(t)
          ? sampleTriangular(
              rngActivity,
              t.optimistic!,
              t.duration,
              t.pessimistic!,
            )
          : t.duration,
      );
    }

    // The risk layer. Occurrence first, then the delay it adds to the
    // activity it names, then its direct cost.
    const directCost = new Map<string, number>();
    for (const r of activeRisks) {
      // Its OWN stream, and a FIXED number of draws per iteration whether it
      // occurs or not: a risk that skipped its delay draw on a miss would
      // shift its own later iterations depending on how often it occurred,
      // which is the same displacement bug one level down.
      const rngRisk = rngByRisk.get(r.riskId)!;
      const occurs = rngRisk() < r.probability;
      const delayDays = sampleTriangular(
        rngRisk,
        r.delayDaysOptimistic,
        r.delayDaysLikely,
        r.delayDaysPessimistic,
      );
      const cost = riskHasCost(r)
        ? sampleTriangular(
            rngRisk,
            r.costOptimistic!,
            r.costLikely!,
            r.costPessimistic!,
          )
        : 0;
      if (!occurs) {
        directCost.set(r.riskId, 0);
        continue;
      }
      occurrences.set(r.riskId, (occurrences.get(r.riskId) ?? 0) + 1);
      const current = sampled.get(r.activityId);
      if (current != null) {
        sampled.set(r.activityId, current + delayDays * HOURS_PER_DAY);
      }
      directCost.set(r.riskId, cost);
    }

    const run = criticalPath(input.activities, sampled);
    durations.push(run.durationHours);
    for (const id of run.criticalPath) {
      criticalCount.set(id, (criticalCount.get(id) ?? 0) + 1);
    }

    if (costs != null) {
      const overrunDays = Math.max(
        0,
        (run.durationHours - deterministicHours) / HOURS_PER_DAY,
      );
      const delayMoney = delayPriced ? overrunDays * input.delayCostPerDay! : 0;
      let direct = 0;
      for (const r of activeRisks) direct += directCost.get(r.riskId) ?? 0;
      // The DELAY half is not split between risks here: allocating a shared
      // overrun needs a rule nobody has agreed. The marginal pass below
      // measures each risk's share instead of assuming one.
      costs.push(direct + delayMoney);
    }
  }

  durations.sort((a, b) => a - b);
  if (costs != null) costs.sort((a, b) => a - b);
  return { durations, costs, occurrences, criticalCount };
}

export function simulateIntegratedRisk(
  input: IntegratedRiskInput,
): IntegratedRiskResult {
  const refusals: string[] = [];
  const deterministic = criticalPath(input.activities);

  // ── THE GATE (D5.15). Before anything is sampled. ────────────────────────
  if (!input.gate?.permitted) {
    const classes = input.gate?.failingClasses ?? [];
    return emptyResult(
      input,
      deterministic.durationHours,
      input.gate?.refusal ??
        "This schedule did not pass its quality diagnostics, so no simulation was run.",
      [
        ...(input.gate?.refusal ? [input.gate.refusal] : []),
        ...classes.map(
          (c) =>
            `Failing defect class: ${c}. Spec II.6 — Monte Carlo on poor logic is not useful, so the simulation is refused rather than run with a caveat.`,
        ),
      ],
    );
  }

  // ── THE LOGIC THIS KERNEL MODELS (before anything is sampled) ───────────
  if (input.logicSupport != null && !input.logicSupport.supported) {
    const reason =
      input.logicSupport.refusal ??
      "This schedule's logic uses relationship types or lags this kernel does not model, so a distribution over it would be a distribution over a different network.";
    return emptyResult(input, deterministic.durationHours, reason, [reason]);
  }
  if (input.logicSupport?.assumptionNote) {
    refusals.push(input.logicSupport.assumptionNote);
  }

  if (!deterministic.valid) {
    return emptyResult(
      input,
      deterministic.durationHours,
      deterministic.reason,
      [deterministic.reason],
    );
  }

  if (!Number.isInteger(input.iterations) || input.iterations < 1) {
    return emptyResult(
      input,
      deterministic.durationHours,
      "Iteration count must be a positive whole number.",
      ["Iteration count must be a positive whole number."],
    );
  }
  if (
    !Number.isInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 4294967295
  ) {
    return emptyResult(
      input,
      deterministic.durationHours,
      "A simulation runs under a recorded 32-bit seed. Without one the result cannot be reproduced, and a result nobody can reproduce is not evidence.",
      [
        "A simulation runs under a recorded 32-bit seed. Without one the result cannot be reproduced, and a result nobody can reproduce is not evidence.",
      ],
    );
  }

  const withoutRanges = input.activities.filter((t) => !hasRange(t));
  const usableRisks = input.risks.filter(riskIsSimulable);
  // BEFORE the sampler, not after it. `usableRisks.length + 2` full passes run
  // in the browser; the cap the server publishes exists so the tab is not
  // asked to freeze, and enforcing it only at the door meant the freeze
  // happened and THEN the result was refused.
  if (
    input.maximumAttributedRisks != null &&
    usableRisks.length > input.maximumAttributedRisks
  ) {
    const reason =
      `${usableRisks.length} risk edges name an activity on this schedule and the published maximum for an attributed run is ${input.maximumAttributedRisks}. ` +
      `Per-risk attribution re-runs the whole simulation once per risk, so this would be ${usableRisks.length + 2} full simulations in one browser tab. Narrow the register to the risks whose ranking is the question.`;
    return emptyResult(input, deterministic.durationHours, reason, [
      ...refusals,
      reason,
    ]);
  }
  const rejectedRisks = input.risks.filter((r) => !riskIsSimulable(r));
  for (const r of rejectedRisks) {
    refusals.push(
      `Risk "${r.riskTitle}" was NOT simulated: its probability or its three-point delay is not a usable range. A risk with a single-point impact would be given a spread by the sampler, which is a distribution nobody estimated.`,
    );
  }

  // ── NOTHING VARIES ───────────────────────────────────────────────────────
  const rangedCount = input.activities.length - withoutRanges.length;
  if (rangedCount === 0 && usableRisks.length === 0) {
    const reason =
      `Nothing on this schedule varies: none of its ${input.activities.length} activity(ies) carries an optimistic and pessimistic duration, and no risk names an activity it threatens. ` +
      `A simulation over fixed durations reproduces the deterministic answer with a confidence interval of zero width — the P80 it printed would equal the plan, which is a spread nobody estimated wearing the authority of a simulation.`;
    return emptyResult(input, deterministic.durationHours, reason, [
      ...refusals,
      reason,
    ]);
  }

  // ── THE FULL RUN ─────────────────────────────────────────────────────────
  const full = runPass(input, usableRisks, deterministic.durationHours);
  const p10 = percentile(full.durations, 0.1);
  const p50 = percentile(full.durations, 0.5);
  const p80 = percentile(full.durations, 0.8);
  const p90 = percentile(full.durations, 0.9);
  const onPlan =
    full.durations.filter((d) => d <= deterministic.durationHours + 1e-9)
      .length / input.iterations;

  // A degenerate sample after all the checks above means the inputs contained
  // ranges that collapse (an optimistic equal to a pessimistic that passed
  // `hasRange` on floating-point equality, say). It is refused, not rounded.
  if (!(p90 > p10)) {
    const reason = `Every iteration produced the same project duration (${p10.toFixed(1)} hours), so the "distribution" has zero width. That is a deterministic answer with percentile labels on it.`;
    return emptyResult(input, deterministic.durationHours, reason, [
      ...refusals,
      reason,
    ]);
  }

  const exposureP50 = full.costs ? percentile(full.costs, 0.5) : null;
  const exposureP80 = full.costs ? percentile(full.costs, 0.8) : null;
  if (full.costs == null) {
    refusals.push(
      "No cost exposure was simulated: no risk carries a direct cost impact and no cost of delay is recorded for this case, so the run measured time only. Spec I.10's chain runs risk → schedule → economics and this one stops at the schedule.",
    );
  }
  if (input.costBase == null || !Number.isFinite(input.costBase)) {
    refusals.push(
      "There is no deterministic cost forecast to add the simulated exposure to, so a TOTAL cost P50/P80 cannot be formed. The exposure percentiles are real and are labelled as exposure — a 'cost P80' made only of the risk half would be a forecast missing the project.",
    );
  }
  if (withoutRanges.length > 0) {
    refusals.push(
      `${withoutRanges.length} of ${input.activities.length} activity(ies) carry no duration range and were held FIXED in every iteration: ${withoutRanges
        .slice(0, 6)
        .map((t) => t.label)
        .join(
          ", ",
        )}${withoutRanges.length > 6 ? ", …" : ""}. Their contribution to the spread is understated, not zero.`,
    );
  }
  if (usableRisks.length > 1) {
    refusals.push(
      "Risks are sampled INDEPENDENTLY. Two risks with a common cause will be understated by this run; modelling a correlation nobody has estimated would be inventing the number that matters most.",
    );
  }

  // ── ATTRIBUTION: one marginal pass per risk (D5.09) ──────────────────────
  // The reference point is a pass with EVERY risk suppressed, at the same
  // seed: the difference between it and the full run is the total exposure
  // the risk register contributes to the commitment percentile.
  const riskFree =
    usableRisks.length > 0
      ? runPass(input, [], deterministic.durationHours)
      : null;
  const totalRiskP80Hours =
    riskFree != null ? p80 - percentile(riskFree.durations, 0.8) : 0;

  const attribution: RiskAttributionRow[] = usableRisks.map((r) => {
    const without = runPass(
      input,
      usableRisks.filter((x) => x.riskId !== r.riskId),
      deterministic.durationHours,
    );
    const p80Without = percentile(without.durations, 0.8);
    const contributionHours = p80 - p80Without;
    const occurrenceRate =
      (full.occurrences.get(r.riskId) ?? 0) / input.iterations;

    let meanCost: number | null = null;
    let p80Cost: number | null = null;
    if (full.costs != null && without.costs != null) {
      // Money attributable to this risk = the total exposure with it minus
      // the total without it, at the same percentile and on the mean. Same
      // marginal definition as the days, so the two columns mean the same
      // thing.
      const meanWith =
        full.costs.reduce((s, v) => s + v, 0) / full.costs.length;
      const meanWithout =
        without.costs.reduce((s, v) => s + v, 0) / without.costs.length;
      meanCost = meanWith - meanWithout;
      p80Cost = percentile(full.costs, 0.8) - percentile(without.costs, 0.8);
    }

    return {
      riskId: r.riskId,
      riskTitle: r.riskTitle,
      activityId: r.activityId,
      occurrenceRate,
      p80HoursContribution: contributionHours,
      p80DaysContribution: contributionHours / HOURS_PER_DAY,
      meanCostContribution: meanCost,
      p80CostContribution: p80Cost,
      reason:
        contributionHours > 1e-9
          ? `Occurred in ${(occurrenceRate * 100).toFixed(0)}% of ${input.iterations} runs and contributes ${(contributionHours / HOURS_PER_DAY).toFixed(1)} day(s) of P80 schedule exposure — measured by re-running the same simulation, at the same seed, with this risk suppressed.`
          : `Occurred in ${(occurrenceRate * 100).toFixed(0)}% of runs and contributes no measurable P80 exposure: the activity it threatens has enough float, in this network, to absorb it. That is a statement about this schedule, not about the risk.`,
    };
  });
  attribution.sort((a, b) => b.p80HoursContribution - a.p80HoursContribution);

  if (attribution.length > 1) {
    const summed = attribution.reduce(
      (acc, a) => acc + a.p80HoursContribution,
      0,
    );
    // A tenth of a day. Below that the difference is percentile granularity
    // rather than interaction, and claiming interaction would be noise
    // dressed as a finding.
    if (Math.abs(summed - totalRiskP80Hours) > 0.1 * HOURS_PER_DAY) {
      refusals.push(
        `Marginal contributions add to ${(summed / HOURS_PER_DAY).toFixed(1)} day(s) while the risk register as a whole contributes ${(totalRiskP80Hours / HOURS_PER_DAY).toFixed(1)} day(s) of P80 exposure. Risks interact through the network — two on parallel paths can each contribute nothing alone and a fortnight together — so the columns are read individually and are deliberately NOT normalised to add up. Normalising would make the numbers agree and stop them being true.`,
      );
    }
  }

  const detTasks = new Map(deterministic.tasks.map((t) => [t.id, t]));
  const criticality = input.activities
    .map((t) => ({
      id: t.id,
      label: t.label,
      criticalityIndex: (full.criticalCount.get(t.id) ?? 0) / input.iterations,
      deterministicFloat: detTasks.get(t.id)?.totalFloat ?? 0,
    }))
    .sort((a, b) => b.criticalityIndex - a.criticalityIndex);

  return {
    simulated: true,
    seed: input.seed,
    iterations: input.iterations,
    sampleCount: full.durations.length,
    kernelVersion: INTEGRATED_RISK_KERNEL_VERSION,
    deterministicHours: deterministic.durationHours,
    p10Hours: p10,
    p50Hours: p50,
    p80Hours: p80,
    p90Hours: p90,
    probabilityOnPlan: onPlan,
    costExposureP50: exposureP50,
    costExposureP80: exposureP80,
    costBase: input.costBase,
    currency: input.currency,
    delayCostPerDay: input.delayCostPerDay,
    attribution,
    criticality,
    activitiesWithoutRanges: withoutRanges.map((t) => t.label),
    refusals,
    reason:
      `${input.iterations} iteration(s) at seed ${input.seed} over ${input.activities.length} activity(ies) and ${usableRisks.length} risk edge(s) — the same seed reproduces this exactly. ` +
      `Deterministic duration ${deterministic.durationHours.toFixed(1)} hours; P50 ${p50.toFixed(1)}, P80 ${p80.toFixed(1)}, P90 ${p90.toFixed(1)}. ` +
      `The plan finishes on time in ${(onPlan * 100).toFixed(0)}% of runs${onPlan < 0.5 ? " — a deterministic date beaten less than half the time is a target, not a forecast" : ""}. ` +
      (attribution.length > 0
        ? `The largest driver of the P80 is "${attribution[0].riskTitle}" at ${attribution[0].p80DaysContribution.toFixed(1)} day(s).`
        : `No risk edge was simulated, so the spread is duration uncertainty alone.`),
  };
}

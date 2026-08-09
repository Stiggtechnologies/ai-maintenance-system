/**
 * Process safety and asset integrity (capability register E2.01–E2.13).
 *
 * THE ARITHMETIC THAT MATTERS MOST: PFD AND ACHIEVED SIL.
 *
 * A safety-instrumented function is specified to a target SIL, and the SIL is
 * a band of average probability of failure on demand. For a low-demand 1oo1
 * function the standard result is
 *
 *     PFD_avg ≈ λ_DU × TI / 2
 *
 * where λ_DU is the dangerous-undetected failure rate and TI the proof-test
 * interval. The consequence people miss: TI is not the interval on the
 * schedule, it is the interval ACTUALLY ACHIEVED. A function proof-tested at
 * 18 months against a 12-month specification has a PFD half again as large as
 * designed, and it may have dropped a SIL band without anyone deciding to
 * accept that. `verifySIF` computes both and says which.
 *
 * REDUNDANCY IN A SIF IS SUBJECT TO COMMON CAUSE, exactly as it is for assets
 * in U2 and for people in E6.09. A 1oo2 arrangement is dominated by its
 * β-factor, not by its redundancy: at β = 10% the common-cause term is
 * typically an order of magnitude larger than the independent-failure term,
 * and a 1oo2 quoted without a β is a claim rather than a calculation.
 *
 * ALARM RATES ARE COMPARED TO EEMUA 191, NOT TO A LOCAL OPINION. An operator
 * receiving more than about six alarms an hour is not being helped by the
 * alarm system, and a flood of ten in ten minutes means the system has stopped
 * conveying information at the moment it is most needed.
 *
 * Pure: no database, no network.
 */

export type SIL = 0 | 1 | 2 | 3 | 4;

/** IEC 61508 low-demand bands: SIL n covers PFD in [1e-(n+1), 1e-n). */
export function silForPfd(pfd: number): SIL {
  if (!(pfd > 0)) return 4;
  if (pfd < 1e-5) return 4; // better than SIL 4 is still reported as 4
  if (pfd < 1e-4) return 4;
  if (pfd < 1e-3) return 3;
  if (pfd < 1e-2) return 2;
  if (pfd < 1e-1) return 1;
  return 0;
}

export interface SIFInput {
  tag: string;
  targetSil: SIL;
  /** Dangerous-undetected failure rate, per hour. */
  lambdaDU: number;
  /** Specified proof-test interval, in months. */
  specifiedIntervalMonths: number;
  /** Months since the last proof test actually happened. */
  monthsSinceLastTest?: number | null;
  architecture?: "1oo1" | "1oo2" | "2oo3";
  /** Common-cause factor. A redundant architecture without one is a claim. */
  betaFactor?: number | null;
}

export interface SIFVerdict {
  tag: string;
  targetSil: SIL;
  designPfd: number;
  designSil: SIL;
  /** PFD using the interval actually achieved, not the one specified. */
  achievedPfd: number | null;
  achievedSil: SIL | null;
  overdueMonths: number;
  meetsTarget: boolean;
  degradedByOverdue: boolean;
  reason: string;
}

const HOURS_PER_MONTH = 730;

/** PFD_avg for the supported architectures, with common cause where given. */
function pfdFor(
  lambdaDU: number,
  intervalHours: number,
  architecture: "1oo1" | "1oo2" | "2oo3",
  beta: number,
): number {
  const lt = lambdaDU * intervalHours;
  switch (architecture) {
    case "1oo1":
      return lt / 2;
    case "1oo2":
      // Independent term plus the common-cause term, which usually dominates.
      return ((1 - beta) * (lt * lt)) / 3 + (beta * lt) / 2;
    case "2oo3":
      return (1 - beta) * (lt * lt) + (beta * lt) / 2;
  }
}

/**
 * Verify a safety-instrumented function against its target.
 *
 * The design PFD uses the specified interval. The achieved PFD uses the
 * interval actually achieved, which is the one the plant is living with.
 */
export function verifySIF(input: SIFInput): SIFVerdict {
  const arch = input.architecture ?? "1oo1";
  const beta = input.betaFactor ?? (arch === "1oo1" ? 0 : 0.1);
  const specHours = input.specifiedIntervalMonths * HOURS_PER_MONTH;

  const designPfd = pfdFor(input.lambdaDU, specHours, arch, beta);
  const designSil = silForPfd(designPfd);

  const since = input.monthsSinceLastTest ?? null;
  const overdue =
    since !== null ? Math.max(0, since - input.specifiedIntervalMonths) : 0;

  const achievedPfd =
    since !== null
      ? pfdFor(input.lambdaDU, Math.max(since, 0) * HOURS_PER_MONTH, arch, beta)
      : null;
  const achievedSil = achievedPfd !== null ? silForPfd(achievedPfd) : null;

  const effectiveSil = achievedSil ?? designSil;
  const meetsTarget = effectiveSil >= input.targetSil;
  const degraded =
    achievedSil !== null && achievedSil < designSil && overdue > 0;

  const fmt = (x: number) => x.toExponential(2);

  let reason: string;
  if (designSil < input.targetSil) {
    reason =
      `Specified as SIL ${input.targetSil}, but at ${input.specifiedIntervalMonths}-month proof testing the design PFD is ${fmt(designPfd)}, which is SIL ${designSil}. ` +
      `The function does not meet its target even when tested on schedule — this is a design or interval problem, not a compliance one.`;
  } else if (since === null) {
    reason =
      `Design PFD ${fmt(designPfd)} at a ${input.specifiedIntervalMonths}-month interval meets SIL ${designSil}. ` +
      `No proof-test date is recorded, so the ACHIEVED integrity is unknown — and a SIL claim rests on the test actually happening, not on the interval being written down.`;
  } else if (degraded) {
    reason =
      `Proof test is ${overdue.toFixed(1)} month(s) overdue (${since} against ${input.specifiedIntervalMonths}). ` +
      `PFD has risen from ${fmt(designPfd)} to ${fmt(achievedPfd as number)}, which is SIL ${achievedSil} against a design of SIL ${designSil} and a target of SIL ${input.targetSil}. ` +
      (meetsTarget
        ? `It still meets the target, but the margin the design bought has been spent.`
        : `IT NO LONGER MEETS ITS TARGET. Nobody decided to accept that; it happened by the test not being done.`);
  } else if (overdue > 0) {
    reason = `Proof test is ${overdue.toFixed(1)} month(s) overdue. PFD has risen from ${fmt(designPfd)} to ${fmt(achievedPfd as number)}, still within SIL ${achievedSil}.`;
  } else {
    reason =
      `Tested within its ${input.specifiedIntervalMonths}-month interval; PFD ${fmt(achievedPfd as number)} meets SIL ${achievedSil} against a target of SIL ${input.targetSil}.` +
      (arch !== "1oo1"
        ? ` ${arch} with a β of ${(beta * 100).toFixed(0)}% — the common-cause term is ${(((beta * input.lambdaDU * specHours) / 2 / designPfd) * 100).toFixed(0)}% of the total, which is what redundancy does and does not buy.`
        : "");
  }

  return {
    tag: input.tag,
    targetSil: input.targetSil,
    designPfd,
    designSil,
    achievedPfd,
    achievedSil,
    overdueMonths: overdue,
    meetsTarget,
    degradedByOverdue: degraded,
    reason,
  };
}

export interface AlarmPeriod {
  operatorHours: number;
  totalAlarms: number;
  /** Highest count seen in any ten-minute window. */
  peakTenMinuteCount?: number | null;
  standingAlarms?: number | null;
  highPriority?: number | null;
  mediumPriority?: number | null;
  lowPriority?: number | null;
}

export interface AlarmVerdict {
  alarmsPerHour: number | null;
  benchmark:
    "acceptable" | "manageable" | "over_demanding" | "unacceptable" | null;
  floodPeriod: boolean;
  priorityDistribution: { high: number; medium: number; low: number } | null;
  findings: string[];
  reason: string;
}

/**
 * Alarm-system performance against EEMUA 191 (E2.09).
 *
 * The benchmarks are external and stated as such: roughly one alarm per ten
 * minutes is acceptable, two is manageable, five is over-demanding and ten is
 * unacceptable. They are not this platform's opinion, and quoting a local
 * target instead is how an alarm system stays broken for a decade.
 */
export function assessAlarms(p: AlarmPeriod): AlarmVerdict {
  if (!(p.operatorHours > 0)) {
    return {
      alarmsPerHour: null,
      benchmark: null,
      floodPeriod: false,
      priorityDistribution: null,
      findings: [],
      reason:
        "No operator-hours are recorded, so an alarm count cannot become a rate. A raw count says nothing without knowing how many operators absorbed it over how long.",
    };
  }

  const perHour = p.totalAlarms / p.operatorHours;
  const benchmark =
    perHour <= 6
      ? ("acceptable" as const)
      : perHour <= 12
        ? ("manageable" as const)
        : perHour <= 30
          ? ("over_demanding" as const)
          : ("unacceptable" as const);

  const flood = (p.peakTenMinuteCount ?? 0) >= 10;
  const findings: string[] = [];

  if (benchmark !== "acceptable")
    findings.push(
      `${perHour.toFixed(1)} alarms per operator-hour against the EEMUA 191 acceptable figure of about 6.`,
    );
  if (flood)
    findings.push(
      `A peak of ${p.peakTenMinuteCount} alarms in ten minutes is a flood: above about 10 the system has stopped conveying information at the moment it is most needed.`,
    );
  if ((p.standingAlarms ?? 0) > 10)
    findings.push(
      `${p.standingAlarms} standing alarms. A permanently active alarm is furniture, and it trains operators to ignore the annunciator.`,
    );

  const hi = p.highPriority ?? 0;
  const me = p.mediumPriority ?? 0;
  const lo = p.lowPriority ?? 0;
  const tot = hi + me + lo;
  const dist =
    tot > 0 ? { high: hi / tot, medium: me / tot, low: lo / tot } : null;
  if (dist && dist.high > 0.1)
    findings.push(
      `${(dist.high * 100).toFixed(0)}% of alarms are high priority against an EEMUA guideline of about 5%. When most things are urgent, nothing is.`,
    );

  return {
    alarmsPerHour: perHour,
    benchmark,
    floodPeriod: flood,
    priorityDistribution: dist,
    findings,
    reason:
      findings.length === 0
        ? `${perHour.toFixed(1)} alarms per operator-hour, within the EEMUA 191 acceptable range, with no flood period recorded.`
        : `Rated ${benchmark.replace(/_/g, " ")} against EEMUA 191. ` +
          findings.join(" "),
  };
}

export interface Barrier {
  id: string | number;
  label: string;
  kind: string;
  /** A barrier with no performance standard is a claim, not a barrier. */
  performanceStandardStated: boolean;
  impaired: boolean;
  /** Common-cause groups this barrier belongs to. */
  commonCauseGroups?: string[];
}

export interface BarrierSet {
  hazard: string;
  /** Barriers preventing the top event. */
  preventive: Barrier[];
  /** Barriers limiting the consequence once it happens. */
  mitigative: Barrier[];
}

export interface BarrierVerdict {
  hazard: string;
  preventiveIntact: number;
  mitigativeIntact: number;
  withoutStandard: string[];
  /** Groups of barriers that share a cause and so cannot fail independently. */
  sharedCause: { group: string; barriers: string[] }[];
  reason: string;
}

/**
 * Barrier health for one hazard (E2.01, E2.02, E2.12).
 *
 * Two things are checked that a barrier count cannot see. A barrier with no
 * stated performance standard is not verifiable and should not be counted as
 * one. And barriers sharing a common cause do not fail independently, so
 * "four preventive barriers" may be one barrier with three copies — the same
 * finding the interdependency slice makes about assets and the workforce slice
 * makes about people.
 */
export function assessBarriers(set: BarrierSet): BarrierVerdict {
  const all = [...set.preventive, ...set.mitigative];
  const withoutStandard = all
    .filter((b) => !b.performanceStandardStated)
    .map((b) => b.label);

  const verifiable = (b: Barrier) => b.performanceStandardStated && !b.impaired;
  const preventiveIntact = set.preventive.filter(verifiable).length;
  const mitigativeIntact = set.mitigative.filter(verifiable).length;

  const groups = new Map<string, string[]>();
  for (const b of all) {
    for (const g of b.commonCauseGroups ?? []) {
      groups.set(g, [...(groups.get(g) ?? []), b.label]);
    }
  }
  const sharedCause = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([group, barriers]) => ({ group, barriers }));

  const parts: string[] = [
    `${preventiveIntact} preventive and ${mitigativeIntact} mitigative barrier${preventiveIntact + mitigativeIntact === 1 ? " is" : "s are"} both verifiable and unimpaired.`,
  ];
  if (withoutStandard.length > 0)
    parts.push(
      `${withoutStandard.length} barrier${withoutStandard.length === 1 ? " has" : "s have"} no stated performance standard (${withoutStandard.join(", ")}) and ${withoutStandard.length === 1 ? "is" : "are"} not counted — a barrier nobody can test is a claim.`,
    );
  const impaired = all.filter((b) => b.impaired);
  if (impaired.length > 0)
    parts.push(
      `${impaired.length} impaired: ${impaired.map((b) => b.label).join(", ")}.`,
    );
  for (const s of sharedCause)
    parts.push(
      `${s.barriers.length} barriers share the cause "${s.group}" (${s.barriers.join(", ")}) and cannot fail independently — counting them separately overstates the defence.`,
    );
  if (preventiveIntact === 0)
    parts.push(
      `NO verifiable, unimpaired preventive barrier remains for this hazard.`,
    );

  return {
    hazard: set.hazard,
    preventiveIntact,
    mitigativeIntact,
    withoutStandard,
    sharedCause,
    reason: parts.join(" "),
  };
}

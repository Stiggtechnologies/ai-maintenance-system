/**
 * Reliability by design (capability register E8.01–E8.14).
 *
 * THE ARITHMETIC THIS MODULE EXISTS FOR.
 *
 * A project is handed an availability target for a system and has to allocate
 * it down to the subsystems that will deliver it. That allocation is not a
 * matter of opinion. For subsystems in series the system availability is the
 * PRODUCT of theirs, so a 99% system across ten series subsystems needs 99.9%
 * from each of them. The common failure is to set a system target and then
 * hand every subsystem the same number, which guarantees the system misses.
 *
 * The allocation is exact rather than approximate:
 *
 *   series:    A_i = A_target ^ (w_i / Σw)     so that ∏ A_i = A_target
 *   parallel:  1 - A_i = (1 - A_target) ^ (w_i / Σw)
 *
 * With equal weights the series case reduces to A_target^(1/n), which is the
 * textbook equal-apportionment result. Weights let a harder subsystem be given
 * a lower share rather than an equal one.
 *
 * THE REFUSAL THAT MATTERS. Where a subsystem's demonstrated availability is
 * below what it is being allocated, the target is not achievable with the
 * equipment proposed. Saying so during design costs a specification change;
 * discovering it in service costs the difference for twenty years.
 *
 * Pure: no database, no network.
 */

export interface Subsystem {
  label: string;
  /** Relative difficulty. Higher weight takes a larger share of unavailability. */
  complexityWeight?: number | null;
  /** What the vendor or fleet history says it actually achieves. */
  demonstrated?: number | null;
}

export interface AllocatedSubsystem {
  label: string;
  allocated: number;
  demonstrated: number | null;
  /** Positive means the subsystem cannot meet what it is being asked for. */
  shortfall: number | null;
  weight: number;
}

export interface AllocationResult {
  feasible: boolean;
  target: number;
  configuration: "series" | "parallel";
  subsystems: AllocatedSubsystem[];
  /** System availability reachable from the demonstrated figures, if all known. */
  achievable: number | null;
  reason: string;
}

/**
 * Allocate a system availability target across its subsystems.
 *
 * `demonstrated` is optional per subsystem; where it is absent the allocation
 * is still produced but feasibility is reported as unknown for that subsystem
 * rather than assumed met, because assuming met is how a target survives
 * design review and fails commissioning.
 */
export function allocateAvailability(
  target: number,
  subsystems: Subsystem[],
  configuration: "series" | "parallel" = "series",
): AllocationResult {
  const refuse = (reason: string): AllocationResult => ({
    feasible: false,
    target,
    configuration,
    subsystems: [],
    achievable: null,
    reason,
  });

  if (!(target > 0 && target < 1)) {
    return refuse(
      `An availability target must sit strictly between 0 and 1. ${target} is not a target, and 1.0 in particular is not achievable by anything that can fail.`,
    );
  }
  if (subsystems.length === 0) {
    return refuse(
      "No subsystems are defined, so there is nothing to allocate the target across. A system-level target with no allocation behind it is a number in a document.",
    );
  }

  const weights = subsystems.map((s) =>
    s.complexityWeight && s.complexityWeight > 0 ? s.complexityWeight : 1,
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const allocated: AllocatedSubsystem[] = subsystems.map((s, i) => {
    const share = weights[i] / totalWeight;
    const a =
      configuration === "series"
        ? Math.pow(target, share)
        : 1 - Math.pow(1 - target, share);
    const demo = s.demonstrated ?? null;
    return {
      label: s.label,
      allocated: a,
      demonstrated: demo,
      shortfall: demo !== null ? Math.max(0, a - demo) : null,
      weight: weights[i],
    };
  });

  const shortfalls = allocated.filter((a) => (a.shortfall ?? 0) > 1e-12);
  const unknown = allocated.filter((a) => a.demonstrated === null);

  // What the proposed equipment actually reaches, if every figure is known.
  const achievable =
    unknown.length === 0
      ? configuration === "series"
        ? allocated.reduce((p, a) => p * (a.demonstrated as number), 1)
        : 1 -
          allocated.reduce((p, a) => p * (1 - (a.demonstrated as number)), 1)
      : null;

  const feasible = shortfalls.length === 0 && unknown.length === 0;

  const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
  const worst = allocated.reduce((w, a) => (a.allocated > w.allocated ? a : w));

  let reason: string;
  if (shortfalls.length > 0) {
    const s = shortfalls.reduce((w, a) =>
      (a.shortfall as number) > (w.shortfall as number) ? a : w,
    );
    reason =
      `A ${pct(target)} ${configuration} target across ${subsystems.length} subsystem(s) requires up to ${pct(worst.allocated)} from a single subsystem. ` +
      `${shortfalls.length} subsystem${shortfalls.length === 1 ? " cannot deliver what it is" : "s cannot deliver what they are"} allocated — the worst is ${s.label}, allocated ${pct(s.allocated)} against ${pct(s.demonstrated as number)} demonstrated. ` +
      (achievable !== null
        ? `The proposed equipment reaches ${pct(achievable)}, not ${pct(target)}. `
        : "") +
      `This target is not achievable as specified. Saying so now costs a specification change; finding out in service costs the difference for the life of the asset.`;
  } else if (unknown.length > 0) {
    reason =
      `A ${pct(target)} ${configuration} target across ${subsystems.length} subsystem(s) requires up to ${pct(worst.allocated)} from a single subsystem. ` +
      `${unknown.length} subsystem${unknown.length === 1 ? " has" : "s have"} no demonstrated availability recorded (${unknown.map((u) => u.label).join(", ")}), so feasibility is UNKNOWN rather than met. ` +
      `An allocation nobody has checked against real equipment is a target that survives design review and fails commissioning.`;
  } else {
    reason =
      `A ${pct(target)} ${configuration} target across ${subsystems.length} subsystem(s) requires up to ${pct(worst.allocated)} from a single subsystem, and every subsystem's demonstrated availability meets its allocation. ` +
      `The proposed equipment reaches ${pct(achievable as number)}.`;
  }

  return {
    feasible,
    target,
    configuration,
    subsystems: allocated,
    achievable,
    reason,
  };
}

export interface EarlyLifeRecord {
  assetLabel: string;
  monthsSinceHandover: number;
  attributedTo?: string | null;
  fedBackToDesign?: boolean;
}

export interface EarlyLifeResult {
  total: number;
  withinWindow: number;
  proportionWithin: number | null;
  byAttribution: { attributedTo: string; count: number }[];
  preventableAtDesignOrBuild: number;
  fedBack: number;
  reason: string;
}

/**
 * Early-life failure profile (E8.13).
 *
 * The useful split is not how many failed but WHY, because design,
 * manufacture, installation and commissioning failures are each preventable by
 * a different party at a different stage, and lumping them into "infant
 * mortality" loses the only actionable part.
 */
export function analyseEarlyLife(
  records: EarlyLifeRecord[],
  windowMonths = 12,
): EarlyLifeResult {
  if (records.length === 0) {
    return {
      total: 0,
      withinWindow: 0,
      proportionWithin: null,
      byAttribution: [],
      preventableAtDesignOrBuild: 0,
      fedBack: 0,
      reason:
        "No early-life failures are recorded. On a plant that has commissioned anything, that usually means they were logged as ordinary corrective work rather than that they did not happen — an early-life failure looks identical to any other failure in a work-order system unless someone marks it.",
    };
  }

  const within = records.filter((r) => r.monthsSinceHandover <= windowMonths);
  const counts = new Map<string, number>();
  for (const r of within) {
    const k = r.attributedTo ?? "not_determined";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const byAttribution = [...counts.entries()]
    .map(([attributedTo, count]) => ({ attributedTo, count }))
    .sort((a, b) => b.count - a.count);

  const preventable = within.filter((r) =>
    ["design", "manufacture", "installation", "commissioning"].includes(
      r.attributedTo ?? "",
    ),
  ).length;
  const fedBack = within.filter((r) => r.fedBackToDesign).length;
  const undetermined = counts.get("not_determined") ?? 0;

  return {
    total: records.length,
    withinWindow: within.length,
    proportionWithin:
      records.length > 0 ? within.length / records.length : null,
    byAttribution,
    preventableAtDesignOrBuild: preventable,
    fedBack,
    reason:
      `${within.length} of ${records.length} recorded failure${records.length === 1 ? "" : "s"} fell within ${windowMonths} months of handover. ` +
      (preventable > 0
        ? `${preventable} ${preventable === 1 ? "was" : "were"} attributed to design, manufacture, installation or commissioning — each preventable by a different party at a different stage, which is why "infant mortality" as a single label loses the actionable part. `
        : "") +
      (undetermined > 0
        ? `${undetermined} ${undetermined === 1 ? "was" : "were"} not attributed at all, and an unattributed early-life failure teaches nobody anything. `
        : "") +
      (preventable > 0
        ? fedBack === 0
          ? `NONE has been fed back to design. The next project will buy the same problem.`
          : `${fedBack} of ${preventable} have been fed back to design.`
        : ""),
  };
}

export interface StandardisationInput {
  functionLabel: string;
  makeModel: string;
  count: number;
}

export interface StandardisationResult {
  functions: {
    functionLabel: string;
    variants: number;
    totalUnits: number;
    dominantShare: number;
    reason: string;
  }[];
  reason: string;
}

/**
 * Standardisation (E8.06).
 *
 * Counts distinct make/models doing the same job. Every extra variant is
 * another spares holding, another set of procedures and another training
 * requirement, and the cost of that is carried by maintenance rather than by
 * the project that chose it.
 */
export function assessStandardisation(
  items: StandardisationInput[],
): StandardisationResult {
  const byFunction = new Map<string, StandardisationInput[]>();
  for (const i of items) {
    byFunction.set(i.functionLabel, [
      ...(byFunction.get(i.functionLabel) ?? []),
      i,
    ]);
  }

  const functions = [...byFunction.entries()]
    .map(([functionLabel, group]) => {
      const totalUnits = group.reduce((n, g) => n + g.count, 0);
      const dominant = group.reduce((m, g) => Math.max(m, g.count), 0);
      const share = totalUnits > 0 ? dominant / totalUnits : 0;
      return {
        functionLabel,
        variants: group.length,
        totalUnits,
        dominantShare: share,
        reason:
          group.length === 1
            ? `One make/model across ${totalUnits} unit(s): one spares holding, one set of procedures.`
            : `${group.length} make/models across ${totalUnits} unit(s); the most common covers ${(share * 100).toFixed(0)}%. Each additional variant is another spares holding, another procedure set and another training requirement — carried by maintenance, chosen by the project.`,
      };
    })
    .sort((a, b) => b.variants - a.variants);

  const fragmented = functions.filter((f) => f.variants > 1);
  return {
    functions,
    reason:
      items.length === 0
        ? "No make/model data is recorded, so standardisation cannot be assessed."
        : fragmented.length === 0
          ? `Every function is served by a single make/model across ${functions.length} function(s).`
          : `${fragmented.length} of ${functions.length} function(s) are served by more than one make/model. The most fragmented is ${fragmented[0].functionLabel} with ${fragmented[0].variants}.`,
  };
}

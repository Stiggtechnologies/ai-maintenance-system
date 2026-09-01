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

/* ══════════════ Slice 5B — the frontline design review (D4.10/D4.11) ═══════
 *
 * Spec I.25. The people who will maintain, operate and build a thing review
 * its design BEFORE it is built, and what they recommended — and how it was
 * answered — is recorded.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. The gate consequence, the disposition
 * record and the blocker predicate are server-side and stay there
 * (`case_frontline_design_obligations`, one predicate, four consumers). This
 * module is the vocabulary — pinned against the SQL by the slice migration
 * test — and the REFUSALS a reader has to see, in the same voice
 * `allocateAvailability` uses: an answer that says what is missing beats a
 * number that hides it.
 */

/** Spec I.25's eight review dimensions, verbatim and in its order. */
export const FRONTLINE_DIMENSIONS = [
  { key: "accessibility", label: "Accessibility" },
  { key: "isolation", label: "Isolation" },
  { key: "lifting", label: "Lifting" },
  { key: "inspection", label: "Inspection" },
  { key: "lubrication", label: "Lubrication" },
  { key: "ergonomics", label: "Ergonomics" },
  { key: "removal_route", label: "Removal routes" },
  { key: "emergency_response", label: "Emergency response" },
] as const;

/** Spec I.25's "maintenance/operators/constructors". */
export const FRONTLINE_DISCIPLINES = [
  { key: "maintenance", label: "Maintenance" },
  { key: "operations", label: "Operations" },
  { key: "construction", label: "Construction" },
] as const;

/**
 * Who a disposition may be answered FOR. The three frontline disciplines plus
 * engineering — the design authority answers the room, it does not attend as
 * frontline.
 */
export const DISPOSITION_DISCIPLINES = [
  ...FRONTLINE_DISCIPLINES,
  { key: "engineering", label: "Engineering" },
] as const;

export const DISPOSITION_OUTCOMES = [
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "accepted_with_conditions", label: "Accepted with conditions" },
] as const;

export const FINDING_SEVERITIES = ["blocking", "significant", "minor"] as const;

export interface FrontlineDisposition {
  no: number;
  outcome: string;
  reason: string;
  conditions?: string | null;
  discipline: string;
  by: string;
  at: string;
}

export interface FrontlineFinding {
  id: number;
  findingRef: string;
  dimension: string;
  discipline: string;
  severity: string;
  recommendation: string;
  /** Whose recommendation this is. */
  raisedBy: string;
  /**
   * Who TYPED it (5B-R3). Recording for the room is ordinary, so this is only
   * worth showing when it differs from `raisedBy` — but it must always travel,
   * because a proxy attribution that leaves no trace is how one person puts a
   * recommendation in a colleague's mouth.
   */
  recordedBy?: string | null;
  byProxy?: boolean;
  requirementId?: number | null;
  requirementRef?: string | null;
  /**
   * The carrier's verification state (5B-R7). "Carried by REQ-04" is only good
   * news while REQ-04 still stands; a `failed` or `waived` carrier is a gate
   * blocker in its own right and must not read as a discharge.
   */
  requirementVerification?: string | null;
  dispositions: FrontlineDisposition[];
}

export interface FrontlineStudy {
  id: number;
  studyKind: string;
  frontlineKind: boolean;
  performedOn: string | null;
  summary: string | null;
  maintainerParticipated: boolean;
  operatorParticipated: boolean;
  constructorParticipated: boolean;
  findingsCount: number;
  findingsClosed: number;
  participants: {
    id: number;
    participantId: string;
    name: string;
    discipline: string;
    basis: string | null;
  }[];
  findings: FrontlineFinding[];
}

export interface FrontlineReviewPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  studyCount: number;
  studies: FrontlineStudy[];
  findingCount: number | null;
  openFindingCount: number | null;
  dispositionedCount: number | null;
  byDiscipline: Record<string, number>;
  byDimension: Record<string, number>;
  blockers: { type: string; id: number; name: string }[];
  blockerCount: number;
}

export interface FrontlineReading {
  /** A refusal is an ANSWER. Rendered as prose, never as a zero. */
  refused: boolean;
  headline: string;
  /** Named, never a count: which of the eight dimensions nobody looked at. */
  uncoveredDimensions: string[];
  /** Which of the three disciplines has never raised anything. */
  silentDisciplines: string[];
  openFindings: FrontlineFinding[];
  uncarriedAcceptances: FrontlineFinding[];
  /**
   * Accepted, carried, and the requirement carrying it has FAILED verification
   * or was waived (5B-R7). "Carried" stopped meaning "will be built" the moment
   * the carrier went terminal-bad, so these are separated from the discharged
   * ones rather than counted with them.
   */
  failedCarriers: FrontlineFinding[];
  /** True when nobody from the frontline is recorded at a review that needs them. */
  unattendedReviews: FrontlineStudy[];
}

/** The latest disposition on a finding, or null while it stands unanswered. */
export function latestDisposition(
  finding: FrontlineFinding,
): FrontlineDisposition | null {
  if (finding.dispositions.length === 0) return null;
  return finding.dispositions.reduce((a, b) => (b.no > a.no ? b : a));
}

/**
 * Read a frontline review payload (D4.10/D4.11).
 *
 * THE REFUSAL THAT MATTERS. "0 open findings" and "no review happened" render
 * identically on a screen and mean opposite things — one is a design somebody
 * examined, the other is a design nobody has looked at. The server refuses
 * both empty cases; this function refuses to paint over that refusal, and
 * refuses one more thing the server cannot see: it will not present a count
 * when the payload says the count is absent.
 */
export function readFrontlineReview(
  payload: FrontlineReviewPayload,
): FrontlineReading {
  const studies = payload.studies ?? [];
  const findings = studies.flatMap((s) => s.findings ?? []);
  const open = findings.filter((f) => latestDisposition(f) === null);
  const uncarried = findings.filter((f) => {
    const d = latestDisposition(f);
    return (
      d !== null &&
      (d.outcome === "accepted" || d.outcome === "accepted_with_conditions") &&
      !f.requirementId
    );
  });
  const failedCarriers = findings.filter((f) => {
    const d = latestDisposition(f);
    return (
      d !== null &&
      (d.outcome === "accepted" || d.outcome === "accepted_with_conditions") &&
      !!f.requirementId &&
      (f.requirementVerification === "failed" ||
        f.requirementVerification === "waived")
    );
  });
  const unattended = studies.filter(
    (s) =>
      s.frontlineKind &&
      !s.maintainerParticipated &&
      !s.operatorParticipated &&
      !s.constructorParticipated,
  );
  const seenDimensions = new Set(findings.map((f) => f.dimension));
  const uncoveredDimensions = FRONTLINE_DIMENSIONS.filter(
    (d) => !seenDimensions.has(d.key),
  ).map((d) => d.label);
  const seenDisciplines = new Set(findings.map((f) => f.discipline));
  const silentDisciplines = FRONTLINE_DISCIPLINES.filter(
    (d) => !seenDisciplines.has(d.key),
  ).map((d) => d.label);

  if (payload.refused) {
    return {
      refused: true,
      headline:
        payload.refusal ??
        "This review refuses to report a figure, and did not say why — treat it as no answer rather than as a good one.",
      uncoveredDimensions,
      silentDisciplines,
      openFindings: open,
      uncarriedAcceptances: uncarried,
      failedCarriers,
      unattendedReviews: unattended,
    };
  }

  // The server said it computed a figure. If the figure is absent anyway, the
  // honest reading is the refusal, not a zero invented here.
  if (payload.findingCount == null || payload.openFindingCount == null) {
    return {
      refused: true,
      headline:
        "The server reported a frontline review without a finding count. A missing count is not zero findings, and this panel will not render it as one.",
      uncoveredDimensions,
      silentDisciplines,
      openFindings: open,
      uncarriedAcceptances: uncarried,
      failedCarriers,
      unattendedReviews: unattended,
    };
  }

  const parts: string[] = [
    `${payload.findingCount} recommendation${payload.findingCount === 1 ? "" : "s"} from ${studies.length} review${studies.length === 1 ? "" : "s"}, ${payload.openFindingCount} still unanswered.`,
  ];
  if (uncarried.length > 0) {
    parts.push(
      `${uncarried.length} ${uncarried.length === 1 ? "was accepted and no design requirement carries it" : "were accepted and no design requirement carries them"} — accepting a recommendation in the room and never building it is the failure this record exists to stop.`,
    );
  }
  if (failedCarriers.length > 0) {
    parts.push(
      `${failedCarriers.length} accepted recommendation${failedCarriers.length === 1 ? " is" : "s are"} carried only by a design requirement that has failed verification or been waived — that link discharges nothing, and the gate still refuses over ${failedCarriers.length === 1 ? "it" : "them"}.`,
    );
  }
  if (unattended.length > 0) {
    parts.push(
      `${unattended.length} review${unattended.length === 1 ? "" : "s"} of a kind spec I.25 requires the frontline to attend ${unattended.length === 1 ? "has" : "have"} nobody recorded in the room.`,
    );
  }
  if (silentDisciplines.length > 0) {
    parts.push(
      `Nothing has been raised by ${silentDisciplines.join(" or ")} — a discipline that raised nothing usually was not asked.`,
    );
  }
  if (uncoveredDimensions.length > 0) {
    parts.push(
      `${uncoveredDimensions.length} of the eight dimensions carry no finding at all (${uncoveredDimensions.join(", ")}); that is a gap in coverage, not a clean result.`,
    );
  }

  return {
    refused: false,
    headline: parts.join(" "),
    uncoveredDimensions,
    silentDisciplines,
    openFindings: open,
    uncarriedAcceptances: uncarried,
    failedCarriers,
    unattendedReviews: unattended,
  };
}

/* ══════════════════ Slice 5B — six-axis design scoring (D4.12) ════════════
 *
 * Spec I.26: "Formalize: Design Readiness, Constructability, Operability,
 * Maintainability, Reliability, Commissionability. A design can be technically
 * correct and score poorly on any of these."
 *
 * RULING (mirrored from 20261205090100 ruling 2): the composite is computed
 * ONCE, server-side, so the number on the screen and the number in the
 * calculation_runs lineage row are the same number. Nothing here recomputes
 * it. What this module adds is the vocabulary — pinned against the SQL by the
 * migration test — and a CLIENT-SIDE BACKSTOP: a composite that arrives
 * alongside an unscored axis is refused rather than displayed, because a
 * server regression that started averaging five axes would otherwise render as
 * a healthy design.
 */

export const DESIGN_AXES = [
  {
    key: "design_readiness",
    label: "Design readiness",
    hint: "Is the design finished enough to build from?",
  },
  {
    key: "constructability",
    label: "Constructability",
    hint: "Can it be built safely, in this sequence, with this access?",
  },
  {
    key: "operability",
    label: "Operability",
    hint: "Can it be run, started, stopped and turned down by the people who will run it?",
  },
  {
    key: "maintainability",
    label: "Maintainability",
    hint: "Can it be isolated, reached, lifted and put back?",
  },
  {
    key: "reliability",
    label: "Reliability",
    hint: "Will it keep working at the availability it was justified on?",
  },
  {
    key: "commissionability",
    label: "Commissionability",
    hint: "Can it be tested and handed over without inventing a temporary plant?",
  },
] as const;

export const DESIGN_AXIS_SCALE = {
  min: 1,
  max: 5,
  anchors: {
    1: "will not work as drawn",
    2: "workable only with significant rework",
    3: "workable with known compromises",
    4: "sound, with minor issues named",
    5: "nothing further is needed",
  },
} as const;

export interface DesignAxisRow {
  axis: string;
  score: number | null;
  basis: string | null;
  scoredBy: string | null;
  scoredAt: string | null;
  scored: boolean;
  history?: { score: number; no: number; at: string; basis: string }[];
}

export interface DesignScorecardPayload {
  caseId: string;
  refused: boolean;
  refusal: string | null;
  axes: DesignAxisRow[];
  scoredAxisCount: number;
  axisCount: number;
  missingAxes: string[];
  composite: number | null;
  weakestAxis: { axis: string; score: number } | null;
}

export interface DesignScorecardReading {
  refused: boolean;
  /** Present ONLY when every axis is scored. Never a partial mean. */
  composite: number | null;
  headline: string;
  /** Labelled, never keyed: what a reader is told is missing. */
  missingAxisLabels: string[];
  rows: (DesignAxisRow & { label: string; hint: string })[];
}

const axisLabel = (key: string) =>
  DESIGN_AXES.find((a) => a.key === key)?.label ?? key;

/**
 * Read a six-axis scorecard (D4.12).
 *
 * THE REFUSAL THAT MATTERS, and it is `allocateAvailability`'s: a design
 * scored 4/5 on five axes and never scored on the sixth does not score 4.0. It
 * scores NOTHING, and the answer names the axis — because the axis nobody
 * scored is usually the axis nobody owns, which is exactly the axis a partial
 * mean would hide.
 */
export function readDesignScorecard(
  payload: DesignScorecardPayload,
): DesignScorecardReading {
  const rows = DESIGN_AXES.map((a) => {
    const row = (payload.axes ?? []).find((r) => r.axis === a.key);
    return {
      axis: a.key,
      score: row?.score ?? null,
      basis: row?.basis ?? null,
      scoredBy: row?.scoredBy ?? null,
      scoredAt: row?.scoredAt ?? null,
      scored: row?.scored ?? false,
      history: row?.history ?? [],
      label: a.label,
      hint: a.hint,
    };
  });
  const missing = rows.filter((r) => !r.scored).map((r) => r.label);

  // THE BACKSTOP. Two ways the payload can be wrong, and both render as a
  // healthy design if they are believed: a composite beside an unscored axis,
  // and a composite the server itself marked refused.
  if (missing.length > 0 || payload.refused) {
    return {
      refused: true,
      composite: null,
      headline:
        missing.length > 0 && payload.composite != null
          ? `A composite arrived for a design with ${missing.length} unscored axis/axes (${missing.join(", ")}). It is not shown: the mean of the axes that do have scores reads highest exactly when the missing axis is the bad one.`
          : (payload.refusal ??
            `This design has ${payload.scoredAxisCount} of ${payload.axisCount} axes scored, so there is no composite. Unscored: ${missing.join(", ") || "unknown"}.`),
      missingAxisLabels: missing,
      rows,
    };
  }

  if (payload.composite == null) {
    return {
      refused: true,
      composite: null,
      headline:
        "Every axis is scored and no composite came back. A missing composite is not a good composite; treat this as no answer.",
      missingAxisLabels: [],
      rows,
    };
  }

  const weakest = payload.weakestAxis;
  return {
    refused: false,
    composite: payload.composite,
    headline:
      `All six axes are scored. Composite ${payload.composite.toFixed(2)} of 5.` +
      (weakest
        ? ` The weakest is ${axisLabel(weakest.axis)} at ${weakest.score} — a design averaging well with one low axis is a design that will fail in exactly that way, and the average is the part that hides it.`
        : ""),
    missingAxisLabels: [],
    rows,
  };
}

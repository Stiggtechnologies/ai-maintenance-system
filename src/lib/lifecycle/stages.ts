/**
 * Whole-life stage gates (capability register U4.01–U4.07, U4.10–U4.14).
 *
 * Extends the lifecycle module that already holds the repair/replace economics
 * (see ./index.ts). That module answers "which option is better"; this one
 * answers "has anyone actually taken the decision, and on what basis".
 *
 * THE DISTINCTION THAT MATTERS HERE. A criterion can be met, not met, or NOT
 * ASSESSED, and the third is not a softer version of the first. A gate where
 * half the criteria were never looked at is not half-ready, it is unready with
 * a smaller evidence base, and `assessGate` says so in those words.
 *
 * THE OTHER ONE. A stage an asset was PLACED in by inheriting a register is
 * not a stage it passed a gate to reach. Every count here separates the two,
 * because a fully staged asset register with no gate records behind it looks
 * like maturity and is bookkeeping.
 *
 * Pure: no database, no network.
 */

export type CriterionStatus = "met" | "not_met" | "not_assessed";

export interface GateCriterion {
  id?: number | string;
  criterion: string;
  isMandatory: boolean;
  guidance?: string | null;
}

export interface GateFinding {
  criterion: string;
  status: CriterionStatus;
  evidence?: string | null;
}

export interface GateAssessment {
  ready: boolean;
  metCount: number;
  notMet: string[];
  notAssessed: string[];
  /** Mandatory criteria with no finding recorded at all. */
  missingFindings: string[];
  advisoryOutstanding: string[];
  reason: string;
}

/**
 * Can this gate be passed on the evidence recorded?
 *
 * A mandatory criterion blocks unless it is explicitly met. Silence blocks
 * too: a criterion with no finding is treated exactly like one assessed and
 * found wanting, because the alternative is a gate that passes on the strength
 * of nobody having looked.
 */
export function assessGate(
  criteria: GateCriterion[],
  findings: GateFinding[],
): GateAssessment {
  if (criteria.length === 0) {
    return {
      ready: false,
      metCount: 0,
      notMet: [],
      notAssessed: [],
      missingFindings: [],
      advisoryOutstanding: [],
      reason:
        "No gate criteria are defined for this stage. A gate with no criteria blocks nothing, which looks like control and is not — define what leaving this stage requires before recording a review against it.",
    };
  }

  const byCriterion = new Map<string, GateFinding>();
  for (const f of findings) byCriterion.set(f.criterion.trim(), f);

  const mandatory = criteria.filter((c) => c.isMandatory);
  const advisory = criteria.filter((c) => !c.isMandatory);

  const notMet: string[] = [];
  const notAssessed: string[] = [];
  const missing: string[] = [];
  let met = 0;

  for (const c of mandatory) {
    const f = byCriterion.get(c.criterion.trim());
    if (!f) {
      missing.push(c.criterion);
    } else if (f.status === "met") {
      met += 1;
    } else if (f.status === "not_met") {
      notMet.push(c.criterion);
    } else {
      notAssessed.push(c.criterion);
    }
  }

  const advisoryOutstanding = advisory
    .filter((c) => byCriterion.get(c.criterion.trim())?.status !== "met")
    .map((c) => c.criterion);

  const blocking = notMet.length + notAssessed.length + missing.length;
  const ready = blocking === 0;

  const parts: string[] = [];
  if (ready) {
    parts.push(
      `All ${mandatory.length} mandatory criteria are met on recorded evidence.`,
    );
    if (advisoryOutstanding.length > 0)
      parts.push(
        `${advisoryOutstanding.length} advisory criterion/criteria remain outstanding and do not block.`,
      );
  } else {
    parts.push(
      `${met} of ${mandatory.length} mandatory criteria are met; the gate is not ready.`,
    );
    if (notMet.length > 0) parts.push(`${notMet.length} assessed and not met.`);
    if (notAssessed.length > 0)
      parts.push(
        `${notAssessed.length} recorded as NOT ASSESSED — which is not a softer form of met, and blocks for the same reason.`,
      );
    if (missing.length > 0)
      parts.push(
        `${missing.length} mandatory criterion/criteria have no finding at all; silence is treated as unmet, because the alternative is a gate that passes on nobody having looked.`,
      );
  }

  return {
    ready,
    metCount: met,
    notMet,
    notAssessed,
    missingFindings: missing,
    advisoryOutstanding,
    reason: parts.join(" "),
  };
}

export interface StageRef {
  stageKey: string;
  label: string;
  phase: "pre_service" | "in_service" | "end_of_life";
  stageOrder: number;
}

export interface StageOccupancy {
  stageKey: string;
  assetCount: number;
  gatedCount: number;
}

export interface WholeLifeCoverage {
  byPhase: {
    phase: string;
    stages: number;
    assetsHere: number;
    gatedHere: number;
  }[];
  totalAssets: number;
  totalGated: number;
  /** Stages the organisation has never placed an asset in. */
  unusedStages: string[];
  reason: string;
}

/**
 * How much of the whole-life model this organisation actually operates.
 *
 * The interesting number is `totalGated`, not `totalAssets`. An asset register
 * where every row carries a stage and none of them was reached through a gate
 * describes where things are, not how they got there.
 */
export function wholeLifeCoverage(
  stages: StageRef[],
  occupancy: StageOccupancy[],
): WholeLifeCoverage {
  const occ = new Map(occupancy.map((o) => [o.stageKey, o]));
  const phases = ["pre_service", "in_service", "end_of_life"] as const;

  const byPhase = phases.map((phase) => {
    const inPhase = stages.filter((s) => s.phase === phase);
    return {
      phase,
      stages: inPhase.length,
      assetsHere: inPhase.reduce(
        (n, s) => n + (occ.get(s.stageKey)?.assetCount ?? 0),
        0,
      ),
      gatedHere: inPhase.reduce(
        (n, s) => n + (occ.get(s.stageKey)?.gatedCount ?? 0),
        0,
      ),
    };
  });

  const totalAssets = byPhase.reduce((n, p) => n + p.assetsHere, 0);
  const totalGated = byPhase.reduce((n, p) => n + p.gatedHere, 0);
  const unusedStages = stages
    .filter((s) => (occ.get(s.stageKey)?.assetCount ?? 0) === 0)
    .map((s) => s.label);

  let reason: string;
  if (totalAssets === 0) {
    reason = "No asset carries a lifecycle stage.";
  } else if (totalGated === 0) {
    reason =
      `All ${totalAssets} staged asset${totalAssets === 1 ? "" : "s"} reached ${totalAssets === 1 ? "its" : "their"} stage by inheriting an existing register, ` +
      `not by passing a gate. That describes where things are, not how they got there — and it is the ` +
      `normal starting point, not a failing. The distinction only stops mattering once assets start ` +
      `moving through gates on this platform.`;
  } else {
    reason =
      `${totalGated} of ${totalAssets} staged assets reached their current stage through a recorded gate; ` +
      `the remaining ${totalAssets - totalGated} inherited it.`;
  }

  const preService = byPhase.find((p) => p.phase === "pre_service");
  if (preService && preService.assetsHere === 0 && totalAssets > 0) {
    reason += ` No asset is in a pre-service stage, so the decisions that set most of the whole-life cost — need, options, concept, design, procurement — are outside what this platform has seen.`;
  }

  return { byPhase, totalAssets, totalGated, unusedStages, reason };
}

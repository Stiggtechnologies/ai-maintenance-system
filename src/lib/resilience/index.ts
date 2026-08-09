/**
 * Enterprise resilience (capability register E11.01–E11.12).
 *
 * A threat scenario is not a new kind of analysis. Wildfire, flood, grid loss,
 * a cyber incident and a sole-source supplier failing are all the same shape
 * of question the interdependency slice already answers: WHICH ASSETS STOP,
 * AND WHAT STOPS WITH THEM. So this module reuses `propagateLoss` from
 * src/lib/interdependency rather than building a second cascade engine — one
 * engine, one set of tests, one place to be wrong.
 *
 * What this module adds is the front half: turning a threat into a set of
 * assets, and being honest about how much of that translation is guesswork.
 *
 * THE TWO HONEST LIMITS, BOTH REPORTED RATHER THAN BURIED.
 *
 * 1. A scenario can only cascade through assets the dependency graph covers.
 *    A wildfire that takes out six assets, four of which have no recorded
 *    dependencies, produces an impact figure that is a floor and not an
 *    estimate. `assessScenario` reports the uncovered count every time.
 *
 * 2. An unexercised scenario is a document. `exerciseStatus` treats a plan
 *    that has never been rehearsed as untested capability, in the same terms
 *    the continuity and process-safety slices use, because the failure mode is
 *    identical: everyone believes the plan works until the day it is needed.
 *
 * OPERATING MODES ARE A STATE MACHINE, NOT A LABEL. Normal, degraded,
 * emergency and recovery differ in who may decide what, and a mode with no
 * entry criteria and no named authority is a word on a dashboard.
 *
 * Pure: no database, no network.
 */

import {
  propagateLoss,
  type DependencyGraph,
  type ImpactedAsset,
} from "../interdependency";

export type ThreatKind =
  | "wildfire"
  | "flood"
  | "extreme_cold"
  | "grid_interruption"
  | "cyber_incident"
  | "supply_chain"
  | "utility_failure"
  | "labour_shortage"
  | "major_equipment_loss"
  | "site_evacuation"
  | "emergency_shutdown"
  | "communications_failure";

export interface Scenario {
  scenarioKey: string;
  title: string;
  threatKind: ThreatKind;
  /** Assets the threat removes directly. */
  directlyAffected: string[];
  lastExercisedOn?: string | null;
  exerciseOutcome?: string | null;
  planReference?: string | null;
}

export interface ScenarioAssessment {
  scenarioKey: string;
  title: string;
  threatKind: ThreatKind;
  directCount: number;
  /** Directly affected assets the dependency graph knows nothing about. */
  uncoveredCount: number;
  uncovered: string[];
  impacted: ImpactedAsset[];
  totalLost: number;
  servicesLost: string[];
  /** True when the figure can be read as an estimate rather than a floor. */
  boundedEstimate: boolean;
  reason: string;
}

/**
 * What stops, given this threat?
 *
 * Delegates the cascade to the interdependency engine. The value added here is
 * the honesty about coverage: an impact number computed over a graph that does
 * not contain half the affected assets is a LOWER BOUND, and calling it an
 * estimate would be the mistake.
 */
export function assessScenario(
  scenario: Scenario,
  graph: DependencyGraph,
): ScenarioAssessment {
  const known = new Set<string>();
  for (const n of graph.nodes) known.add(n.id);
  for (const e of graph.edges) {
    known.add(e.dependent);
    known.add(e.supplier);
  }

  const uncovered = scenario.directlyAffected.filter((a) => !known.has(a));
  const cascade = propagateLoss(graph, scenario.directlyAffected);
  const bounded = uncovered.length === 0 && graph.edges.length > 0;

  return {
    scenarioKey: scenario.scenarioKey,
    title: scenario.title,
    threatKind: scenario.threatKind,
    directCount: scenario.directlyAffected.length,
    uncoveredCount: uncovered.length,
    uncovered,
    impacted: cascade.impacted,
    totalLost: cascade.lostCount,
    servicesLost: cascade.servicesLost,
    boundedEstimate: bounded,
    reason:
      scenario.directlyAffected.length === 0
        ? `No assets are recorded as directly affected by ${scenario.title}, so there is nothing to propagate. A scenario with no exposure mapped is a title.`
        : bounded
          ? `${scenario.title} directly removes ${scenario.directlyAffected.length} asset(s); the dependency graph carries the loss to ${cascade.lostCount} in total.` +
            (cascade.servicesLost.length > 0
              ? ` Services lost: ${cascade.servicesLost.join(", ")}.`
              : "")
          : `${scenario.title} directly removes ${scenario.directlyAffected.length} asset(s) and the graph carries it to ${cascade.lostCount}. ` +
            (uncovered.length > 0
              ? `${uncovered.length} of the directly affected asset(s) have NO recorded dependencies, so nothing downstream of them was counted. `
              : "") +
            (graph.edges.length === 0
              ? `The dependency graph is empty, so this figure is just the direct count. `
              : "") +
            `Treat ${cascade.lostCount} as a FLOOR, not an estimate.`,
  };
}

export interface ExerciseStatus {
  scenarioKey: string;
  exercised: boolean;
  daysSince: number | null;
  stale: boolean;
  reason: string;
}

const DAY = 86_400_000;

/**
 * Has anyone actually rehearsed this?
 *
 * Same standard the continuity and process-safety slices apply: a plan nobody
 * has tested is a document, and the reason is not pedantry — every plan works
 * on paper, which is exactly why the paper proves nothing.
 */
export function exerciseStatus(
  scenario: Scenario,
  asOf: Date = new Date(0),
  staleAfterDays = 730,
): ExerciseStatus {
  if (!scenario.lastExercisedOn) {
    return {
      scenarioKey: scenario.scenarioKey,
      exercised: false,
      daysSince: null,
      stale: true,
      reason: scenario.planReference
        ? `A plan exists (${scenario.planReference}) and has never been exercised. Every plan works on paper, which is exactly why the paper proves nothing.`
        : `Neither a plan nor an exercise is recorded for this scenario.`,
    };
  }
  const days = Math.floor(
    (asOf.getTime() - new Date(scenario.lastExercisedOn).getTime()) / DAY,
  );
  const stale = days > staleAfterDays;
  return {
    scenarioKey: scenario.scenarioKey,
    exercised: true,
    daysSince: days,
    stale,
    reason:
      `Last exercised ${days} day(s) ago` +
      (scenario.exerciseOutcome ? ` (${scenario.exerciseOutcome})` : "") +
      (stale
        ? `, beyond the ${staleAfterDays}-day interval. The people who ran it have probably moved on, which is most of what an exercise is for.`
        : "."),
  };
}

export type ModeKey = "normal" | "degraded" | "emergency" | "recovery";

export interface OperatingMode {
  mode: ModeKey;
  entryCriteria?: string | null;
  exitCriteria?: string | null;
  /** Who may declare this mode. A mode anyone can declare is not a control. */
  declaredByRole?: string | null;
  /** Decisions that change hands in this mode. */
  authorityChanges?: string | null;
}

export interface ModeReadiness {
  defined: number;
  usable: number;
  gaps: { mode: ModeKey; missing: string[] }[];
  reason: string;
}

/**
 * Are the operating modes actually operable? (E11.12)
 *
 * A mode is only usable if somebody knows when it starts, when it ends, who
 * declares it, and what decisions move. Missing any of those and the mode is a
 * word on a dashboard that will not survive the first real event.
 */
export function assessOperatingModes(modes: OperatingMode[]): ModeReadiness {
  const required: ModeKey[] = ["normal", "degraded", "emergency", "recovery"];
  const byMode = new Map(modes.map((m) => [m.mode, m]));

  const gaps: { mode: ModeKey; missing: string[] }[] = [];
  let usable = 0;

  for (const key of required) {
    const m = byMode.get(key);
    if (!m) {
      gaps.push({ mode: key, missing: ["not defined at all"] });
      continue;
    }
    const missing: string[] = [];
    if (!m.entryCriteria?.trim()) missing.push("entry criteria");
    if (!m.exitCriteria?.trim()) missing.push("exit criteria");
    if (!m.declaredByRole?.trim()) missing.push("who declares it");
    if (!m.authorityChanges?.trim()) missing.push("what authority changes");
    if (missing.length === 0) usable += 1;
    else gaps.push({ mode: key, missing });
  }

  return {
    defined: modes.length,
    usable,
    gaps,
    reason:
      usable === required.length
        ? `All four operating modes are defined with entry and exit criteria, a declaring authority and the decisions that move.`
        : `${usable} of ${required.length} operating mode(s) are fully usable. ` +
          gaps
            .map((g) => `${g.mode} is missing ${g.missing.join(", ")}`)
            .join("; ") +
          `. A mode with no entry criteria and no named authority is a word on a dashboard, and it will not survive the first real event.`,
  };
}

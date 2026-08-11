/**
 * The verification loop: whether "we'll know it worked" ever became "we know"
 * (register C4.08; the northstar's closing question).
 *
 * WHY A LOOP METRIC AND NOT A COMPLIANCE METRIC.
 *
 * The C8 gate already forces every released recommendation to state a
 * verification method. That is compliance, and it measures nothing about
 * outcomes: 64 recommendations carried a method while zero outcomes had ever
 * been verified. The loop metric asks the harder questions in order:
 *
 *   was an obligation created → was it executed → what did it show →
 *   did a failed one feed back into learning?
 *
 * THE VERDICT SHAPE.
 *
 * An open loop has three different silent states, and the whole point is to
 * keep them from rendering alike:
 *
 *   unwatched — actioned before the obligation trigger existed. Nothing is
 *               tracking these; their loops are open and invisible.
 *   overdue   — an obligation exists and its date has passed. A verification
 *               that never happens looks identical to one that passed.
 *   pending   — open and in date. The healthy in-flight state.
 *
 * Pure functions. No database, no network.
 */

export interface VerificationPosture {
  actionedRecommendations: number;
  withObligation: number;
  openObligations: number;
  overdue: number;
  achieved: number;
  notAchieved: number;
  inconclusive: number;
  waived: number;
  actionedWithoutObligation: number;
}

export interface LoopAssessment {
  /** Share of actioned recommendations whose loop reached a recorded result. */
  loopClosureRate: number | null;
  /** Share of executed verifications that confirmed the outcome. */
  outcomeSuccessRate: number | null;
  /** The three open states, separated. */
  unwatched: number;
  overdue: number;
  pending: number;
  /** True when a failed verification exists — the loop is exercising, not
   *  just passing. A verification system that has never failed anything has
   *  never been tested by reality. */
  hasRecordedFailure: boolean;
  healthiest: "closing" | "collecting" | "unwatched" | "empty";
  reason: string;
}

export function assessLoop(p: VerificationPosture | null): LoopAssessment {
  if (!p || p.actionedRecommendations === 0) {
    return {
      loopClosureRate: null,
      outcomeSuccessRate: null,
      unwatched: 0,
      overdue: 0,
      pending: 0,
      hasRecordedFailure: false,
      healthiest: "empty",
      reason:
        "No actioned recommendations yet, so there is no loop to assess. This is absence of activity, not a closed loop.",
    };
  }

  const executed = p.achieved + p.notAchieved + p.inconclusive;
  const closure = executed / p.actionedRecommendations;
  const success = executed > 0 ? p.achieved / executed : null;
  const pending = p.openObligations - p.overdue;

  const healthiest: LoopAssessment["healthiest"] =
    p.actionedWithoutObligation > p.withObligation
      ? "unwatched"
      : executed > 0
        ? "closing"
        : "collecting";

  return {
    loopClosureRate: closure,
    outcomeSuccessRate: success,
    unwatched: p.actionedWithoutObligation,
    overdue: p.overdue,
    pending,
    hasRecordedFailure: p.notAchieved > 0,
    healthiest,
    reason:
      `${executed} of ${p.actionedRecommendations} actioned recommendation(s) have a recorded outcome — a loop-closure rate of ${(closure * 100).toFixed(0)}%. ` +
      (success !== null
        ? `Of those executed, ${(success * 100).toFixed(0)}% achieved the intended outcome. `
        : ``) +
      (p.notAchieved > 0
        ? `${p.notAchieved} verification(s) FAILED and fed the learning loop — which is the system working, not failing: a verification process that has never recorded a failure has never been tested by reality. `
        : executed > 0
          ? `No failure has been recorded yet. Until one is, this loop is unproven against the case it exists for. `
          : ``) +
      (p.actionedWithoutObligation > 0
        ? `${p.actionedWithoutObligation} actioned recommendation(s) have NO obligation at all — they predate the trigger, nothing is watching them, and an unwatched loop renders exactly like a closed one. `
        : ``) +
      (p.overdue > 0
        ? `${p.overdue} obligation(s) are past due. Overdue is the number to escalate: a verification that never happens is indistinguishable from one that passed.`
        : `Nothing is past due.`),
  };
}

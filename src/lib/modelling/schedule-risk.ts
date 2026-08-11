/**
 * Shutdown critical-path and schedule-risk analysis (capability register C7.13).
 *
 * Two passes. First the deterministic CPM: forward pass for earliest times,
 * backward pass for latest, float as the difference, critical path as the chain
 * with zero float. Then the stochastic pass: sample every duration and see how
 * often each task is critical.
 *
 * WHY THE SECOND PASS IS THE POINT.
 *
 * A deterministic critical path names one chain and implies everything else has
 * slack. On a real turnaround that is usually wrong: a task with two days of
 * float and a duration that varies by a week is on the critical path far more
 * often than the CPM says, and it gets no attention because the bar chart shows
 * float. The CRITICALITY INDEX — the fraction of simulated runs in which a task
 * lands on the critical path — is what finds those. A task with low float and
 * high variance outranks one with zero float and none.
 *
 * Deterministic given a seed.
 */
import { mulberry32, percentile, sampleTriangular } from "./random";

export interface ScheduleTask {
  id: string;
  label: string;
  /** Most likely duration in hours. */
  duration: number;
  /** Optimistic / pessimistic for the stochastic pass. Null = deterministic. */
  optimistic?: number | null;
  pessimistic?: number | null;
  /** Task ids that must finish before this one starts. */
  predecessors: string[];
}

export interface CpmTask {
  id: string;
  label: string;
  duration: number;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  totalFloat: number;
  isCritical: boolean;
}

export interface CpmResult {
  tasks: CpmTask[];
  durationHours: number;
  criticalPath: string[];
  valid: boolean;
  reason: string;
}

/** Topological order, or null when the network has a cycle. */
function topoSort(tasks: ScheduleTask[]): string[] | null {
  const ids = new Set(tasks.map((t) => t.id));
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    succ.set(t.id, []);
  }
  for (const t of tasks) {
    for (const p of t.predecessors) {
      if (!ids.has(p)) continue;
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
      succ.get(p)!.push(t.id);
    }
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([i]) => i);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id) ?? []) {
      const d = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return order.length === tasks.length ? order : null;
}

export function criticalPath(
  tasks: ScheduleTask[],
  durations?: Map<string, number>,
): CpmResult {
  if (tasks.length === 0) {
    return {
      tasks: [],
      durationHours: 0,
      criticalPath: [],
      valid: false,
      reason: "No tasks. An empty schedule has no critical path.",
    };
  }

  const order = topoSort(tasks);
  if (!order) {
    return {
      tasks: [],
      durationHours: 0,
      criticalPath: [],
      valid: false,
      reason:
        "The task network contains a cycle — some task is, directly or indirectly, its own predecessor. No critical path exists until that is fixed, and any duration computed from a cyclic network would be fiction.",
    };
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dur = (id: string) => durations?.get(id) ?? byId.get(id)!.duration;

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const t = byId.get(id)!;
    const start = Math.max(
      0,
      ...t.predecessors.filter((p) => byId.has(p)).map((p) => ef.get(p) ?? 0),
    );
    es.set(id, start);
    ef.set(id, start + dur(id));
  }

  const projectDuration = Math.max(...[...ef.values()]);

  const succ = new Map<string, string[]>();
  for (const t of tasks) succ.set(t.id, []);
  for (const t of tasks) {
    for (const p of t.predecessors) if (succ.has(p)) succ.get(p)!.push(t.id);
  }

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const successors = succ.get(id) ?? [];
    const finish =
      successors.length === 0
        ? projectDuration
        : Math.min(...successors.map((s) => ls.get(s) ?? projectDuration));
    lf.set(id, finish);
    ls.set(id, finish - dur(id));
  }

  const out: CpmTask[] = tasks.map((t) => {
    const totalFloat = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0);
    return {
      id: t.id,
      label: t.label,
      duration: dur(t.id),
      earliestStart: es.get(t.id) ?? 0,
      earliestFinish: ef.get(t.id) ?? 0,
      latestStart: ls.get(t.id) ?? 0,
      latestFinish: lf.get(t.id) ?? 0,
      totalFloat,
      // Float is computed from durations that may be fractional after
      // sampling, so a tolerance is used rather than an exact zero test.
      isCritical: Math.abs(totalFloat) < 1e-9,
    };
  });

  const critical = out.filter((t) => t.isCritical).map((t) => t.id);

  return {
    tasks: out,
    durationHours: projectDuration,
    criticalPath: critical,
    valid: true,
    reason: `${projectDuration} hour(s) across ${tasks.length} task(s). ${critical.length} task(s) have zero float and are on the deterministic critical path. Float on the rest is only as good as the duration estimates it was computed from — see the criticality index for which of them are at risk of becoming critical.`,
  };
}

export interface CriticalityRow {
  id: string;
  label: string;
  /** Fraction of simulated runs in which this task was on the critical path. */
  criticalityIndex: number;
  deterministicFloat: number;
  deterministicallyCritical: boolean;
  reason: string;
}

export interface ScheduleRiskResult {
  deterministicDuration: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Probability of finishing within the deterministic duration. */
  probabilityOnPlan: number | null;
  criticality: CriticalityRow[];
  /** Tasks with float that are nonetheless often critical. The blind spot. */
  hiddenRisks: CriticalityRow[];
  tasksWithoutRanges: string[];
  simulated: boolean;
  seed: number;
  iterations: number;
  reason: string;
}

export function scheduleRisk(
  tasks: ScheduleTask[],
  iterations = 2000,
  seed = 12345,
): ScheduleRiskResult {
  const deterministic = criticalPath(tasks);

  const empty: ScheduleRiskResult = {
    deterministicDuration: deterministic.durationHours,
    p10: null,
    p50: null,
    p90: null,
    probabilityOnPlan: null,
    criticality: [],
    hiddenRisks: [],
    tasksWithoutRanges: [],
    simulated: false,
    seed,
    iterations,
    reason: deterministic.reason,
  };

  if (!deterministic.valid) return empty;

  const withoutRanges = tasks
    .filter(
      (t) =>
        t.optimistic == null ||
        t.pessimistic == null ||
        !(t.pessimistic > t.optimistic),
    )
    .map((t) => t.label);

  if (withoutRanges.length === tasks.length) {
    return {
      ...empty,
      tasksWithoutRanges: withoutRanges,
      reason:
        deterministic.reason +
        ` No task carries an optimistic and pessimistic duration, so no schedule risk can be computed. A single-point duration expresses certainty the estimate does not have, and simulating it would just reproduce the deterministic answer with a confidence interval of zero width.`,
    };
  }

  const rng = mulberry32(seed);
  const durations: number[] = [];
  const criticalCount = new Map<string, number>(tasks.map((t) => [t.id, 0]));

  for (let i = 0; i < iterations; i++) {
    const sampled = new Map<string, number>();
    for (const t of tasks) {
      if (
        t.optimistic != null &&
        t.pessimistic != null &&
        t.pessimistic > t.optimistic
      ) {
        sampled.set(
          t.id,
          sampleTriangular(rng, t.optimistic, t.duration, t.pessimistic),
        );
      } else {
        sampled.set(t.id, t.duration);
      }
    }
    const run = criticalPath(tasks, sampled);
    durations.push(run.durationHours);
    for (const id of run.criticalPath) {
      criticalCount.set(id, (criticalCount.get(id) ?? 0) + 1);
    }
  }

  durations.sort((a, b) => a - b);
  const p10 = percentile(durations, 0.1);
  const p50 = percentile(durations, 0.5);
  const p90 = percentile(durations, 0.9);
  const onPlan =
    durations.filter((d) => d <= deterministic.durationHours + 1e-9).length /
    iterations;

  const detById = new Map(deterministic.tasks.map((t) => [t.id, t]));

  const criticality: CriticalityRow[] = tasks
    .map((t) => {
      const det = detById.get(t.id)!;
      const index = (criticalCount.get(t.id) ?? 0) / iterations;
      return {
        id: t.id,
        label: t.label,
        criticalityIndex: index,
        deterministicFloat: det.totalFloat,
        deterministicallyCritical: det.isCritical,
        reason:
          det.isCritical && index < 0.5
            ? `On the deterministic critical path but critical in only ${(index * 100).toFixed(0)}% of runs — the plan treats it as driving the date and usually it does not.`
            : !det.isCritical && index >= 0.2
              ? `Shows ${det.totalFloat.toFixed(1)} hour(s) of float on the bar chart but lands on the critical path in ${(index * 100).toFixed(0)}% of runs. Float computed from a single-point estimate is not protection.`
              : `Critical in ${(index * 100).toFixed(0)}% of runs, ${det.totalFloat.toFixed(1)} hour(s) of deterministic float.`,
      };
    })
    .sort((a, b) => b.criticalityIndex - a.criticalityIndex);

  const hidden = criticality.filter(
    (c) => !c.deterministicallyCritical && c.criticalityIndex >= 0.2,
  );

  return {
    deterministicDuration: deterministic.durationHours,
    p10,
    p50,
    p90,
    probabilityOnPlan: onPlan,
    criticality,
    hiddenRisks: hidden,
    tasksWithoutRanges: withoutRanges,
    simulated: true,
    seed,
    iterations,
    reason:
      `Deterministic duration ${deterministic.durationHours.toFixed(1)} hours; simulated P50 ${p50.toFixed(1)}, P90 ${p90.toFixed(1)}. ` +
      `The plan finishes on time in ${(onPlan * 100).toFixed(0)}% of ${iterations} runs${onPlan < 0.5 ? " — a deterministic date that is beaten less than half the time is a target, not a forecast" : ""}. ` +
      (hidden.length > 0
        ? `${hidden.length} task(s) show float on the bar chart and are critical in at least a fifth of runs: ${hidden.map((h) => h.label).join(", ")}. Those are the ones the schedule does not warn about.`
        : `No task with float turned out to be frequently critical.`) +
      (withoutRanges.length > 0
        ? ` ${withoutRanges.length} task(s) carry no duration range and were held fixed, so their contribution to risk is understated, not zero.`
        : ""),
  };
}

import { criticalPath } from "../modelling/schedule-risk";

export interface ProgramProjectInput {
  caseId: string;
  title: string;
  durationMonths: number | null;
  earliestStart: string | null;
  standaloneFinish: string | null;
}

export interface ProgramDependencyInput {
  predecessorCaseId: string;
  successorCaseId: string;
}

export interface ProgramScheduleRow {
  caseId: string;
  title: string;
  critical: boolean;
  standaloneFinish: string | null;
  dependencyAdjustedFinish: string | null;
  dependencyDelayDays: number | null;
  status: "red" | "green" | "unassessed";
  reason: string;
}

export interface ProgramScheduleAnalysis {
  valid: boolean;
  durationMonths: number | null;
  criticalPathCaseIds: string[];
  rows: ProgramScheduleRow[];
  refusals: string[];
  interpretation: string;
}

function date(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addMonths(value: Date, months: number): Date {
  const result = new Date(value);
  const whole = Math.trunc(months);
  result.setUTCMonth(result.getUTCMonth() + whole);
  if (months !== whole) {
    result.setUTCDate(
      result.getUTCDate() + Math.round((months - whole) * 30.4375),
    );
  }
  return result;
}

export function analyzeProgramSchedule(
  projects: ProgramProjectInput[],
  dependencies: ProgramDependencyInput[],
): ProgramScheduleAnalysis {
  const projectIds = new Set(projects.map((project) => project.caseId));
  const refusals: string[] = [];
  const invalidEdges = dependencies.filter(
    (edge) =>
      !projectIds.has(edge.predecessorCaseId) ||
      !projectIds.has(edge.successorCaseId),
  );
  if (invalidEdges.length > 0) {
    refusals.push(
      `${invalidEdges.length} dependency edge(s) point outside the selected program.`,
    );
  }
  const missingDurations = projects.filter(
    (project) => project.durationMonths == null || project.durationMonths <= 0,
  );
  if (missingDurations.length > 0) {
    refusals.push(
      `Duration is missing for: ${missingDurations.map((project) => project.title).join(", ")}.`,
    );
  }
  const missingForecastInputs = projects.filter(
    (project) =>
      !date(project.earliestStart) || !date(project.standaloneFinish),
  );
  if (missingForecastInputs.length > 0) {
    refusals.push(
      `Dependency-adjusted finish is withheld for: ${missingForecastInputs.map((project) => project.title).join(", ")} (earliest start and a deterministic/P80 finish are both required).`,
    );
  }

  const cpm = criticalPath(
    projects.map((project) => ({
      id: project.caseId,
      label: project.title,
      duration: project.durationMonths ?? 0,
      predecessors: dependencies
        .filter((edge) => edge.successorCaseId === project.caseId)
        .map((edge) => edge.predecessorCaseId),
    })),
  );
  if (!cpm.valid) refusals.push(cpm.reason);

  const byId = new Map(projects.map((project) => [project.caseId, project]));
  const adjusted = new Map<string, Date>();
  const remaining = new Set(projects.map((project) => project.caseId));
  while (remaining.size > 0) {
    let progressed = false;
    for (const caseId of remaining) {
      const predecessors = dependencies
        .filter((edge) => edge.successorCaseId === caseId)
        .map((edge) => edge.predecessorCaseId);
      if (predecessors.some((id) => remaining.has(id))) continue;
      const project = byId.get(caseId)!;
      const earliest = date(project.earliestStart);
      const standalone = date(project.standaloneFinish);
      if (earliest && standalone && project.durationMonths != null) {
        const predecessorFinish = predecessors
          .map((id) => adjusted.get(id))
          .filter((value): value is Date => Boolean(value))
          .sort((a, b) => b.getTime() - a.getTime())[0];
        if (predecessorFinish && predecessorFinish > earliest) {
          const plannedDurationFinish = addMonths(
            predecessorFinish,
            project.durationMonths,
          );
          adjusted.set(
            caseId,
            plannedDurationFinish > standalone
              ? plannedDurationFinish
              : standalone,
          );
        } else adjusted.set(caseId, standalone);
      }
      remaining.delete(caseId);
      progressed = true;
    }
    if (!progressed) break;
  }

  const critical = new Set(cpm.criticalPath);
  const rows = projects.map((project): ProgramScheduleRow => {
    const standalone = date(project.standaloneFinish);
    const dependencyAdjusted = adjusted.get(project.caseId) ?? null;
    const delay =
      standalone && dependencyAdjusted
        ? Math.max(
            0,
            Math.round(
              (dependencyAdjusted.getTime() - standalone.getTime()) /
                86_400_000,
            ),
          )
        : null;
    return {
      caseId: project.caseId,
      title: project.title,
      critical: critical.has(project.caseId),
      standaloneFinish: standalone ? iso(standalone) : null,
      dependencyAdjustedFinish: dependencyAdjusted
        ? iso(dependencyAdjusted)
        : null,
      dependencyDelayDays: delay,
      status: delay == null ? "unassessed" : delay > 0 ? "red" : "green",
      reason:
        delay == null
          ? "Required schedule evidence is missing; no adjusted forecast is claimed."
          : delay > 0
            ? `Recorded predecessor dependencies move the earliest feasible finish by ${delay} day(s).`
            : "Recorded predecessor dependencies do not move the current finish forecast.",
    };
  });

  return {
    valid:
      cpm.valid && invalidEdges.length === 0 && missingDurations.length === 0,
    durationMonths: cpm.valid ? cpm.durationHours : null,
    criticalPathCaseIds: cpm.valid ? cpm.criticalPath : [],
    rows,
    refusals,
    interpretation:
      "The cross-project critical path reuses SyncAI's deterministic CPM kernel. Dependency-adjusted dates are evidence-based planning forecasts, not gate passage, sanction, funding, or work authorization.",
  };
}

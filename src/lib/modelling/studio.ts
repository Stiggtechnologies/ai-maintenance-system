import { repairableSummary } from "../reliability";
import { selectWeibullMethod } from "../reliability/method-selection";
import {
  analyseFaultTree,
  eventImportance,
  type FaultTreeNode,
} from "./fault-tree";
import { forecastMaintenanceCost, type CostPeriod } from "./cost-forecast";
import { simulateProduction, type SimUnit } from "./monte-carlo";
import {
  blockImportance,
  evaluateRbd,
  type RbdBlock,
  type RbdGroupSpec,
} from "./rbd";
import { scheduleRisk, type ScheduleTask } from "./schedule-risk";

export interface ModellingTreeSource {
  id: string;
  treeKey: string;
  title: string;
  topEvent: string;
  basis: string;
  reviewed: boolean;
  nodes: Array<{
    rowId?: string | number;
    id: string;
    label: string;
    gate: string | null;
    voteThreshold: number | null;
    parent: string | null;
    probability: number | null;
  }>;
}

export interface ModellingScheduleSource {
  id: string;
  eventKey: string;
  title: string;
  status: string;
  tasks: Array<{
    rowId?: string | number;
    id: string;
    label: string;
    duration: number;
    optimistic: number | null;
    pessimistic: number | null;
    predecessors: string[];
  }>;
}

export interface ModellingCostSource extends CostPeriod {
  eventsCosted?: number;
  eventsWithoutEconomics?: number;
}

export interface ModellingHistoryRow {
  id: string;
  asset_id: string;
  tag: string | null;
  name: string;
  completed_at: string;
  downtime_hours: number;
}

export interface ModellingGraphSource {
  nodes?: Array<{ id: string; tag: string | null; name: string }>;
  edges?: Array<{
    id?: string | number;
    dependent: string;
    supplier: string;
    redundancyGroup?: string | null;
    minRequired?: number | null;
  }>;
  commonCauseGroups?: Array<{
    id: string | number;
    name: string;
    causeKind: string;
    members: string[];
  }>;
}

export interface ModellingStudioSource {
  trees: ModellingTreeSource[];
  schedules: ModellingScheduleSource[];
  cost: ModellingCostSource[];
  posture: Record<string, unknown> | null;
  graph: ModellingGraphSource | null;
  history: ModellingHistoryRow[];
}

function rowsByAsset(rows: ModellingHistoryRow[]) {
  const grouped = new Map<string, ModellingHistoryRow[]>();
  for (const row of rows) {
    const entries = grouped.get(row.asset_id);
    if (entries) entries.push(row);
    else grouped.set(row.asset_id, [row]);
  }
  return grouped;
}

function fitUnits(rows: ModellingHistoryRow[]): SimUnit[] {
  return [...rowsByAsset(rows).entries()].map(([id, events]) => {
    const times = events
      .map((event) => new Date(event.completed_at).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const interarrivalHours: number[] = [];
    for (let index = 1; index < times.length; index++) {
      const hours = (times[index] - times[index - 1]) / 3.6e6;
      if (hours > 0.01) interarrivalHours.push(hours);
    }
    const selection = selectWeibullMethod(interarrivalHours);
    const downtimes = events
      .map((event) => event.downtime_hours)
      .filter((hours) => Number.isFinite(hours) && hours > 0)
      .sort((a, b) => a - b);
    const medianRepairHours =
      downtimes.length === 0
        ? null
        : downtimes[Math.floor(downtimes.length / 2)];
    return {
      id,
      label: events[0].tag ?? events[0].name,
      beta: selection.beta,
      eta: selection.eta,
      medianRepairHours,
      repairSigma: null,
      capacityPerHour: 1,
    };
  });
}

function availabilityByAsset(rows: ModellingHistoryRow[]) {
  const availability = new Map<string, number>();
  for (const [id, events] of rowsByAsset(rows)) {
    const times = events
      .map((event) => new Date(event.completed_at).getTime())
      .filter(Number.isFinite);
    if (times.length === 0) continue;
    const windowHours = Math.max(
      24,
      (Math.max(...times) - Math.min(...times)) / 3.6e6 + 24,
    );
    try {
      availability.set(
        id,
        repairableSummary(
          events.map((event) => event.downtime_hours),
          windowHours,
        ).availability,
      );
    } catch {
      // Missing or invalid history is retained as a null RBD input downstream.
    }
  }
  return availability;
}

export function analyseModellingStudio(source: ModellingStudioSource) {
  const trees = source.trees.map((tree) => {
    const nodes: FaultTreeNode[] = tree.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      gate: (node.gate as FaultTreeNode["gate"]) ?? undefined,
      voteThreshold: node.voteThreshold ?? undefined,
      children: tree.nodes
        .filter((candidate) => candidate.parent === node.id)
        .map((candidate) => candidate.id),
      probability: node.probability,
    }));
    return {
      id: tree.id,
      treeKey: tree.treeKey,
      title: tree.title,
      topEvent: tree.topEvent,
      basis: tree.basis,
      reviewed: tree.reviewed,
      result: analyseFaultTree(nodes, "TOP"),
      importance: eventImportance(nodes, "TOP").slice(0, 4),
    };
  });

  const schedules = source.schedules.map((schedule) => {
    const tasks: ScheduleTask[] = schedule.tasks.map((task) => ({
      id: task.id,
      label: task.label,
      duration: Number(task.duration),
      optimistic: task.optimistic === null ? null : Number(task.optimistic),
      pessimistic: task.pessimistic === null ? null : Number(task.pessimistic),
      predecessors: task.predecessors ?? [],
    }));
    const seed = [...schedule.eventKey].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0,
    );
    return {
      id: schedule.id,
      eventKey: schedule.eventKey,
      title: schedule.title,
      status: schedule.status,
      result: scheduleRisk(tasks, 2000, seed),
    };
  });

  const graph = source.graph;
  const edges = graph?.edges ?? [];
  const labels = new Map(
    (graph?.nodes ?? []).map((node) => [node.id, node.tag ?? node.name]),
  );
  const availability = availabilityByAsset(source.history);
  const commonCauseByAsset = new Map<string, string[]>();
  for (const commonCause of graph?.commonCauseGroups ?? []) {
    for (const member of commonCause.members ?? []) {
      const memberships = commonCauseByAsset.get(member);
      if (memberships) memberships.push(commonCause.name);
      else commonCauseByAsset.set(member, [commonCause.name]);
    }
  }
  const seen = new Set<string>();
  const blocks: RbdBlock[] = [];
  const specifications = new Map<string, RbdGroupSpec>();
  for (const edge of edges) {
    const group = edge.redundancyGroup ?? `${edge.dependent}:${edge.supplier}`;
    if (!specifications.has(group)) {
      specifications.set(group, {
        group,
        minRequired: edge.minRequired ?? 1,
      });
    }
    const identity = `${group}|${edge.supplier}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    blocks.push({
      id: edge.supplier,
      label: labels.get(edge.supplier) ?? edge.supplier,
      reliability: availability.get(edge.supplier) ?? null,
      group,
      commonCauseGroup:
        commonCauseByAsset.get(edge.supplier)?.sort().join("|") ?? null,
    });
  }
  const specificationList = [...specifications.values()].map(
    (specification) => ({
      ...specification,
      betaFactor: blocks.some(
        (block) =>
          block.group === specification.group && block.commonCauseGroup != null,
      )
        ? null
        : undefined,
    }),
  );
  const rbd = {
    result: evaluateRbd(blocks, specificationList),
    importance: blockImportance(blocks, specificationList).slice(0, 4),
    blockCount: blocks.length,
  };

  const units = fitUnits(source.history);
  const simulation = simulateProduction({
    units,
    horizonHours: 8760,
    iterations: 300,
    seed: 20260824,
    targetCapacityPerHour: Math.max(1, units.length),
    capacityBasis: "unweighted",
  });
  const forecast = forecastMaintenanceCost(source.cost, 1);

  return { trees, schedules, rbd, simulation, forecast };
}

export type ModellingStudioAnalysis = ReturnType<typeof analyseModellingStudio>;

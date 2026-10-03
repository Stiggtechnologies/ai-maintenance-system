import { supabase } from "../lib/supabase";

export type TurnaroundReadiness = {
  windowId: string;
  windowKey: string;
  status: string;
  scope: {
    workOrders: number;
    unsized: number;
    lateAdditions: number;
    lateWithoutJustification: number;
    state: string;
  };
  sequence: {
    eventId: string | null;
    tasks: number;
    dependencies: number;
    scopeWithoutTask: number;
    tasksWithoutDates: number;
    tasksWithoutRanges: number;
    danglingDependencies: number;
    cycleDetected: boolean;
    negativeFloatTasks: number;
    tasksOutsideWindow: number;
    state: string;
  };
  readiness: {
    materialBlockedWork: number;
    approvalBlockedWork: number;
    safetyBlockedWork: number;
    state: string;
  };
  blockers: number;
  warnings: number;
  releaseReady: boolean;
  basis: string;
  authority: string;
};

export type TurnaroundWork = {
  outageWorkId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  title: string;
  status: string | null;
  priority: string | null;
  plannedHours: number | null;
  addedAfterFreeze: boolean;
  justification: string | null;
  linkedTaskCount: number;
};

export type TurnaroundTask = {
  taskId: number;
  taskKey: string;
  label: string;
  durationHours: number;
  optimisticHours: number | null;
  pessimisticHours: number | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  totalFloatHours: number | null;
  origin: "local" | "imported";
  outageWorkId: string | null;
};

export type TurnaroundWindow = {
  windowId: string;
  windowKey: string;
  title: string;
  kind: string;
  siteId: string | null;
  siteName: string | null;
  startsAt: string;
  endsAt: string;
  scope: string | null;
  status: string;
  frozenBy: string | null;
  frozenAt: string | null;
  shutdownEventId: string | null;
  scopeReleasedBy: string | null;
  scopeReleasedAt: string | null;
  readiness: TurnaroundReadiness;
  work: TurnaroundWork[];
  tasks: TurnaroundTask[];
  dependencies: Array<{
    dependencyId: number;
    taskKey: string;
    predecessorKey: string;
    linkType: string;
    lagHours: number;
  }>;
};

export type TurnaroundAssessment = {
  runId: string;
  packId: string;
  windowId: string;
  windowKey: string;
  scopeIntegrity: TurnaroundReadiness["scope"];
  sequenceIntegrity: TurnaroundReadiness["sequence"];
  workReadiness: TurnaroundReadiness["readiness"];
  releaseReadiness: {
    status: string;
    blockers: number;
    warnings: number;
    releaseReady: boolean;
    requiredAuthority: string;
    segregationOfDuties: boolean;
  };
  evidenceGaps: Array<{ code: string; severity: string; detail: string }>;
  evidencePlan: Array<{
    sequence: number;
    question: string;
    owner: string;
    completion: string;
  }>;
  interpretation: string;
  limitations: string[];
};

export type TurnaroundWorkspace = {
  windows: TurnaroundWindow[];
  openWork: Array<{
    workOrderId: string;
    workOrderNumber: string | null;
    title: string;
    status: string | null;
    priority: string | null;
    plannedHours: number | null;
    assetId: string | null;
    assetName: string | null;
  }>;
  unlinkedSchedules: Array<{
    shutdownEventId: string;
    eventKey: string;
    title: string;
    plannedStart: string | null;
    plannedDurationHours: number | null;
    status: string;
    taskCount: number;
  }>;
  packs: Array<{
    packId: string;
    windowId: string;
    windowKey: string;
    title: string;
    agentRunId: string;
    assessment: TurnaroundAssessment;
    createdAt: string;
    assignment: null | {
      assignmentId: string;
      assignedTo: string;
      ownerName: string;
      dueDate: string;
      note: string;
    };
  }>;
  members: Array<{ id: string; name: string; role: string }>;
  basis: string;
  error?: string;
};

type RpcReceipt = Record<string, unknown> & { error?: string };

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const payload = data as T & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

export async function loadTurnaroundWorkspace(): Promise<TurnaroundWorkspace> {
  return rpc<TurnaroundWorkspace>("get_turnaround_agent_workspace", { p_limit: 50 });
}

export async function runTurnaroundAgent(windowId: string): Promise<{ packId: string; runId: string }> {
  const payload = await rpc<RpcReceipt>("run_turnaround_agent", { p_window_id: windowId });
  if (typeof payload.packId !== "string" || typeof payload.runId !== "string") {
    throw new Error("Turnaround assessment completed without a durable pack/run receipt.");
  }
  return { packId: payload.packId, runId: payload.runId };
}

export function addOutageWork(windowKey: string, workOrderId: string, justification: string) {
  return rpc<RpcReceipt>("add_work_to_outage", {
    p_window_key: windowKey,
    p_work_order_id: workOrderId,
    p_justification: justification || null,
  });
}

export function freezeOutageScope(windowId: string, note: string) {
  return rpc<RpcReceipt>("freeze_outage_scope", { p_window_id: windowId, p_note: note });
}

export function releaseTurnaroundScope(windowId: string, note: string) {
  return rpc<RpcReceipt>("release_turnaround_scope", {
    p_window_id: windowId,
    p_release_note: note,
  });
}

export function createTurnaroundSchedule(windowId: string, eventKey: string, title: string) {
  return rpc<RpcReceipt>("create_turnaround_schedule", {
    p_window_id: windowId,
    p_event_key: eventKey,
    p_title: title,
  });
}

export function linkOutageSchedule(windowId: string, shutdownEventId: string, basis: string) {
  return rpc<RpcReceipt>("link_outage_shutdown_schedule", {
    p_window_id: windowId,
    p_shutdown_event_id: shutdownEventId,
    p_basis: basis,
  });
}

export function recordTurnaroundActivity(input: {
  windowId: string;
  taskKey: string;
  label: string;
  durationHours: number;
  optimisticHours: number | null;
  pessimisticHours: number | null;
  workOrderId: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
}) {
  return rpc<RpcReceipt>("record_turnaround_schedule_activity", {
    p_window_id: input.windowId,
    p_task_key: input.taskKey,
    p_label: input.label,
    p_duration_hours: input.durationHours,
    p_optimistic_hours: input.optimisticHours,
    p_pessimistic_hours: input.pessimisticHours,
    p_work_order_id: input.workOrderId,
    p_planned_start: input.plannedStart,
    p_planned_finish: input.plannedFinish,
  });
}

export function linkTaskToWork(windowId: string, taskId: number, workOrderId: string) {
  return rpc<RpcReceipt>("link_turnaround_task_to_work", {
    p_window_id: windowId,
    p_task_id: taskId,
    p_work_order_id: workOrderId,
  });
}

export function recordTurnaroundDependency(windowId: string, taskKey: string, predecessorKey: string) {
  return rpc<RpcReceipt>("record_turnaround_task_dependency", {
    p_window_id: windowId,
    p_task_key: taskKey,
    p_predecessor_key: predecessorKey,
  });
}

export function assignTurnaroundReview(packId: string, assignedTo: string, dueDate: string, note: string) {
  return rpc<RpcReceipt>("assign_turnaround_review", {
    p_pack_id: packId,
    p_assigned_to: assignedTo,
    p_due_date: dueDate,
    p_note: note,
  });
}

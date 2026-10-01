import { supabase } from "../lib/supabase";

export interface MaintenanceExecutivePriority {
  priorityKey: string;
  category:
    | "enterprise_performance"
    | "budget"
    | "risk"
    | "maintenance_strategy"
    | "governance"
    | "verified_value";
  severity: "critical" | "high" | "medium" | "information";
  observed: string;
  decisionQuestion: string;
  route: string;
  humanDecisionRequired: true;
}

export interface MaintenanceExecutiveReviewAssignment {
  id: string;
  assignedTo: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  dueDate: string;
  note: string;
  assignedAt: string;
}

export interface MaintenanceExecutiveDisposition {
  id: string;
  priorityKey: string;
  disposition: "acknowledged" | "route_for_action" | "deferred" | "rejected";
  note: string;
  actionReference: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface MaintenanceExecutiveBrief {
  id: string;
  agentRunId: string;
  periodStart: string;
  periodEnd: string;
  informationSensitivity: "public" | "internal" | "confidential" | "restricted";
  sourceSnapshot: Record<string, unknown>;
  facts: Record<string, Record<string, unknown>>;
  priorities: MaintenanceExecutivePriority[];
  limitations: string[];
  createdBy: string;
  createdAt: string;
  assignments: MaintenanceExecutiveReviewAssignment[];
  dispositions: MaintenanceExecutiveDisposition[];
}

export interface MaintenanceExecutiveReviewer {
  id: string;
  name: string | null;
  email: string | null;
  role: "executive" | "maintenance_manager" | "admin";
}

export interface MaintenanceExecutiveWorkspace {
  briefs: MaintenanceExecutiveBrief[];
  reviewers: MaintenanceExecutiveReviewer[];
  basis: string;
}

function rpcError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    return typeof value === "string"
      ? value
      : "Maintenance-executive request failed.";
  }
  return null;
}

async function governedRpc<T>(name: string, args?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as T;
}

export function loadMaintenanceExecutiveWorkspace() {
  return governedRpc<MaintenanceExecutiveWorkspace>(
    "get_maintenance_executive_workspace",
  );
}

export function runMaintenanceExecutiveAgent(input: {
  periodStart: string;
  periodEnd: string;
}) {
  return governedRpc<{
    briefId: string;
    runId: string;
    facts: Record<string, Record<string, unknown>>;
    priorities: MaintenanceExecutivePriority[];
    advisory: true;
  }>("run_maintenance_executive_agent", {
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
  });
}

export function assignMaintenanceExecutiveReview(input: {
  briefId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}) {
  return governedRpc<{ assignmentId: string; status: "assigned" }>(
    "assign_maintenance_executive_review",
    {
      p_brief_id: input.briefId,
      p_assigned_to: input.assignedTo,
      p_due_date: input.dueDate,
      p_note: input.note,
    },
  );
}

export function recordMaintenanceExecutiveDisposition(input: {
  briefId: string;
  priorityKey: string;
  disposition: "acknowledged" | "route_for_action" | "deferred" | "rejected";
  note: string;
  actionReference?: string | null;
}) {
  return governedRpc<{
    dispositionId: string;
    status: string;
    approvalGranted: false;
    riskAccepted: false;
    spendCommitted: false;
    workReleased: false;
    strategyChanged: false;
    operationalAuthorization: false;
  }>("record_maintenance_executive_disposition", {
    p_brief_id: input.briefId,
    p_priority_key: input.priorityKey,
    p_disposition: input.disposition,
    p_note: input.note,
    p_action_reference: input.actionReference ?? null,
  });
}

import { supabase } from "../lib/supabase";

export interface ExecutiveReviewAssignment {
  id: string;
  assignedTo: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  dueDate: string;
  note: string;
  assignedAt: string;
}

export interface ExecutiveAcknowledgement {
  id: string;
  disposition: "acknowledged" | "challenged" | "update_requested";
  reviewNote: string;
  evidenceReference: string | null;
  reviewedBy: string;
  reviewerName: string | null;
  reviewedAt: string;
}

export interface MaintenanceExecutiveBriefing {
  id: string;
  agentRunId: string;
  asOf: string;
  sourceSnapshot: Record<string, unknown>;
  performance: Record<string, unknown>;
  governance: Record<string, unknown>;
  budgets: Record<string, unknown>;
  risks: Record<string, unknown>;
  strategy: Record<string, unknown>;
  evidenceGaps: Array<Record<string, unknown>>;
  limitations: string[];
  createdBy: string;
  createdAt: string;
  assignments: ExecutiveReviewAssignment[];
  acknowledgements: ExecutiveAcknowledgement[];
}

export interface ExecutiveReviewer {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

export interface MaintenanceExecutiveWorkspace {
  briefings: MaintenanceExecutiveBriefing[];
  reviewers: ExecutiveReviewer[];
  basis: string;
}

function rpcIssue(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const error = (data as { error?: unknown }).error;
  return typeof error === "string"
    ? error
    : "Maintenance Executive request failed.";
}

async function governedRpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const issue = rpcIssue(data);
  if (issue) throw new Error(issue);
  return data as T;
}

export function loadMaintenanceExecutiveWorkspace() {
  return governedRpc<MaintenanceExecutiveWorkspace>(
    "get_maintenance_executive_workspace",
  );
}

export function runMaintenanceExecutiveAgent() {
  return governedRpc<{
    briefingId: string;
    runId: string;
    advisory: true;
    mayApprove: false;
    mayAcceptRisk: false;
    mayAdoptStrategy: false;
    mayCommitSpend: false;
    mayReleaseWork: false;
    mayChangeOperatingLimits: false;
    mayReturnToService: false;
  }>("run_maintenance_executive_agent");
}

export function assignMaintenanceExecutiveReview(input: {
  briefingId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}) {
  return governedRpc<{ assignmentId: string; status: "assigned" }>(
    "assign_maintenance_executive_review",
    {
      p_briefing_id: input.briefingId,
      p_assigned_to: input.assignedTo,
      p_due_date: input.dueDate,
      p_note: input.note,
    },
  );
}

export function acknowledgeMaintenanceExecutiveBriefing(input: {
  briefingId: string;
  disposition: "acknowledged" | "challenged" | "update_requested";
  reviewNote: string;
  evidenceReference?: string | null;
}) {
  return governedRpc<{
    acknowledgementId: string;
    status: string;
    approvalCreated: false;
    riskAccepted: false;
    strategyAdopted: false;
    spendCommitted: false;
    operationalAuthorization: false;
  }>("acknowledge_maintenance_executive_briefing", {
    p_briefing_id: input.briefingId,
    p_disposition: input.disposition,
    p_review_note: input.reviewNote,
    p_evidence_reference: input.evidenceReference ?? null,
  });
}

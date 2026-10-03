import { supabase } from "../lib/supabase";
import type {
  DecisionCaseInvitation,
  DecisionCaseInvitationStatus,
} from "../lib/onboarding/decision-case-spine";

interface InvitationResponse {
  status?: DecisionCaseInvitationStatus;
  name?: string;
  email?: string;
  detail?: string;
  invitedUserId?: string | null;
  submittedAt?: string | null;
  lastCheckedAt?: string;
  error?: string;
}

function unwrapInvitation(
  data: unknown,
  fallback: string,
): DecisionCaseInvitation {
  const value = (data ?? {}) as InvitationResponse;
  if (value.error) throw new Error(value.error);
  if (!value.status || !value.email || !value.lastCheckedAt) {
    throw new Error(fallback);
  }
  return {
    name: value.name ?? "",
    email: value.email,
    status: value.status,
    detail: value.detail ?? "Invitation status returned without detail.",
    invitedUserId: value.invitedUserId ?? null,
    submittedAt: value.submittedAt ?? null,
    lastCheckedAt: value.lastCheckedAt,
  };
}

async function invokeInvitation(
  body: Record<string, unknown>,
  fallback: string,
): Promise<DecisionCaseInvitation> {
  const { data, error } = await supabase.functions.invoke(
    "decision-case-invite",
    { body },
  );
  if (error) throw new Error(error.message);
  return unwrapInvitation(data, fallback);
}

export function sendDecisionCaseInvitation(input: {
  decisionCaseId: string;
  name: string;
  email: string;
}): Promise<DecisionCaseInvitation> {
  return invokeInvitation(
    {
      action: "invite",
      decisionCaseId: input.decisionCaseId,
      name: input.name,
      email: input.email,
    },
    "The invitation service did not return a delivery receipt.",
  );
}

export function getDecisionCaseInvitationStatus(
  decisionCaseId: string,
): Promise<DecisionCaseInvitation> {
  return invokeInvitation(
    { action: "status", decisionCaseId },
    "No invitation status is recorded for this Decision Case.",
  );
}

import { supabase } from "../lib/supabase";
import type { AuthorityDelegations } from "../lib/develop/change";

export interface ExpenditureCommitment {
  id: string;
  title: string;
  purpose: string;
  evidenceBasis: string;
  consequenceOfWrong: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  requestedAt: string;
  approvalId: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  authorityLimitId: string | null;
  authorityCeiling: number | null;
  authorityCurrency: string | null;
  isOwnRequest: boolean;
}

export interface ExpenditureApprovalWorkspace {
  commitments: ExpenditureCommitment[];
  callerRole: string;
  canRequest: boolean;
  control: string;
  delegations: AuthorityDelegations;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function getExpenditureApprovalWorkspace(): Promise<ExpenditureApprovalWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_expenditure_approval_workspace",
  );
  return unwrap(data, error);
}

export async function requestExpenditureCommitment(input: {
  title: string;
  purpose: string;
  evidenceBasis: string;
  consequenceOfWrong: string;
  amount: string;
  currency: string;
}): Promise<{ commitment_id: string; approval_id: string; status: string }> {
  const { data, error } = await supabase.rpc("request_expenditure_commitment", {
    p_request: {
      title: input.title,
      purpose: input.purpose,
      evidence_basis: input.evidenceBasis,
      consequence_of_wrong: input.consequenceOfWrong,
      amount: input.amount,
      currency: input.currency,
    },
  });
  return unwrap(data, error);
}

export async function decideExpenditureCommitment(input: {
  id: string;
  outcome: "approved" | "rejected";
  note: string;
}): Promise<{ commitment_id: string; approval_id: string; status: string }> {
  const { data, error } = await supabase.rpc("decide_expenditure_commitment", {
    p_id: input.id,
    p_outcome: input.outcome,
    p_note: input.note,
  });
  return unwrap(data, error);
}

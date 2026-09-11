import { supabase } from "../lib/supabase";

export interface OperationalDebtCandidate {
  gapClass: string;
  sourceTable: string;
  sourceId: string;
  label: string;
  assetId: string | null;
}
export interface OperationalDebtItem {
  id: string;
  gapClass: string;
  sourceTable: string;
  sourceId: string;
  ownerId: string;
  ownerName: string;
  dueOn: string | null;
  recordedBy: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgementBasis: string | null;
}

export async function getOperationalDebtCandidates(caseId: string) {
  const { data, error } = await supabase.rpc(
    "get_case_operational_debt_candidates",
    { p_case_id: caseId },
  );
  if (error) throw new Error(error.message);
  return data as OperationalDebtCandidate[];
}

export async function getCaseOperationalDebt(caseId: string) {
  const { data, error } = await supabase.rpc("get_case_operational_debt", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  return data as { items: OperationalDebtItem[]; gapClasses: number; note: string };
}

export async function recordOperationalDebtReference(
  caseId: string,
  candidate: OperationalDebtCandidate,
  ownerId: string,
  dueOn: string | null,
) {
  const { data, error } = await supabase.rpc(
    "record_operational_debt_reference",
    {
      p_case_id: caseId,
      p_gap_class: candidate.gapClass,
      p_source_table: candidate.sourceTable,
      p_source_id: candidate.sourceId,
      p_owner_id: ownerId,
      p_due_on: dueOn,
    },
  );
  if (error) throw new Error(error.message);
  return data as { id: string; status: string };
}

export async function acknowledgeOperationalDebt(id: string, basis: string) {
  const { data, error } = await supabase.rpc("acknowledge_operational_debt", {
    p_item_id: id,
    p_basis: basis,
  });
  if (error) throw new Error(error.message);
  return data as { id: string; status: string };
}

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
  approvedValuation: OperationalDebtValuation | null;
  pendingValuation: Pick<OperationalDebtValuation, "version" | "lifecycleExposure" | "currency"> | null;
}
export interface OperationalDebtValuation {
  version: number;
  lifecycleExposure: number;
  currency: string;
  basis: string;
  sourceReference: string;
  approvedAt: string;
}
export interface OperationalDebtRegister {
  items: OperationalDebtItem[];
  gapClasses: number;
  itemCount: number;
  unvaluedCount: number;
  valuationStatus: string;
  totalsByCurrency: Array<{ currency: string; lifecycleExposure: number; valuedItems: number }>;
  note: string;
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
  return data as OperationalDebtRegister;
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

export async function recordOperationalDebtValuation(
  itemId: string,
  input: {
    resolutionCost: number;
    annualOperatingCost: number;
    annualRiskExposure: number;
    exposureYears: number;
    discountRate: number;
    currency: string;
    basis: string;
    sourceReference: string;
  },
) {
  const { data, error } = await supabase.rpc(
    "record_operational_debt_valuation",
    {
      p_item_id: itemId,
      p_resolution_cost: input.resolutionCost,
      p_annual_operating_cost: input.annualOperatingCost,
      p_annual_risk_exposure: input.annualRiskExposure,
      p_exposure_years: input.exposureYears,
      p_discount_rate: input.discountRate,
      p_currency: input.currency,
      p_basis: input.basis,
      p_source_reference: input.sourceReference,
    },
  );
  if (error) throw new Error(error.message);
  return data as { itemId: string; version: number; lifecycleExposure: number; currency: string; status: string };
}

export async function approveOperationalDebtValuation(itemId: string, version: number, basis: string) {
  const { data, error } = await supabase.rpc(
    "approve_operational_debt_valuation",
    { p_item_id: itemId, p_version: version, p_basis: basis },
  );
  if (error) throw new Error(error.message);
  return data as { itemId: string; version: number; lifecycleExposure: number; currency: string; status: string };
}

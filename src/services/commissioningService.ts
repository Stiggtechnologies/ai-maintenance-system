import { supabase } from "../lib/supabase";

export interface CommissioningProcedure {
  id: number;
  ref: string;
  title: string;
  acceptanceCriteria: string;
  sourceReference: string;
  evidenceClass: string;
  assessmentBasis: string;
}
export interface CommissioningTestPackage {
  id: number;
  ref: string;
  title: string;
  scope: string;
  subsystemId: number | null;
  requiredBy: string | null;
  procedures: CommissioningProcedure[];
}
export interface CommissioningSubsystem {
  id: number;
  ref: string;
  title: string;
  description: string;
  ownerId: string;
}
export interface CommissioningSystem {
  id: number;
  ref: string;
  title: string;
  description: string;
  ownerId: string;
  subsystems: CommissioningSubsystem[];
  testPackages: CommissioningTestPackage[];
  rollup: {
    resultCount: number;
    releasedCount: number;
    failedCount: number;
    openPunchCount: number;
    pendingReleaseCount: number;
  };
}
export interface CommissioningResult {
  id: number;
  systemId: number;
  subsystemId: number | null;
  testPackageId: number;
  procedureId: number;
  testRef: string;
  testStage: string;
  performedOn: string;
  outcome: string;
  punchItemsOpen: number;
  witnessedByOwner: boolean;
  releaseStatus: string;
}
export interface CaseCommissioning {
  caseId: string;
  systems: CommissioningSystem[];
  results: CommissioningResult[];
  resultStore: "acceptance_tests";
  decisionBoundary: string;
}

function payload<T>(
  data: unknown,
  error: { message: string } | null,
  action: string,
): T {
  if (error) throw new Error(`${action}: ${error.message}`);
  const value = data as (T & { error?: string }) | null;
  if (!value) throw new Error(`${action}: no response`);
  if (value.error) throw new Error(`${action}: ${value.error}`);
  return value;
}

export async function getCaseCommissioning(
  caseId: string,
): Promise<CaseCommissioning> {
  const { data, error } = await supabase.rpc("get_case_commissioning", {
    p_case_id: caseId,
  });
  return payload(data, error, "Could not load commissioning workspace");
}

export async function recordCommissioningObject(
  caseId: string,
  kind: "system" | "subsystem" | "test_package" | "procedure",
  record: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("record_commissioning_object", {
    p_case_id: caseId,
    p_kind: kind,
    p_record: record,
  });
  return payload<{ id: number; kind: string; status: string }>(
    data,
    error,
    "Commissioning record refused",
  );
}

export async function recordCommissioningResult(
  caseId: string,
  procedureId: number,
  record: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc("record_commissioning_result", {
    p_case_id: caseId,
    p_procedure_id: procedureId,
    p_record: record,
  });
  return payload<{ id: number; releaseStatus: string; resultStore: string }>(
    data,
    error,
    "Commissioning result refused",
  );
}

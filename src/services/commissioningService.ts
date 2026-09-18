import { supabase } from "../lib/supabase";

export const COMMISSIONING_STATES = [
  "CONSTRUCTION_COMPLETE",
  "MECHANICAL_COMPLETE",
  "READY_FOR_ENERGIZATION",
  "PRECOMMISSIONED",
  "COMMISSIONED",
  "PERFORMANCE_VERIFIED",
  "ACCEPTED",
] as const;
export type CommissioningState = (typeof COMMISSIONING_STATES)[number];

export interface CommissioningAssetBinding {
  id: number;
  assetId: string;
  tag: string | null;
  name: string;
  requiredEnergyTypes: string[];
  basis: string;
  evidenceItemId: string;
}
export interface CommissioningTransitionReadiness {
  systemId: number;
  currentState: CommissioningState | null;
  nextState: CommissioningState | null;
  canTransition: boolean;
  blockers: string[];
  assets: Array<{
    assetId: string;
    tag: string | null;
    name: string;
    requiredEnergyTypes: string[];
    equipmentReleased: boolean;
    ready: boolean;
  }>;
  decisionBoundary?: string;
}

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
  currentState: CommissioningState | null;
  nextState: CommissioningState | null;
  transitionReadiness: CommissioningTransitionReadiness;
  assetBindings: CommissioningAssetBinding[];
  stateHistory: Array<{
    id: number;
    fromState: CommissioningState | null;
    toState: CommissioningState;
    rationale: string;
    evidenceItemId: string;
    transitionedBy: string;
    transitionedAt: string;
  }>;
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

export async function bindCommissioningSystemAsset(input: {
  systemId: number;
  assetId: string;
  requiredEnergyTypes: string[];
  basis: string;
  evidenceItemId: string;
}) {
  const { data, error } = await supabase.rpc(
    "bind_commissioning_system_asset",
    {
      p_system_id: input.systemId,
      p_asset_id: input.assetId,
      p_required_energy_types: input.requiredEnergyTypes,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return payload<{ id: number; status: string }>(
    data,
    error,
    "Commissioning asset binding refused",
  );
}

export async function transitionCommissioningSystem(input: {
  systemId: number;
  toState: CommissioningState;
  rationale: string;
  evidenceItemId: string;
}) {
  const { data, error } = await supabase.rpc(
    "transition_commissioning_system",
    {
      p_system_id: input.systemId,
      p_to_state: input.toState,
      p_rationale: input.rationale,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return payload<{
    id: number;
    systemId: number;
    fromState: CommissioningState | null;
    toState: CommissioningState;
    status: string;
  }>(data, error, "Commissioning transition refused");
}

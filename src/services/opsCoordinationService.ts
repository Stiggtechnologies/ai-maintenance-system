import { supabase } from "../lib/supabase";

export interface EligibleReturnToServiceTest {
  id: number;
  test_ref: string;
  performed_on: string;
  acceptance_criteria: string;
  evidence_description: string;
  released_at: string;
  performed_by_name?: string | null;
  released_by_name?: string | null;
}

export interface EquipmentRelease {
  release_id: string;
  asset_id: string;
  asset: string;
  status: string;
  released_at: string;
  returned_at: string | null;
  isolation_confirmed: boolean;
  hours_out_of_service: number;
  awaiting_acceptance: boolean;
  returned_by_me: boolean;
  eligible_rts_tests: EligibleReturnToServiceTest[];
}

export interface ProductionLossRow {
  asset: string;
  down_hours: number;
  demonstrated_rate: number;
  unit_of_measure: string;
  units_lost: number;
}

export interface OpsCoordinationPayload {
  open_releases: EquipmentRelease[];
  production_loss: {
    window_days: number;
    by_asset: ProductionLossRow[];
    assets_measurable: number;
    assets: number;
    basis: string;
  };
  note: string;
}

type RpcPayload = Record<string, unknown> & { error?: string };

async function governedRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcPayload> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload | null;
  if (!payload)
    throw new Error("Operations coordination returned no response.");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function getOpsCoordination(): Promise<OpsCoordinationPayload> {
  return (await governedRpc(
    "get_ops_coordination",
    {},
  )) as unknown as OpsCoordinationPayload;
}

export async function returnEquipmentToOperations(input: {
  assetId: string;
  note: string;
}): Promise<RpcPayload> {
  return governedRpc("return_equipment", {
    p_asset_id: input.assetId,
    p_note: input.note,
  });
}

export async function verifyAndAcceptEquipment(input: {
  releaseId: string;
  acceptanceTestId: number;
  note: string;
}): Promise<RpcPayload> {
  return governedRpc("verify_and_accept_equipment", {
    p_release_id: input.releaseId,
    p_acceptance_test_id: input.acceptanceTestId,
    p_note: input.note,
  });
}

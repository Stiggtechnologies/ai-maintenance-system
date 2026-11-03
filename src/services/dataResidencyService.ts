import { supabase } from "../lib/supabase";

export type ResidencyPathKind =
  "storage" | "processing" | "connector" | "ai_provider";

export interface ResidencyDeclaration {
  id: number;
  version: number;
  region: string;
  basis: string;
  declaredAt: string;
  declaredByLabel: string | null;
}

export interface ResidencyBinding {
  id: number;
  version: number;
  pathKind: ResidencyPathKind;
  pathRef: string;
  region: string;
  basis: string;
  boundAt: string;
  boundByLabel: string | null;
}

export interface ResidencyDecision {
  at: string;
  actor: string | null;
  allowed: boolean | null;
  reason: string | null;
  pathKind: string | null;
  pathRef: string | null;
  event: string | null;
}

export interface TenantResidency {
  declaration: ResidencyDeclaration | null;
  bindings: ResidencyBinding[];
  decisions: ResidencyDecision[];
  boundary: string;
  operationalAuthority: false;
}

interface RpcResult {
  error?: string;
  allowed?: boolean;
  reason?: string;
  [key: string]: unknown;
}

function requireResult(data: unknown, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  return value;
}

export async function getTenantResidency(): Promise<TenantResidency> {
  const { data, error } = await supabase.rpc("get_tenant_residency");
  const value = requireResult(data, error);
  return {
    declaration: (value.declaration ?? null) as ResidencyDeclaration | null,
    bindings: (value.bindings ?? []) as ResidencyBinding[],
    decisions: (value.decisions ?? []) as ResidencyDecision[],
    boundary: String(value.boundary ?? ""),
    operationalAuthority: false,
  };
}

export async function declareTenantResidency(region: string, basis: string) {
  const { data, error } = await supabase.rpc("declare_tenant_residency", {
    p_region: region,
    p_basis: basis,
  });
  return requireResult(data, error);
}

export async function bindTenantResidencyPath(
  pathKind: ResidencyPathKind,
  pathRef: string,
  basis: string,
) {
  const { data, error } = await supabase.rpc("bind_tenant_residency_path", {
    p_path_kind: pathKind,
    p_path_ref: pathRef,
    p_basis: basis,
  });
  return requireResult(data, error);
}

/** Refuse before a tenant storage, processing, or connector operation. */
export async function assertDataResidency(
  pathKind: ResidencyPathKind,
  pathRef: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("authorize_data_residency", {
    p_path_kind: pathKind,
    p_path_ref: pathRef,
  });
  const value = requireResult(data, error);
  if (value.allowed !== true) {
    throw new Error(
      `Data residency refused (${value.reason ?? "residency_refused"})`,
    );
  }
}

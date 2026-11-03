import { supabase } from "../lib/supabase";

export type PermissionEffect = "revoked" | "restored";

export interface OwnPermission {
  permissionKey: string;
  ceiling: boolean;
  effective: boolean;
}

export interface RolePermissionCell {
  roleKey: string;
  permissionKey: string;
  ceiling: boolean;
  effective: boolean;
  adoptedEffect: PermissionEffect | null;
  proposalId: string | null;
  proposalEffect: PermissionEffect | null;
  proposedBy: string | null;
}

export interface RolePermissionWorkspace {
  role: string;
  canReadMatrix: boolean;
  canPropose: boolean;
  canAdopt: boolean;
  operationalAuthority: false;
  engineeringAuthority: false;
  boundary: string;
  ownPermissions: OwnPermission[];
  matrix: RolePermissionCell[] | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asEffect(value: unknown): PermissionEffect | null {
  return value === "revoked" || value === "restored" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The server envelope is the authority. A true operational or engineering
 * flag in the payload is ignored: this surface cannot confer either.
 */
export function rolePermissionWorkspaceFromRpc(
  data: unknown,
): RolePermissionWorkspace {
  const record = asRecord(data);
  if (!record) throw new Error("Role permissions returned no data.");
  if (typeof record.error === "string" && record.error.trim()) {
    throw new Error(record.error);
  }
  const own = Array.isArray(record.own_permissions)
    ? record.own_permissions
    : [];
  const matrix = Array.isArray(record.matrix)
    ? record.matrix.map((item) => {
        const cell = asRecord(item) ?? {};
        return {
          roleKey: String(cell.role_key ?? ""),
          permissionKey: String(cell.permission_key ?? ""),
          ceiling: asBoolean(cell.ceiling),
          effective: asBoolean(cell.effective),
          adoptedEffect: asEffect(cell.adopted_effect),
          proposalId: asString(cell.proposal_id),
          proposalEffect: asEffect(cell.proposal_effect),
          proposedBy: asString(cell.proposed_by),
        };
      })
    : null;

  return {
    role: String(record.role ?? ""),
    canReadMatrix: asBoolean(record.can_read_matrix),
    canPropose: asBoolean(record.can_propose),
    canAdopt: asBoolean(record.can_adopt),
    operationalAuthority: false,
    engineeringAuthority: false,
    boundary: String(record.boundary ?? ""),
    ownPermissions: own.map((item) => {
      const cell = asRecord(item) ?? {};
      return {
        permissionKey: String(cell.permission_key ?? ""),
        ceiling: asBoolean(cell.ceiling),
        effective: asBoolean(cell.effective),
      };
    }),
    matrix,
  };
}

function requireCommand(data: unknown, fallback: string): void {
  const record = asRecord(data);
  if (!record) throw new Error(fallback);
  if (typeof record.error === "string" && record.error.trim()) {
    throw new Error(record.error);
  }
}

export async function getRolePermissionGrants(): Promise<RolePermissionWorkspace> {
  const { data, error } = await supabase.rpc("get_role_permission_grants");
  if (error) throw new Error(error.message);
  return rolePermissionWorkspaceFromRpc(data);
}

export async function proposeRolePermissionGrant(input: {
  roleKey: string;
  permissionKey: string;
  effect: PermissionEffect;
  basis: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc("propose_role_permission_grant", {
    p_role_key: input.roleKey,
    p_permission_key: input.permissionKey,
    p_effect: input.effect,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  requireCommand(data, "Permission proposal returned no data.");
}

export async function decideRolePermissionGrant(input: {
  grantId: string;
  decision: "adopt" | "reject";
  basis: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc("decide_role_permission_grant", {
    p_grant_id: input.grantId,
    p_decision: input.decision,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  requireCommand(data, "Permission decision returned no data.");
}

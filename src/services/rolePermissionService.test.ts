import { describe, expect, it } from "vitest";
import { rolePermissionWorkspaceFromRpc } from "./rolePermissionService";

describe("rolePermissionWorkspaceFromRpc", () => {
  it("withholds the matrix and both write flags for an under-privileged role", () => {
    const workspace = rolePermissionWorkspaceFromRpc({
      role: "technician",
      can_read_matrix: false,
      can_propose: false,
      can_adopt: false,
      operational_authority: true,
      engineering_authority: true,
      boundary: "A grant can only narrow the platform ceiling.",
      own_permissions: [
        {
          permission_key: "security.audit.read",
          ceiling: false,
          effective: false,
        },
      ],
      matrix: null,
    });

    expect(workspace.canReadMatrix).toBe(false);
    expect(workspace.canPropose).toBe(false);
    expect(workspace.canAdopt).toBe(false);
    expect(workspace.matrix).toBeNull();
    expect(workspace.operationalAuthority).toBe(false);
    expect(workspace.engineeringAuthority).toBe(false);
    expect(workspace.ownPermissions[0]?.effective).toBe(false);
  });

  it("raises the server denial instead of rendering a partial grant", () => {
    expect(() =>
      rolePermissionWorkspaceFromRpc({
        error: "forbidden: technician cannot change role permissions",
      }),
    ).toThrow("forbidden: technician cannot change role permissions");
  });

  it("keeps an adopted revocation visible to a matrix reader", () => {
    const workspace = rolePermissionWorkspaceFromRpc({
      role: "admin",
      can_read_matrix: true,
      can_propose: true,
      can_adopt: true,
      boundary: "narrow only",
      own_permissions: [],
      matrix: [
        {
          role_key: "ai_admin",
          permission_key: "security.audit.read",
          ceiling: true,
          effective: false,
          adopted_effect: "revoked",
          proposal_id: null,
          proposal_effect: "granted",
          proposed_by: null,
        },
      ],
    });

    expect(workspace.matrix).toEqual([
      expect.objectContaining({
        roleKey: "ai_admin",
        permissionKey: "security.audit.read",
        effective: false,
        adoptedEffect: "revoked",
        proposalEffect: null,
      }),
    ]);
  });
});

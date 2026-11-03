import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RolePermissionWorkspace } from "../services/rolePermissionService";

const getRolePermissionGrants = vi.hoisted(() => vi.fn());
const proposeRolePermissionGrant = vi.hoisted(() => vi.fn());
const decideRolePermissionGrant = vi.hoisted(() => vi.fn());

vi.mock("../services/rolePermissionService", () => ({
  getRolePermissionGrants,
  proposeRolePermissionGrant,
  decideRolePermissionGrant,
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "admin-2", role: "admin" } }),
}));

import { RolePermissionGrantsPanel } from "./RolePermissionGrantsPanel";

const technician: RolePermissionWorkspace = {
  role: "technician",
  canReadMatrix: false,
  canPropose: false,
  canAdopt: false,
  operationalAuthority: false,
  engineeringAuthority: false,
  boundary: "A grant can only narrow the platform ceiling.",
  ownPermissions: [
    {
      permissionKey: "security.audit.read",
      ceiling: false,
      effective: false,
    },
  ],
  matrix: null,
};

const admin: RolePermissionWorkspace = {
  role: "admin",
  canReadMatrix: true,
  canPropose: true,
  canAdopt: true,
  operationalAuthority: false,
  engineeringAuthority: false,
  boundary: "A grant can only narrow the platform ceiling.",
  ownPermissions: [
    {
      permissionKey: "security.permissions.propose",
      ceiling: true,
      effective: true,
    },
  ],
  matrix: [
    {
      roleKey: "ai_admin",
      permissionKey: "security.audit.read",
      ceiling: true,
      effective: true,
      adoptedEffect: null,
      proposalId: null,
      proposalEffect: null,
      proposedBy: null,
    },
    {
      roleKey: "executive",
      permissionKey: "security.permissions.read",
      ceiling: true,
      effective: true,
      adoptedEffect: null,
      proposalId: "grant-1",
      proposalEffect: "revoked",
      proposedBy: "admin-1",
    },
  ],
};

describe("RolePermissionGrantsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the server denial for an under-privileged role", async () => {
    getRolePermissionGrants.mockResolvedValue(technician);
    render(<RolePermissionGrantsPanel />);

    expect(
      await screen.findByText(/withheld from this role/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This role cannot propose permission changes."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Propose permission change" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Read security audit: denied/i),
    ).toBeInTheDocument();
  });

  it("renders the server error when the role is refused outright", async () => {
    getRolePermissionGrants.mockRejectedValue(
      new Error("forbidden: technician cannot change role permissions"),
    );
    render(<RolePermissionGrantsPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "forbidden: technician cannot change role permissions",
    );
    expect(
      screen.queryByRole("button", { name: "Propose permission change" }),
    ).not.toBeInTheDocument();
  });

  it("submits a narrowing and lets a different admin adopt it", async () => {
    getRolePermissionGrants.mockResolvedValue(admin);
    proposeRolePermissionGrant.mockResolvedValue(undefined);
    decideRolePermissionGrant.mockResolvedValue(undefined);
    render(<RolePermissionGrantsPanel />);

    expect(
      await screen.findByRole("button", { name: "Propose permission change" }),
    ).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText(/permission to narrow or restore/i),
      {
        target: { value: "ai_admin:security.audit.read" },
      },
    );
    fireEvent.change(screen.getByLabelText(/^basis$/i), {
      target: {
        value: "Narrow the AI administrator audit read to named humans.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Propose permission change" }),
    );
    expect(proposeRolePermissionGrant).toHaveBeenCalledWith({
      roleKey: "ai_admin",
      permissionKey: "security.audit.read",
      effect: "revoked",
      basis: "Narrow the AI administrator audit read to named humans.",
    });
    expect(
      await screen.findByText(/different administrator must adopt/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/decision basis/i), {
      target: { value: "Independent administrator adopts the narrowing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));
    expect(decideRolePermissionGrant).toHaveBeenCalledWith({
      grantId: "grant-1",
      decision: "adopt",
      basis: "Independent administrator adopts the narrowing.",
    });
    expect(
      await screen.findByText("Permission change adopted."),
    ).toBeInTheDocument();
  });
});

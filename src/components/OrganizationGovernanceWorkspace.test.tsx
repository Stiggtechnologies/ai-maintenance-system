import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationGovernanceWorkspace } from "./OrganizationGovernanceWorkspace";

const getWorkspace = vi.fn();
const createNode = vi.fn();
const updateNode = vi.fn();
const setProfile = vi.fn();

vi.mock("../services/organizationGovernanceService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/organizationGovernanceService")
  >("../services/organizationGovernanceService");
  return {
    ...actual,
    getOrganizationGovernanceWorkspace: () => getWorkspace(),
    createSubOrganization: (input: unknown) => createNode(input),
    updateOrganizationNode: (input: unknown) => updateNode(input),
    setOrganizationGovernanceProfile: (input: unknown) => setProfile(input),
  };
});

const baseWorkspace = {
  root: {
    id: "root-1",
    name: "SyncAI Operator",
    industry: "energy",
    timezone: "America/Edmonton",
    orgLevel: "enterprise" as const,
    jurisdiction: "Canada",
  },
  nodes: [
    {
      id: "root-1",
      name: "SyncAI Operator",
      orgLevel: "enterprise" as const,
      parentId: null,
      jurisdiction: "Canada",
      depth: 0,
      attachedProfile: {
        id: "framework-1",
        name: "Major Capital Projects",
        version: 2,
        status: "adopted",
      },
      resolvedProfile: {
        id: "framework-1",
        name: "Major Capital Projects",
        version: 2,
        sourceAuthority: "INDUSTRY_GUIDANCE",
        sourceNodeId: "root-1",
        sourceNodeName: "SyncAI Operator",
        sourceDepth: 0,
      },
    },
    {
      id: "site-1",
      name: "North Site",
      orgLevel: "site" as const,
      parentId: "root-1",
      jurisdiction: "Alberta",
      depth: 1,
      attachedProfile: null,
      resolvedProfile: {
        id: "framework-1",
        name: "Major Capital Projects",
        version: 2,
        sourceAuthority: "INDUSTRY_GUIDANCE",
        sourceNodeId: "root-1",
        sourceNodeName: "SyncAI Operator",
        sourceDepth: 1,
      },
    },
  ],
  frameworks: [
    {
      id: "framework-1",
      name: "Major Capital Projects",
      version: 2,
      sourceAuthority: "INDUSTRY_GUIDANCE",
      organizationId: "root-1",
      organizationName: "SyncAI Operator",
      eligibleNodeIds: ["root-1", "site-1"],
    },
  ],
  actorRole: "executive",
  canManage: true,
  governance: {
    writes: "Executive or administrator only. Every change is audited.",
    inheritance:
      "A node inherits the nearest attached adopted profile from itself or an ancestor.",
    automation: "SyncAI never adopts or attaches a framework automatically.",
  },
};

describe("OrganizationGovernanceWorkspace", () => {
  beforeEach(() => {
    getWorkspace.mockReset().mockResolvedValue(baseWorkspace);
    createNode.mockReset().mockResolvedValue({ node_id: "bu-1" });
    updateNode.mockReset().mockResolvedValue({ node_id: "root-1" });
    setProfile.mockReset().mockResolvedValue({ node_id: "root-1" });
  });

  it("renders the governed tree, inherited profile, and authority boundary", async () => {
    render(<OrganizationGovernanceWorkspace />);
    expect(await screen.findByText("Five-level tree")).toBeTruthy();
    expect(screen.getByText("North Site")).toBeTruthy();
    expect(
      screen.getAllByText(/Major Capital Projects v2 · from SyncAI Operator/),
    ).toHaveLength(2);
    expect(screen.getByText(/signed in as/)).toHaveTextContent("executive");
    expect(screen.getByText(/never adopts or attaches/)).toBeTruthy();
  });

  it("walks the customer-reachable create-node path through the governed RPC", async () => {
    render(<OrganizationGovernanceWorkspace />);
    await screen.findByText("Add organization node");
    fireEvent.change(screen.getByLabelText("New organization node name"), {
      target: { value: "Central Business Unit" },
    });
    fireEvent.change(screen.getByLabelText("New organization level"), {
      target: { value: "business_unit" },
    });
    fireEvent.change(screen.getByLabelText("New organization jurisdiction"), {
      target: { value: "Alberta, Canada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create node" }));

    await waitFor(() =>
      expect(createNode).toHaveBeenCalledWith({
        name: "Central Business Unit",
        orgLevel: "business_unit",
        parentId: "root-1",
        jurisdiction: "Alberta, Canada",
      }),
    );
    expect(
      await screen.findByText(
        "Organization node created and written to the audit trail.",
      ),
    ).toBeTruthy();
  });

  it("surfaces the server refusal verbatim and preserves the rejected input", async () => {
    createNode.mockRejectedValue(
      new Error(
        "a enterprise cannot sit under a enterprise — a parent sits strictly above its child in the five-level tree",
      ),
    );
    render(<OrganizationGovernanceWorkspace />);
    await screen.findByText("Add organization node");
    fireEvent.change(screen.getByLabelText("New organization node name"), {
      target: { value: "Invalid child" },
    });
    fireEvent.change(screen.getByLabelText("New organization level"), {
      target: { value: "enterprise" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create node" }));

    expect(await screen.findByText(/parent sits strictly above/)).toBeTruthy();
    expect(screen.getByLabelText("New organization node name")).toHaveValue(
      "Invalid child",
    );
  });

  it("keeps non-authorized roles read-only", async () => {
    getWorkspace.mockResolvedValue({
      ...baseWorkspace,
      actorRole: "planner",
      canManage: false,
    });
    render(<OrganizationGovernanceWorkspace />);
    expect(await screen.findByText(/read-only for your role/)).toBeTruthy();
    expect(screen.queryByText("Add organization node")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Record profile decision" }),
    ).toBeNull();
  });
});

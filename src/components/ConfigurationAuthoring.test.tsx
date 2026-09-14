import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationAuthoring } from "./ConfigurationAuthoring";

const getWorkspace = vi.fn();
const recordBaseline = vi.fn();
const recordVariant = vi.fn();
const proposeAuthority = vi.fn();
const decideAuthority = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "reviewer-2", role: "executive" } }),
}));
vi.mock("../services/configurationManagement", async () => {
  const actual = await vi.importActual<
    typeof import("../services/configurationManagement")
  >("../services/configurationManagement");
  return {
    ...actual,
    getConfigurationAuthoringWorkspace: () => getWorkspace(),
    recordConfigurationBaseline: (...args: unknown[]) =>
      recordBaseline(...args),
    recordModelVariant: (...args: unknown[]) => recordVariant(...args),
    proposeConfigurationAuthority: (...args: unknown[]) =>
      proposeAuthority(...args),
    decideConfigurationAuthority: (...args: unknown[]) =>
      decideAuthority(...args),
  };
});

const workspace = {
  assets: [
    { id: "asset-1", name: "Pump P-101", tag: "P-101", serialNumber: null },
  ],
  materials: [
    { id: "material-1", code: "SEAL-A", description: "Specified seal" },
    { id: "material-2", code: "SEAL-B", description: "Candidate seal" },
  ],
  variants: [
    {
      id: 1,
      manufacturer: "Sync Pumps",
      model: "SP-100",
      variantCode: "A",
      distinguishingAttributes: "Standard casing",
    },
    {
      id: 2,
      manufacturer: "Sync Pumps",
      model: "SP-100",
      variantCode: "B",
      distinguishingAttributes: "High pressure casing",
    },
  ],
  pendingAuthority: [
    {
      kind: "substitution",
      id: 9,
      label: "SEAL-A → SEAL-B",
      status: "pending",
      createdAt: "2026-09-14T00:00:00Z",
      proposedBy: "author-1",
      approvalId: "approval-1",
    },
  ],
  controls: {
    authority: "Records facts only; cannot execute a configuration change.",
    approval: "Independent approval is required.",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  recordBaseline.mockResolvedValue({ baseline_id: 3, status: "recorded" });
  recordVariant.mockResolvedValue({ variant_id: 4, status: "recorded" });
  proposeAuthority.mockResolvedValue({ record_id: 5, status: "pending" });
  decideAuthority.mockResolvedValue({ record_id: 9, status: "approved" });
});

describe("ConfigurationAuthoring", () => {
  it("makes every U7 controlled workflow customer reachable", async () => {
    render(<ConfigurationAuthoring />);
    const action = await screen.findByLabelText("Configuration action");
    for (const label of [
      "Baseline item and serial",
      "Product/model variant",
      "Material substitution",
      "Equipment interchangeability",
      "Red-line drawing",
      "Outage/project reconciliation",
    ])
      expect(action).toHaveTextContent(label);
    expect(
      screen.getByText(/cannot execute a configuration change/i),
    ).toBeInTheDocument();
  });

  it("records a serial-bearing baseline through the governed service", async () => {
    render(<ConfigurationAuthoring />);
    await screen.findByText("Pump P-101 — P-101");
    fireEvent.change(screen.getByLabelText("Configuration asset"), {
      target: { value: "asset-1" },
    });
    fireEvent.change(screen.getByLabelText("Configuration source reference"), {
      target: { value: "walkdown-001" },
    });
    fireEvent.change(screen.getByLabelText("Configuration position"), {
      target: { value: "drive end bearing" },
    });
    fireEvent.change(screen.getByLabelText("Configuration part number"), {
      target: { value: "BRG-101" },
    });
    fireEvent.change(screen.getByLabelText("Configuration serial number"), {
      target: { value: "SN-001" },
    });
    fireEvent.change(screen.getByLabelText("Configuration evidence basis"), {
      target: {
        value: "Signed field walkdown and nameplate evidence were reviewed.",
      },
    });
    fireEvent.click(screen.getByText("Save controlled record"));
    await waitFor(() =>
      expect(recordBaseline).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          baselineKind: "as_maintained",
          sourceReference: "walkdown-001",
          items: [expect.objectContaining({ serialNumber: "SN-001" })],
        }),
      ),
    );
  });

  it("proposes substitution authority and independently reviews pending work", async () => {
    render(<ConfigurationAuthoring />);
    await screen.findByText("SEAL-A → SEAL-B");
    fireEvent.change(screen.getByLabelText("Configuration action"), {
      target: { value: "substitution" },
    });
    fireEvent.change(screen.getByLabelText("Specified material"), {
      target: { value: "material-1" },
    });
    fireEvent.change(screen.getByLabelText("Substitute material"), {
      target: { value: "material-2" },
    });
    fireEvent.change(
      screen.getByLabelText("Configuration authority conditions"),
      {
        target: {
          value: "Clean-water duty only below the stated pressure limit",
        },
      },
    );
    fireEvent.change(screen.getByLabelText("Substitution expiry"), {
      target: { value: "2027-09-14" },
    });
    fireEvent.change(screen.getByLabelText("Configuration evidence basis"), {
      target: {
        value: "Engineering comparison of ratings and interfaces was reviewed.",
      },
    });
    fireEvent.click(screen.getByText("Save controlled record"));
    await waitFor(() =>
      expect(proposeAuthority).toHaveBeenCalledWith(
        "substitution",
        expect.objectContaining({
          specified_material_id: "material-1",
          substitute_material_id: "material-2",
        }),
      ),
    );

    await screen.findByText("SEAL-A → SEAL-B");
    fireEvent.change(screen.getByLabelText("Configuration review note"), {
      target: {
        value: "Independent review confirms ratings, interfaces and expiry.",
      },
    });
    fireEvent.click(await screen.findByText("Approve"));
    await waitFor(() =>
      expect(decideAuthority).toHaveBeenCalledWith(
        "substitution",
        9,
        "approved",
        "Independent review confirms ratings, interfaces and expiry.",
      ),
    );
  });
});

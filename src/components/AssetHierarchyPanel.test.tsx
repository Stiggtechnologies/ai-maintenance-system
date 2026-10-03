import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindFailureModeToComponent,
  getAssetHierarchyWorkspace,
  recordComponentHierarchyNode,
} from "../services/assetHierarchyService";
import { AssetHierarchyPanel } from "./AssetHierarchyPanel";

vi.mock("../services/assetHierarchyService", () => ({
  bindFailureModeToComponent: vi.fn(),
  getAssetHierarchyWorkspace: vi.fn(),
  recordComponentHierarchyNode: vi.fn(),
}));

const workspace = {
  summary: {
    assets: 1,
    completePaths: 0,
    boundedAt: 200,
    basis: "Canonical records only; gaps stay visible.",
  },
  assets: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      tag: "P-101",
      name: "Process pump",
      enterprise: "Example operator",
      service: "Process water",
      serviceStatus: "verified",
      system: "Water transfer",
      location: "North plant · Pump house · FL-P-101",
      functionalLocation: "FL-P-101",
      complete: false,
      gaps: [
        "evidenced assembly",
        "governed FMMEA failure mode bound to component",
      ],
      components: [
        {
          id: "22222222-2222-4222-8222-222222222221",
          name: "Pump train",
          type: "rotating assembly",
          level: "assembly" as const,
          parentComponentId: null,
          basis: "Verified equipment breakdown establishes this assembly.",
          evidenceItemId: "44444444-4444-4444-8444-444444444444",
          recordedAt: "2026-10-03T00:00:00Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Mechanical seal",
          type: "seal",
          level: "component" as const,
          parentComponentId: null,
          basis: null,
          evidenceItemId: null,
          recordedAt: null,
        },
        {
          id: "22222222-2222-4222-8222-222222222223",
          name: "Seal cartridge",
          type: "maintainable unit",
          level: "maintainable_item" as const,
          parentComponentId: "22222222-2222-4222-8222-222222222221",
          basis:
            "Verified equipment breakdown establishes this maintainable item.",
          evidenceItemId: "44444444-4444-4444-8444-444444444444",
          recordedAt: "2026-10-03T00:00:00Z",
        },
        {
          id: "22222222-2222-4222-8222-222222222224",
          name: "Seal faces",
          type: "wear interface",
          level: "component" as const,
          parentComponentId: "22222222-2222-4222-8222-222222222223",
          basis: "Verified equipment breakdown establishes this component.",
          evidenceItemId: "44444444-4444-4444-8444-444444444444",
          recordedAt: "2026-10-03T00:00:00Z",
        },
      ],
      failureModes: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          failureMode: "Fails to contain process fluid",
          mechanism: "Seal face wear",
          componentId: null,
          basis: null,
          evidenceItemId: null,
          recordedAt: null,
        },
      ],
    },
  ],
  evidence: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      assetId: "11111111-1111-4111-8111-111111111111",
      description: "Verified equipment hierarchy and FMMEA record",
      evidenceClass: "DOCUMENTED",
      sourceSystem: "approved EAM export",
    },
  ],
  authority:
    "Hierarchy records identity and parentage only; it grants no work or operating authority.",
};

describe("AssetHierarchyPanel", () => {
  beforeEach(() => {
    vi.mocked(getAssetHierarchyWorkspace).mockResolvedValue(workspace);
    vi.mocked(recordComponentHierarchyNode).mockResolvedValue({
      status: "recorded",
    });
    vi.mocked(bindFailureModeToComponent).mockResolvedValue({
      status: "bound",
    });
  });

  it("shows canonical layers and records exact physical parentage", async () => {
    render(<AssetHierarchyPanel />);
    fireEvent.change(
      await screen.findByLabelText("Canonical asset for hierarchy authoring"),
      { target: { value: "11111111-1111-4111-8111-111111111111" } },
    );

    expect(screen.getByText("Example operator")).toBeInTheDocument();
    expect(screen.getByText("Process water")).toBeInTheDocument();
    expect(screen.getByText(/Missing: evidenced assembly/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Existing hierarchy node"), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    fireEvent.change(screen.getByLabelText("Physical level"), {
      target: { value: "component" },
    });
    fireEvent.change(screen.getByLabelText("Exact parent"), {
      target: { value: "22222222-2222-4222-8222-222222222223" },
    });
    fireEvent.change(screen.getByLabelText("Verified hierarchy evidence"), {
      target: { value: "44444444-4444-4444-8444-444444444444" },
    });
    fireEvent.change(screen.getByLabelText("Parentage basis and limitations"), {
      target: {
        value:
          "Approved equipment breakdown establishes the seal below its maintainable cartridge.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record hierarchy node" }),
    );

    await waitFor(() =>
      expect(recordComponentHierarchyNode).toHaveBeenCalledWith({
        assetId: "11111111-1111-4111-8111-111111111111",
        componentId: "22222222-2222-4222-8222-222222222222",
        name: "Mechanical seal",
        type: "seal",
        hierarchyLevel: "component",
        parentComponentId: "22222222-2222-4222-8222-222222222223",
        basis:
          "Approved equipment breakdown establishes the seal below its maintainable cartridge.",
        evidenceItemId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(
      screen.getByText(
        /No engineering or operating determination was inferred/i,
      ),
    ).toBeInTheDocument();
  });

  it("binds only an existing FMMEA identity to a governed component leaf", async () => {
    render(<AssetHierarchyPanel />);
    fireEvent.change(
      await screen.findByLabelText("Canonical asset for hierarchy authoring"),
      { target: { value: "11111111-1111-4111-8111-111111111111" } },
    );
    fireEvent.change(screen.getByLabelText("Governed FMMEA failure mode"), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    fireEvent.change(screen.getByLabelText("Governed component leaf"), {
      target: { value: "22222222-2222-4222-8222-222222222224" },
    });
    fireEvent.change(screen.getByLabelText("Verified binding evidence"), {
      target: { value: "44444444-4444-4444-8444-444444444444" },
    });
    fireEvent.change(
      screen.getByLabelText("Component-binding basis and limitations"),
      {
        target: {
          value:
            "Approved FMMEA identifies loss of containment at the seal-face component.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Bind failure mode to component" }),
    );

    await waitFor(() =>
      expect(bindFailureModeToComponent).toHaveBeenCalledWith({
        failureModeId: "33333333-3333-4333-8333-333333333333",
        componentId: "22222222-2222-4222-8222-222222222224",
        basis:
          "Approved FMMEA identifies loss of containment at the seal-face component.",
        evidenceItemId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    expect(
      screen.getByText(
        /Occurrence, condition and maintenance need remain separate/i,
      ),
    ).toBeInTheDocument();
  });
});

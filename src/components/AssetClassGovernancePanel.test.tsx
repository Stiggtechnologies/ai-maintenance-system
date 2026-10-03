import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  assignAssetClassProfile,
  listOntologyAssets,
  listOntologyEvidence,
} from "../services/assetOntologyService";
import { AssetClassGovernancePanel } from "./AssetClassGovernancePanel";

vi.mock("../services/assetOntologyService", () => ({
  assignAssetClassProfile: vi.fn(),
  listOntologyAssets: vi.fn(),
  listOntologyEvidence: vi.fn(),
}));

const profiles = [
  {
    classKey: "civil_structural",
    label: "Civil and structural",
    registerRef: "U3.05",
    measurementBasis: "structure" as const,
    exposureUnit: null,
    identityBasis: "Structure identifier and element breakdown",
    conditionBasis: "Inspection condition rating on a defined scale",
    failureMeaning: "Loss of structural capacity or serviceability",
    notes: "Not repaired to as-new on a work order.",
    assetCount: 0,
    applicability: [],
  },
  {
    classKey: "fixed_equipment",
    label: "Fixed equipment",
    registerRef: "U3.01",
    measurementBasis: "point" as const,
    exposureUnit: null,
    identityBasis: "Tag and serial number",
    conditionBasis: "Condition monitoring and work history",
    failureMeaning: "Loss of function",
    notes: null,
    assetCount: 1,
    applicability: [],
  },
];

describe("AssetClassGovernancePanel", () => {
  beforeEach(() => {
    vi.mocked(listOntologyAssets).mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "North bridge",
        tag: "BR-001",
        asset_class: "Bridge",
        assignment: null,
      },
    ]);
    vi.mocked(listOntologyEvidence).mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        asset_id: "11111111-1111-4111-8111-111111111111",
        description: "Qualified bridge inventory and element inspection",
        evidence_class: "INSPECTED",
        source_system: "owner-inspection-program",
        ts: "2026-10-01T00:00:00Z",
      },
    ]);
    vi.mocked(assignAssetClassProfile).mockResolvedValue({
      status: "assigned",
    });
  });

  it("refuses machine-style rates for structures and exposes the governed path", async () => {
    render(
      <MemoryRouter>
        <AssetClassGovernancePanel profiles={profiles} onAssigned={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Canonical asset"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Class profile"), {
      target: { value: "civil_structural" },
    });

    expect(
      screen.getByText(
        /failure rate is not how a structure's condition is expressed/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Recorded failures"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Civil and structural operating path"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Record condition state" }),
    ).toHaveAttribute("href", "/reliability");
    expect(
      screen.getByRole("link", { name: "Open civil specialist" }),
    ).toHaveAttribute("href", "/risk");
    expect(
      screen.getByText(/does not invent rating scales/i),
    ).toBeInTheDocument();
  });

  it("records a verified-evidence classification through the governed RPC", async () => {
    const onAssigned = vi.fn();
    render(
      <MemoryRouter>
        <AssetClassGovernancePanel
          profiles={profiles}
          onAssigned={onAssigned}
        />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText("Canonical asset"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText("Class profile"), {
      target: { value: "civil_structural" },
    });
    fireEvent.change(
      await screen.findByLabelText("Verified canonical evidence"),
      {
        target: { value: "22222222-2222-4222-8222-222222222222" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Classification basis and limitations"),
      {
        target: {
          value:
            "Owner bridge inventory and qualified element inspection establish a civil structure.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed classification" }),
    );

    await waitFor(() =>
      expect(assignAssetClassProfile).toHaveBeenCalledWith({
        assetId: "11111111-1111-4111-8111-111111111111",
        classKey: "civil_structural",
        basis:
          "Owner bridge inventory and qualified element inspection establish a civil structure.",
        evidenceItemId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(
      screen.getByText(
        /condition and engineering determinations remain separate/i,
      ),
    ).toBeInTheDocument();
  });
});

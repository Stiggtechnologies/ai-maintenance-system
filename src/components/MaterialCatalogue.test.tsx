import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialCatalogue } from "./MaterialCatalogue";
import {
  listCatalogueMaterials,
  upsertCatalogueMaterial,
  type CatalogueMaterial,
} from "../services/repairableMaterialsService";

vi.mock("../services/repairableMaterialsService", () => ({
  listCatalogueMaterials: vi.fn(),
  upsertCatalogueMaterial: vi.fn(),
}));

const existing: CatalogueMaterial = {
  id: "m-existing",
  material_code: "PUMP-1",
  description: "Process pump",
  category: "Pumps",
  unit_of_measure: "each",
  unit_cost_usd: 12000,
  lead_time_days: 45,
  min_qty: 1,
  max_qty: 2,
  repairable_classification: "rotable",
  criticality: "critical",
  source_system: "SAP",
  basis: "Approved material master record SAP-1001.",
  master_version: 3,
};

function fillCreate() {
  fireEvent.change(screen.getByLabelText("Material code"), {
    target: { value: "SEAL-1" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Seal" },
  });
  fireEvent.change(screen.getByLabelText("Lead time days"), {
    target: { value: "21" },
  });
  fireEvent.change(screen.getByLabelText("Repairable / rotable"), {
    target: { value: "consumable" },
  });
  fireEvent.change(screen.getByLabelText("Source / basis"), {
    target: { value: "Approved catalogue page four source." },
  });
}

describe("MaterialCatalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listCatalogueMaterials).mockResolvedValue([]);
  });

  it("submits the complete human-entered policy without creating stock or approval", async () => {
    vi.mocked(upsertCatalogueMaterial).mockResolvedValue({
      materialId: "m-1",
      materialCode: "SEAL-1",
      masterVersion: 1,
      repairableClassification: "consumable",
      operationalAuthorization: false,
    });
    const onCreated = vi.fn();
    render(<MaterialCatalogue onCreated={onCreated} />);
    await screen.findByText("0 governed materials");
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create material" }));
    await screen.findByRole("status");
    expect(upsertCatalogueMaterial).toHaveBeenCalledWith({
      materialId: undefined,
      expectedVersion: undefined,
      materialCode: "SEAL-1",
      description: "Seal",
      category: "",
      unitOfMeasure: "each",
      unitCostUsd: null,
      leadTimeDays: 21,
      minimumQuantity: null,
      maximumQuantity: null,
      repairableClassification: "consumable",
      criticality: null,
      sourceSystem: "customer_catalogue",
      basis: "Approved catalogue page four source.",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Stock and supplier qualification remain separate",
    );
    expect(screen.getByLabelText("Material code")).toHaveValue("");
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("carries the loaded master version into an optimistic revision", async () => {
    vi.mocked(listCatalogueMaterials).mockResolvedValue([existing]);
    vi.mocked(upsertCatalogueMaterial).mockResolvedValue({
      materialId: existing.id,
      materialCode: existing.material_code,
      masterVersion: 4,
      repairableClassification: "rotable",
      operationalAuthorization: false,
    });
    render(<MaterialCatalogue />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByText(/Revise PUMP-1 · version 3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lead time days"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await screen.findByRole("status");
    expect(upsertCatalogueMaterial).toHaveBeenCalledWith(
      expect.objectContaining({
        materialId: "m-existing",
        expectedVersion: 3,
        leadTimeDays: 60,
        repairableClassification: "rotable",
      }),
    );
  });

  it("preserves input on refusal and never displays a success message", async () => {
    vi.mocked(upsertCatalogueMaterial).mockRejectedValue(
      new Error("named human planning role required"),
    );
    render(<MaterialCatalogue />);
    await screen.findByText("0 governed materials");
    fillCreate();
    fireEvent.click(screen.getByRole("button", { name: "Create material" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "named human planning role required",
    );
    expect(screen.getByLabelText("Material code")).toHaveValue("SEAL-1");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create material" }),
      ).toBeEnabled(),
    );
  });
});

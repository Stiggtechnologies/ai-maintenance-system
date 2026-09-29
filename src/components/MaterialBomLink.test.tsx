import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialBomLink } from "./MaterialBomLink";
import {
  linkCatalogueBom,
  listMaterialBomOptions,
} from "../services/materialsCallers";
vi.mock("../services/materialsCallers", () => ({
  linkCatalogueBom: vi.fn(),
  listMaterialBomOptions: vi.fn(),
}));
describe("MaterialBomLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMaterialBomOptions).mockResolvedValue({
      materials: [{ id: "m1", material_code: "SEAL", description: "Seal" }],
      assets: [
        { id: "a1", tag: "P-1", name: "Pump", asset_class: "pump" },
        { id: "a2", tag: "P-2", name: "Other pump", asset_class: "pump" },
      ],
      components: [
        { id: "c1", asset_id: "a1", name: "First bearing" },
        { id: "c2", asset_id: "a2", name: "Second bearing" },
      ],
    });
    vi.mocked(linkCatalogueBom).mockResolvedValue({ bomLineId: "b1" });
  });
  it("only offers components under the selected asset and clears a stale selection", async () => {
    render(<MaterialBomLink />);
    await screen.findByRole("option", { name: "P-1 — Pump" });
    fireEvent.change(screen.getByLabelText("BOM asset"), {
      target: { value: "a1" },
    });
    expect(
      screen.getByRole("option", { name: "First bearing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Second bearing" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("BOM component (optional)"), {
      target: { value: "c1" },
    });
    fireEvent.change(screen.getByLabelText("BOM asset"), {
      target: { value: "a2" },
    });
    expect(screen.getByLabelText("BOM component (optional)")).toHaveValue("");
    expect(
      screen.queryByRole("option", { name: "First bearing" }),
    ).not.toBeInTheDocument();
  });
  it("records a class BOM without inventing an asset or component", async () => {
    render(<MaterialBomLink />);
    await screen.findByRole("option", { name: "SEAL — Seal" });
    fireEvent.change(screen.getByLabelText("BOM material"), {
      target: { value: "m1" },
    });
    fireEvent.change(screen.getByLabelText("BOM scope"), {
      target: { value: "class" },
    });
    fireEvent.change(screen.getByLabelText("BOM asset class"), {
      target: { value: "pump" },
    });
    fireEvent.change(screen.getByLabelText("Quantity per asset / component"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("BOM source / basis"), {
      target: { value: "Drawing 42" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record BOM relationship" }),
    );
    await screen.findByText(/BOM relationship recorded/);
    expect(linkCatalogueBom).toHaveBeenCalledWith({
      materialId: "m1",
      assetId: null,
      assetClass: "pump",
      componentId: null,
      quantity: 2,
      positionNote: "",
      basis: "Drawing 42",
    });
  });
});

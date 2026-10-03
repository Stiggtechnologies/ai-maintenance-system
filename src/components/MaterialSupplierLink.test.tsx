import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialSupplierLink } from "./MaterialSupplierLink";
import {
  linkCatalogueSupplier,
  listMaterialSupplierOptions,
} from "../services/materialsCallers";

vi.mock("../services/materialsCallers", () => ({
  linkCatalogueSupplier: vi.fn(),
  listMaterialSupplierOptions: vi.fn(),
}));

describe("MaterialSupplierLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMaterialSupplierOptions).mockResolvedValue({
      materials: [{ id: "m1", material_code: "SEAL", description: "Seal" }],
      suppliers: [{ id: 7, supplier_code: "S7", name: "Supplier Seven" }],
    });
  });

  it("offers named canonical references and records an explicitly unapproved link", async () => {
    vi.mocked(linkCatalogueSupplier).mockResolvedValue({
      linkId: 1,
      approvedForThisMaterial: false,
    });
    render(<MaterialSupplierLink />);
    await screen.findByRole("option", { name: "S7 — Supplier Seven" });
    fireEvent.change(screen.getByLabelText("Catalogue material"), {
      target: { value: "m1" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Relationship source / basis"), {
      target: { value: "Quote 123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record supplier relationship" }),
    );
    expect(
      await screen.findByText(/Supplier relationship recorded as unapproved/),
    ).toBeInTheDocument();
    expect(linkCatalogueSupplier).toHaveBeenCalledWith({
      materialId: "m1",
      supplierId: 7,
      supplierPartNumber: "",
      basis: "Quote 123",
    });
  });

  it("refuses to offer an actionable form when either canonical source is empty", async () => {
    vi.mocked(listMaterialSupplierOptions).mockResolvedValue({
      materials: [],
      suppliers: [],
    });
    render(<MaterialSupplierLink />);
    await screen.findByText(
      "Create a material and register a supplier before linking them.",
    );
    expect(
      screen.getByRole("button", { name: "Record supplier relationship" }),
    ).toBeDisabled();
    expect(linkCatalogueSupplier).not.toHaveBeenCalled();
  });

  it("shows fetch errors rather than inventing an empty catalogue", async () => {
    vi.mocked(listMaterialSupplierOptions).mockRejectedValue(
      new Error("connection unavailable"),
    );
    render(<MaterialSupplierLink />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "connection unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Record supplier relationship" }),
    ).toBeDisabled();
  });
});

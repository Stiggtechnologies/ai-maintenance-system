import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialCatalogue } from "./MaterialCatalogue";
import { createCatalogueMaterial } from "../services/materialsCallers";

vi.mock("../services/materialsCallers", () => ({
  createCatalogueMaterial: vi.fn(),
}));

function fill() {
  fireEvent.change(screen.getByLabelText("Material code"), {
    target: { value: "SEAL-1" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Seal" },
  });
  fireEvent.change(screen.getByLabelText("Unit of measure"), {
    target: { value: "each" },
  });
  fireEvent.change(screen.getByLabelText("Source / basis"), {
    target: { value: "Catalogue page 4" },
  });
}

describe("MaterialCatalogue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the human-entered source and distinguishes identity from stock and approval", async () => {
    vi.mocked(createCatalogueMaterial).mockResolvedValue({
      materialId: "m-1",
      materialCode: "SEAL-1",
    });
    const onCreated = vi.fn();
    render(<MaterialCatalogue onCreated={onCreated} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create material" }));
    await screen.findByRole("status");
    expect(createCatalogueMaterial).toHaveBeenCalledWith({
      materialCode: "SEAL-1",
      description: "Seal",
      unitOfMeasure: "each",
      basis: "Catalogue page 4",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Stock and supplier qualification remain separate",
    );
    expect(screen.getByLabelText("Material code")).toHaveValue("");
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("preserves input on refusal and never displays a success message", async () => {
    vi.mocked(createCatalogueMaterial).mockRejectedValue(
      new Error("human planning role required"),
    );
    render(<MaterialCatalogue />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create material" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "human planning role required",
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

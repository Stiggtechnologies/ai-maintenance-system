import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MaterialRelationshipHistory } from "./MaterialRelationshipHistory";
import { listMaterialRelationshipAudit } from "../services/materialsCallers";
vi.mock("../services/materialsCallers", () => ({
  listMaterialRelationshipAudit: vi.fn(),
}));
describe("MaterialRelationshipHistory", () => {
  it("shows the persisted source and named actor without claiming verification", async () => {
    vi.mocked(listMaterialRelationshipAudit).mockResolvedValue([
      {
        id: "audit1",
        entity_type: "material_supplier",
        event_time: "2026-09-28T12:00:00Z",
        actor: "planner",
        event_data: {
          actorId: "actor1",
          basis: "Supplier quote Q42",
          action: "linked",
        },
        new_state: { material_id: "material1", supplier_id: 7 },
      },
    ]);
    render(<MaterialRelationshipHistory />);
    expect(
      await screen.findByText("Source / basis: Supplier quote Q42"),
    ).toBeInTheDocument();
    expect(screen.getByText("Actor: actor1 (planner)")).toBeInTheDocument();
    expect(
      screen.getByText(/not independent verification/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Older records" }),
    ).toBeDisabled();
  });
  it("does not present a failed read as an empty audit history", async () => {
    vi.mocked(listMaterialRelationshipAudit).mockRejectedValue(
      new Error("audit unavailable"),
    );
    render(<MaterialRelationshipHistory />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "audit unavailable",
    );
    expect(
      screen.queryByText("No relationship audit records on this page."),
    ).not.toBeInTheDocument();
  });
});

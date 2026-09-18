/**
 * Reachability of reserve_wo_materials / record_material_event from the
 * materials desk. Ready backlog and wait-on-parts stay unmeasurable until
 * a human records reserved/kitted/issued events — absence is not green.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialsReadiness } from "./MaterialsReadiness";

const rpc = vi.fn();
const listMaterialDemand = vi.fn();
const reserveWoMaterials = vi.fn();
const recordMaterialEvent = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

vi.mock("../services/materialsCallers", async () => {
  const actual = await vi.importActual<
    typeof import("../services/materialsCallers")
  >("../services/materialsCallers");
  return {
    ...actual,
    listMaterialDemand: (...args: unknown[]) => listMaterialDemand(...args),
    reserveWoMaterials: (...args: unknown[]) => reserveWoMaterials(...args),
    recordMaterialEvent: (...args: unknown[]) => recordMaterialEvent(...args),
  };
});

const EMPTY_POSITION = {
  catalogue_size: 3,
  template_rows: 3,
  stock_records: 0,
  demand_lines: 0,
  stock_note:
    "No stock records. On-hand quantities have not been fabricated — connect an inventory source (C2.17) before readiness or shortage figures mean anything.",
  below_minimum: [],
  open_shortages: [],
  unassessable_demand: [],
  repairables: [],
};

const REQUESTED_LINE = {
  id: "wom1",
  work_order_id: "wo1",
  material_id: "m1",
  qty_required: 2,
  qty_reserved: 0,
  qty_issued: 0,
  status: "requested" as const,
  needed_by: null,
  material_code: "SEAL-25",
  description: "Mechanical seal 25mm",
  wo_number: "WO-1",
  wo_title: "Replace pump seal",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: EMPTY_POSITION, error: null });
  listMaterialDemand.mockResolvedValue([]);
  reserveWoMaterials.mockResolvedValue({
    reserved_lines: 0,
    short_lines: 0,
    lines_without_stock_records: 1,
  });
  recordMaterialEvent.mockResolvedValue({ recorded: "issued", line: "wom1" });
});

describe("MaterialsReadiness kitting path", () => {
  it("does not invent a ready state when demand and stock are absent", async () => {
    render(<MaterialsReadiness />);
    expect(await screen.findByText(/No stock records/)).toBeInTheDocument();
    expect(screen.getByText(/No open material demand/)).toBeInTheDocument();
    expect(screen.queryByText("Reserve")).not.toBeInTheDocument();
    expect(reserveWoMaterials).not.toHaveBeenCalled();
  });

  it("reserves through reserve_wo_materials and keeps no-stock honest", async () => {
    listMaterialDemand.mockResolvedValue([REQUESTED_LINE]);
    render(<MaterialsReadiness />);
    fireEvent.click(await screen.findByText("Reserve"));
    await waitFor(() => expect(reserveWoMaterials).toHaveBeenCalledWith("wo1"));
    expect(
      await screen.findByText(
        /without a stock record — not a shortage, not ready/,
      ),
    ).toBeInTheDocument();
  });

  it("issues through record_material_event", async () => {
    listMaterialDemand.mockResolvedValue([
      { ...REQUESTED_LINE, status: "kitted" },
    ]);
    render(<MaterialsReadiness />);
    fireEvent.click(await screen.findByText("Issue"));
    await waitFor(() =>
      expect(recordMaterialEvent).toHaveBeenCalledWith("wom1", "issued"),
    );
    expect(await screen.findByText(/Waiting-on-material/)).toBeInTheDocument();
  });
});

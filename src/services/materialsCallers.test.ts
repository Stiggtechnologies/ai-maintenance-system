import { describe, expect, it, vi } from "vitest";
import {
  canIssue,
  canKit,
  canReserve,
  describeReserveResult,
  listMaterialDemand,
  recordMaterialEvent,
  reserveWoMaterials,
} from "./materialsCallers";

const rpc = vi.fn();
const from = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

describe("materialsCallers", () => {
  it("offers kit/issue only after a reservation exists", () => {
    expect(canReserve("requested")).toBe(true);
    expect(canKit("requested")).toBe(false);
    expect(canIssue("requested")).toBe(false);
    expect(canKit("reserved")).toBe(true);
    expect(canIssue("kitted")).toBe(true);
  });

  it("names no-stock as unassessable, not ready", () => {
    expect(
      describeReserveResult({
        reserved_lines: 0,
        short_lines: 0,
        lines_without_stock_records: 2,
      }),
    ).toMatch(/not a shortage, not ready/);
  });

  it("calls reserve_wo_materials with the work order id", async () => {
    rpc.mockResolvedValue({
      data: {
        reserved_lines: 1,
        short_lines: 0,
        lines_without_stock_records: 0,
      },
      error: null,
    });
    await reserveWoMaterials("wo-1");
    expect(rpc).toHaveBeenCalledWith("reserve_wo_materials", {
      p_work_order_id: "wo-1",
    });
  });

  it("calls record_material_event with the line and event", async () => {
    rpc.mockResolvedValue({
      data: { recorded: "issued", line: "wom-1" },
      error: null,
    });
    await recordMaterialEvent("wom-1", "issued", 2);
    expect(rpc).toHaveBeenCalledWith("record_material_event", {
      p_work_order_material_id: "wom-1",
      p_event_type: "issued",
      p_qty: 2,
      p_note: null,
    });
  });

  it("surfaces an in-band RPC refusal in the database's words", async () => {
    rpc.mockResolvedValue({
      data: { error: "work order not found" },
      error: null,
    });
    await expect(reserveWoMaterials("missing")).rejects.toThrow(
      "work order not found",
    );
  });

  it("flattens nested demand rows for the kitting desk", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        {
          id: "wom1",
          work_order_id: "wo1",
          material_id: "m1",
          qty_required: 2,
          qty_reserved: 0,
          qty_issued: 0,
          status: "requested",
          needed_by: null,
          materials: { material_code: "SEAL-25", description: "Seal" },
          work_orders: { wo_number: "WO-1", title: "Replace seal" },
        },
      ],
      error: null,
    });
    from.mockReturnValue({
      select: () => ({ eq }),
    });
    const rows = await listMaterialDemand("wo1");
    expect(from).toHaveBeenCalledWith("work_order_materials");
    expect(rows[0]).toMatchObject({
      material_code: "SEAL-25",
      wo_number: "WO-1",
      wo_title: "Replace seal",
    });
  });
});

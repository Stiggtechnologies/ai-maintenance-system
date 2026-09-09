/**
 * Reachability tests, not cosmetics: apply_job_plan, record_task_actual,
 * request_wo_material, reserve_wo_materials and record_material_event shipped
 * with zero callers, so what these assert is that each database function now
 * has a caller invoked with the arguments it expects, that draft plans are
 * never offered (the database refuses them, and a button that exists to fail
 * is not a feature), and that a refusal surfaces the database's own sentence.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkOrderPlanningPanel } from "./WorkOrderPlanningPanel";

const rpc = vi.fn();
const from = vi.fn();
const listMaterialDemand = vi.fn();
const reserveWoMaterials = vi.fn();
const recordMaterialEvent = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
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

const ADOPTED = {
  plan_key: "JP-SEAL",
  title: "Replace pump seal",
  status: "adopted",
  steps: 4,
  estimated_hours: 6,
  materials: 2,
  permits: 1,
  applies_to: "Pumps",
};
const DRAFT = {
  ...ADOPTED,
  plan_key: "JP-DRAFT",
  title: "Draft plan",
  status: "draft",
};

const TASK = {
  id: "t1",
  task_sequence: 1,
  description: "Isolate and drain",
  status: "pending",
  estimated_hours: 2,
  actual_hours: null,
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

const RESERVED_LINE = {
  ...REQUESTED_LINE,
  status: "reserved" as const,
  qty_reserved: 2,
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  listMaterialDemand.mockReset();
  reserveWoMaterials.mockReset();
  recordMaterialEvent.mockReset();
  listMaterialDemand.mockResolvedValue([]);
  reserveWoMaterials.mockResolvedValue({
    reserved_lines: 1,
    short_lines: 0,
    lines_without_stock_records: 0,
  });
  recordMaterialEvent.mockResolvedValue({ recorded: "kitted", line: "wom1" });
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_job_plans")
      return Promise.resolve({
        data: { plans: [ADOPTED, DRAFT] },
        error: null,
      });
    if (fn === "apply_job_plan")
      return Promise.resolve({
        data: {
          tasks_created: 4,
          planned_hours: 6,
          materials_requested: 2,
          permits_required: 1,
          safety_flagged: true,
        },
        error: null,
      });
    return Promise.resolve({ data: { status: "ok" }, error: null });
  });
  from.mockReturnValue({
    select: () => ({
      order: () =>
        Promise.resolve({
          data: [
            {
              id: "m1",
              material_code: "SEAL-25",
              description: "Mechanical seal 25mm",
              unit_of_measure: "each",
            },
          ],
          error: null,
        }),
    }),
  });
});

describe("WorkOrderPlanningPanel", () => {
  it("offers adopted plans only — a draft is refused by the database, so it is not offered", async () => {
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText(/Replace pump seal/)).toBeInTheDocument();
    expect(screen.queryByText(/Draft plan/)).not.toBeInTheDocument();
  });

  it("applies a plan through apply_job_plan and reports the safety flag", async () => {
    const onChanged = vi.fn();
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={onChanged}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Job plan"), {
      target: { value: "JP-SEAL" },
    });
    fireEvent.click(screen.getByText("Apply plan"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("apply_job_plan", {
        p_work_order_id: "wo1",
        p_plan_key: "JP-SEAL",
      }),
    );
    expect(await screen.findByText(/safety-flagged/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("records an actual through record_task_actual with the entered hours", async () => {
    const onChanged = vi.fn();
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[TASK]}
        onChanged={onChanged}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Actual hours for task 1"), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByText("Record"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_task_actual", {
        p_task_id: "t1",
        p_actual_hours: 2.5,
        p_status: "complete",
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("requests material through request_wo_material", async () => {
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Material"), {
      target: { value: "m1" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Request"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("request_wo_material", {
        p_work_order_id: "wo1",
        p_material_id: "m1",
        p_qty: 2,
      }),
    );
  });

  it("shows the release gate only on safety-flagged work and calls release_equipment", async () => {
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={true}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText("Equipment release")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Isolation verified"));
    fireEvent.click(screen.getByText("Release equipment"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("release_equipment", {
        p_asset_id: "a1",
        p_work_order_id: "wo1",
        p_isolation_confirmed: true,
        p_isolation_note: null,
      }),
    );
  });

  it("surfaces the maintenance-cannot-self-release refusal in the database's words", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_job_plans")
        return Promise.resolve({ data: { plans: [] }, error: null });
      return Promise.resolve({
        data: {
          error:
            "releasing equipment is an operations act — maintenance cannot release equipment to itself",
        },
        error: null,
      });
    });
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={true}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    fireEvent.click(await screen.findByText("Release equipment"));
    expect(
      await screen.findByText(/maintenance cannot release equipment to itself/),
    ).toBeInTheDocument();
  });

  it("reserves through reserve_wo_materials and reports lines without stock honestly", async () => {
    listMaterialDemand.mockResolvedValue([REQUESTED_LINE]);
    reserveWoMaterials.mockResolvedValue({
      reserved_lines: 0,
      short_lines: 0,
      lines_without_stock_records: 1,
    });
    const onChanged = vi.fn();
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByText("Reserve available stock"));
    await waitFor(() => expect(reserveWoMaterials).toHaveBeenCalledWith("wo1"));
    expect(
      await screen.findByText(
        /without a stock record — not a shortage, not ready/,
      ),
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("records kit through record_material_event", async () => {
    listMaterialDemand.mockResolvedValue([RESERVED_LINE]);
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    fireEvent.click(await screen.findByText("Kit"));
    await waitFor(() =>
      expect(recordMaterialEvent).toHaveBeenCalledWith("wom1", "kitted"),
    );
    expect(await screen.findByText(/Waiting-on-material/)).toBeInTheDocument();
  });

  it("keeps wait-on-parts unmeasurable when there is no demand", async () => {
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    expect(
      await screen.findByText(/metrics stay unmeasurable until demand exists/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Reserve available stock"),
    ).not.toBeInTheDocument();
    expect(reserveWoMaterials).not.toHaveBeenCalled();
  });

  it("surfaces the database's own refusal sentence", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "get_job_plans")
        return Promise.resolve({ data: { plans: [ADOPTED] }, error: null });
      return Promise.resolve({
        data: {
          error:
            'no ADOPTED plan "JP-SEAL". A draft plan may not be applied to real work.',
        },
        error: null,
      });
    });
    render(
      <WorkOrderPlanningPanel
        workOrderId="wo1"
        assetId="a1"
        safetyFlag={false}
        tasks={[]}
        onChanged={() => {}}
      />,
    );
    fireEvent.change(await screen.findByLabelText("Job plan"), {
      target: { value: "JP-SEAL" },
    });
    fireEvent.click(screen.getByText("Apply plan"));
    expect(
      await screen.findByText(/A draft plan may not be applied to real work/),
    ).toBeInTheDocument();
  });
});

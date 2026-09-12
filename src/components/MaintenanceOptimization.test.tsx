import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceOptimization } from "./MaintenanceOptimization";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const RESULT = {
  history_days: 180,
  horizon_days: 90,
  source_posture: "connector_backed",
  loss_forecast: [
    {
      asset_id: "a1",
      tag: "P-201",
      asset: "Boiler feed pump",
      status: "forecast",
      state_coverage_pct: 82,
      history_unplanned_events: 4,
      demonstrated_rate: 125,
      unit_of_measure: "t",
      expected_unplanned_hours: 11.5,
      expected_units_at_risk: 1437.5,
      refusal: null,
      basis: "Observed evidence only.",
    },
    {
      asset_id: "a2",
      tag: "P-202",
      asset: "Standby pump",
      status: "not_assessable",
      state_coverage_pct: 3,
      history_unplanned_events: 0,
      demonstrated_rate: null,
      unit_of_measure: null,
      expected_unplanned_hours: null,
      expected_units_at_risk: null,
      refusal: "Operating-state coverage is below 25%; extrapolation is refused.",
      basis: "Observed evidence only.",
    },
  ],
  risk_backlog: [
    {
      work_order_id: "w1",
      wo_number: "WO-44",
      title: "Inspect seal system",
      asset: "Boiler feed pump",
      priority: "high",
      criticality: "critical",
      current_risk_score: 78,
      risk_basis: "linked_iso31000_risk",
      safety_flag: false,
      due_date: null,
      age_days: 21,
      planned_hours: 4,
      sized: true,
    },
  ],
  outage_options: [
    {
      window_id: "o1",
      window_key: "OPP-1",
      title: "Unit opportunity window",
      starts_at: "2026-10-01T00:00:00Z",
      remaining_hours: 12,
      late_additions: 0,
      candidates: [
        {
          work_order_id: "w1",
          wo_number: "WO-44",
          title: "Inspect seal system",
          asset: "Boiler feed pump",
          priority: "high",
          criticality: "critical",
          planned_hours: 4,
          current_risk_score: 78,
          selection_basis: "Fits and is unblocked.",
        },
      ],
      authority: "recommendation only; adding work remains human-controlled",
    },
  ],
  controls: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => {
    if (name === "generate_maintenance_optimization_run") {
      return { data: { run_id: "run-2", status: "draft", result: RESULT }, error: null };
    }
    return {
      data: {
        run_id: "run-1",
        status: "draft",
        generated_at: "2026-09-12T12:00:00Z",
        result: RESULT,
      },
      error: null,
    };
  });
});

describe("MaintenanceOptimization", () => {
  it("shows forecast evidence, explicit refusal, backlog risk and governed outage candidates", async () => {
    render(<MaintenanceOptimization />);
    expect(await screen.findByText(/1437.5 t at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/extrapolation is refused/i)).toBeInTheDocument();
    expect(screen.getAllByText(/WO-44 · Inspect seal system/i)).toHaveLength(2);
    expect(screen.getByText(/Risk 78/i)).toBeInTheDocument();
    expect(screen.getByText(/adding work remains human-controlled/i)).toBeInTheDocument();
  });

  it("regenerates through the governed RPC and reloads the persisted run", async () => {
    render(<MaintenanceOptimization />);
    fireEvent.click(await screen.findByRole("button", { name: /Regenerate planning run/i }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("generate_maintenance_optimization_run", {
        p_history_days: 180,
        p_horizon_days: 90,
        p_limit: 50,
      }),
    );
    await waitFor(() =>
      expect(rpc.mock.calls.filter(([name]) => name === "get_latest_maintenance_optimization_run")).toHaveLength(2),
    );
  });
});

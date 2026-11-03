import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Stage1MeasuredPilotProof } from "./Stage1MeasuredPilotProof";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const EMPTY = {
  historical_fleet_studies_used: false,
  authority: "read only — creates no work",
  population: {
    work_orders: 0,
    work_orders_without_source_system: 0,
    operating_state_rows: 0,
    production_rows: 0,
  },
  emergency_work: {
    status: "not_measurable",
    value: null,
    unit: "%",
    classified: 0,
    work_orders: 0,
    basis: "Emergency work counts only a source dispatch class.",
  },
  repeat_failures: {
    status: "not_measurable",
    value: null,
    unit: "%",
    coded_events: 0,
    repeat_events: 0,
    repeat_pairs: 0,
    uncoded_excluded: 0,
    incomplete_excluded: 0,
    basis: "Uncoded history is excluded.",
  },
  availability: {
    status: "not_measurable",
    value: null,
    unit: "%",
    running_hours: null,
    down_hours: null,
    other_hours: null,
    conflict_assets: 0,
    window_source: null,
    basis: "This tenant has no operating-state span to measure.",
  },
  backlog_quality: {
    status: "not_measurable",
    open_work_orders: 0,
    planning_complete: 0,
    planning_complete_pct: null,
    materials_status: "not_measurable",
    materials_ready: null,
    materials_with_demand: 0,
    materials_ready_pct: null,
    basis: "An empty backlog is not a perfect score.",
  },
  production_loss: {
    status: "not_measurable",
    units_lost: null,
    unit_of_measure: null,
    sum_refused: false,
    assets_measurable: 0,
    assets_excluded_mixed_units: 0,
    assets_excluded_no_rate: 0,
    by_asset: [],
    basis: "Nameplate capacity is refused.",
  },
};

beforeEach(() => {
  rpc.mockReset();
});

describe("Stage1MeasuredPilotProof", () => {
  it("shows not measurable instead of a zero score when the tenant has no rows", async () => {
    rpc.mockResolvedValue({ data: EMPTY, error: null });
    render(<Stage1MeasuredPilotProof />);
    expect(
      await screen.findByTestId("stage1-measured-pilot-proof"),
    ).toBeTruthy();
    expect(screen.getByTestId("stage1-proof-emergency")).toHaveTextContent(
      "Not measurable",
    );
    expect(screen.getByTestId("stage1-proof-emergency")).not.toHaveTextContent(
      "0%",
    );
    expect(screen.getByTestId("stage1-proof-loss")).toHaveTextContent(
      "Not measurable",
    );
    expect(screen.getByText(/Historical fleet studies are not used/)).toBeTruthy();
    expect(screen.queryByText(/AHS/)).toBeNull();
  });

  it("shows a measured zero and keeps backlog arms separate", async () => {
    rpc.mockResolvedValue({
      data: {
        ...EMPTY,
        population: {
          work_orders: 3,
          work_orders_without_source_system: 1,
          operating_state_rows: 4,
          production_rows: 2,
        },
        emergency_work: {
          ...EMPTY.emergency_work,
          status: "measured",
          value: 0,
          classified: 3,
          work_orders: 3,
        },
        availability: {
          ...EMPTY.availability,
          status: "measured",
          value: 92.5,
          running_hours: 100,
          down_hours: 8.1,
          other_hours: 4,
        },
        backlog_quality: {
          ...EMPTY.backlog_quality,
          status: "partial",
          open_work_orders: 2,
          planning_complete: 1,
          planning_complete_pct: 50,
        },
        production_loss: {
          ...EMPTY.production_loss,
          status: "measured",
          sum_refused: true,
          assets_measurable: 2,
          by_asset: [
            {
              asset: "Pump A",
              units_lost: 3,
              unit_of_measure: "t",
              down_hours: 1,
              demonstrated_rate: 3,
            },
          ],
        },
      },
      error: null,
    });
    render(<Stage1MeasuredPilotProof />);
    await waitFor(() =>
      expect(screen.getByTestId("stage1-proof-emergency")).toHaveTextContent(
        "0%",
      ),
    );
    expect(screen.getByTestId("stage1-proof-availability")).toHaveTextContent(
      "92.5%",
    );
    expect(screen.getByTestId("stage1-proof-backlog")).toHaveTextContent("50%");
    expect(screen.getByTestId("stage1-proof-backlog")).toHaveTextContent(
      "Not measurable",
    );
    expect(screen.getByTestId("stage1-proof-loss")).toHaveTextContent(
      "mixed units stay unsummed",
    );
    expect(screen.getByText(/Pump A: 3 t lost/)).toBeTruthy();
  });
});

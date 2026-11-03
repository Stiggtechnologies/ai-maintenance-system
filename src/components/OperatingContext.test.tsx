/**
 * Reachability of get_operating_context / get_operating_regime from the
 * /executive Operating Context panel. Org-level counts are not a duty
 * profile; selecting an asset must call both readers.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatingContext } from "./OperatingContext";

const getOperatingContext = vi.fn();
const getOperatingRegime = vi.fn();
const getProcessEventContext = vi.fn();
const listAssetsForContext = vi.fn();
const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

vi.mock("../services/reliabilityCallers", async () => {
  const actual = await vi.importActual<
    typeof import("../services/reliabilityCallers")
  >("../services/reliabilityCallers");
  return {
    ...actual,
    listAssetsForContext: () => listAssetsForContext(),
    getOperatingContext: (...args: unknown[]) => getOperatingContext(...args),
    getOperatingRegime: (...args: unknown[]) => getOperatingRegime(...args),
    getProcessEventContext: (...args: unknown[]) =>
      getProcessEventContext(...args),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((fn: string) => {
    if (fn === "publish_maintenance_cost_per_unit") {
      return Promise.resolve({
        data: {
          published: false,
          figure: {
            basis:
              "Not computable: production volume not recorded. A cost-per-unit figure built on a partial denominator understates it, which is the direction that flatters.",
          },
        },
        error: null,
      });
    }
    return Promise.resolve({
      data: {
        assets: 2,
        assets_with_state_records: 1,
        state_records: 12,
        production_records: 0,
        process_events: 0,
        cost_per_unit: {
          available: false,
          value: null,
          unit: null,
          units_produced: null,
          maintenance_cost_usd: null,
          cost_coverage: "0 production records",
          missing_inputs: ["production volume"],
          basis:
            "Not computable: production volume not recorded. A cost-per-unit figure built on a partial denominator understates it, which is the direction that flatters.",
        },
        note: "Counts are not a duty profile.",
      },
      error: null,
    });
  });
  listAssetsForContext.mockResolvedValue([
    { id: "a1", name: "Pump P-101", asset_tag: "P-101" },
  ]);
  getOperatingContext.mockResolvedValue({
    asset_id: "a1",
    window_days: 90,
    states: [{ state: "running", hours: 80, pct_of_covered: 100 }],
    starts_in_window: 1,
    hours_covered: 80,
    coverage_pct: 3.7,
    records_total: 12,
    data_span_from: "2010-01-01T00:00:00Z",
    data_span_to: "2012-12-31T00:00:00Z",
    basis: "Only 3.7% of the window is covered by state records.",
  });
  getOperatingRegime.mockResolvedValue({
    asset_id: "a1",
    at: "2026-09-03T00:00:00Z",
    regime: "Unknown duty",
    basis: "A state record covers this moment but load_pct was not recorded.",
  });
  getProcessEventContext.mockResolvedValue({
    asset_id: "a1",
    window_days: 90,
    total_in_window: 1,
    records_total: 1,
    data_span_from: "2026-08-01T14:02:11Z",
    data_span_to: "2026-08-01T14:02:11Z",
    events: [
      {
        id: 1,
        event_type: "trip",
        severity: "critical",
        tag: "P101-TRIP",
        description: "Low suction trip",
        occurred_at: "2026-08-01T14:02:11Z",
        source_system: "manual_upload",
      },
    ],
    basis: "1 process event falls inside the requested window.",
  });
});

describe("OperatingContext per-asset readers", () => {
  it("does not invent a duty profile before an asset is selected", async () => {
    render(<OperatingContext />);
    expect(
      await screen.findByText(
        /Select an asset — counts above are not a duty profile/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("asset-operating-duty"),
    ).not.toBeInTheDocument();
    expect(getOperatingContext).not.toHaveBeenCalled();
  });

  it("calls get_operating_context and get_operating_regime for the selected asset", async () => {
    render(<OperatingContext />);
    fireEvent.change(
      await screen.findByLabelText("Asset for operating context"),
      {
        target: { value: "a1" },
      },
    );
    await waitFor(() =>
      expect(getOperatingContext).toHaveBeenCalledWith("a1", 90),
    );
    expect(getOperatingRegime).toHaveBeenCalledWith("a1");
    expect(getProcessEventContext).toHaveBeenCalledWith("a1", 90);
    expect(await screen.findByTestId("asset-operating-duty")).toHaveTextContent(
      "Unknown duty",
    );
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText(/Low suction trip/)).toBeInTheDocument();
    expect(screen.getByTestId("process-event-context")).toHaveTextContent(
      /not predictive condition alerts/,
    );
    expect(screen.getByTestId("operating-context-reader")).toHaveTextContent(
      /Silence is not uptime/,
    );
  });

  it("shows the unavailable cost basis and audits a refused publication", async () => {
    render(<OperatingContext />);
    expect(
      await screen.findByText(/partial denominator understates it/),
    ).toBeInTheDocument();
    expect(screen.getByText("production volume")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish cost per unit" }),
    );
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("publish_maintenance_cost_per_unit", {
        p_window_days: 365,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /production volume not recorded/,
    );
  });
});

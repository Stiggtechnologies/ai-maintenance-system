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
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
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
        maintenance_cost_usd: 0,
        cost_coverage: "",
        missing_inputs: [],
        basis: "No production records in the window.",
      },
      note: "Counts are not a duty profile.",
    },
    error: null,
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
    expect(await screen.findByTestId("asset-operating-duty")).toHaveTextContent(
      "Unknown duty",
    );
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByTestId("operating-context-reader")).toHaveTextContent(
      /Silence is not uptime/,
    );
  });
});

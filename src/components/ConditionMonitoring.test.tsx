/**
 * Reachability of adopt_pf_interval from the Reliability condition-
 * monitoring panel. A recommended interval is not authorization.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionMonitoring } from "./ConditionMonitoring";

const listPfIntervals = vi.fn();
const adoptPfInterval = vi.fn();
const rpc = vi.fn();
let role = "reliability_engineer";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

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
    listPfIntervals: () => listPfIntervals(),
    adoptPfInterval: (...args: unknown[]) => adoptPfInterval(...args),
  };
});

const DRAFT = {
  id: "pf1",
  failure_mode: "Rolling-element bearing degradation",
  detection_technique: "Vibration analysis",
  pf_interval_days: 60,
  recommended_inspection_days: 30,
  status: "draft" as const,
  basis: "Draft reference.",
  asset_class: null,
};

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      coverage: {
        assets: 1,
        monitored_assets: 0,
        coverage_pct: 0,
        critical_assets: 0,
        critical_monitored: 0,
        critical_coverage_pct: null,
        readings: 0,
        basis: "No sensors configured.",
      },
      active_alerts: [],
      warning_lead_time: {
        available: false,
        value: null,
        unit: "hours",
        sample: 0,
        basis: "No linked alerts.",
      },
      pm_task_effectiveness: {
        available: false,
        pm_completed: 0,
        finding_rate_pct: null,
        missed_rate_pct: null,
        basis: "No completed PMs.",
      },
      pf_note: "P-F intervals are declared engineering reference data.",
    },
    error: null,
  });
  listPfIntervals.mockResolvedValue([DRAFT]);
});

describe("ConditionMonitoring adopt path", () => {
  it("hides adopt for roles the database will refuse", async () => {
    role = "technician";
    render(<ConditionMonitoring />);
    await screen.findByText("Rolling-element bearing degradation");
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();
    expect(screen.getByTestId("pf-honesty")).toHaveTextContent(
      /AI-operator identity is not offered/,
    );
  });

  it("hides adopt from the AI-operator identity", async () => {
    role = "ai_admin";
    render(<ConditionMonitoring />);
    await screen.findByText("Rolling-element bearing degradation");
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();
    expect(screen.getByTestId("pf-honesty")).toHaveTextContent(
      /AI-operator identity is not offered/,
    );
  });

  it("adopts a draft through adoptPfInterval and refuses a short note", async () => {
    adoptPfInterval.mockResolvedValue({
      adopted: "pf1",
      pf_interval_days: 45,
      recommended_inspection_days: 22.5,
    });
    render(<ConditionMonitoring />);
    fireEvent.click(await screen.findByText("Adopt"));
    expect(screen.getByText("Adopt interval")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("P-F interval days"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("P-F adoption basis"), {
      target: { value: "short" },
    });
    expect(screen.getByText("Adopt interval")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("P-F adoption basis"), {
      target: {
        value:
          "Site vibration programme: 45-day warning on this bearing class.",
      },
    });
    fireEvent.click(screen.getByText("Adopt interval"));
    await waitFor(() =>
      expect(adoptPfInterval).toHaveBeenCalledWith(
        "pf1",
        45,
        "Site vibration programme: 45-day warning on this bearing class.",
      ),
    );
    expect(await screen.findByText(/named-human act/)).toBeInTheDocument();
  });
});

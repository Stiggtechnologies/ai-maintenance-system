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

const UNCONFIGURED_HISTORIAN = {
  configured: false,
  enabled: false,
  mapping_approved: false,
  telemetry_mode: "seed_sim",
  connector_key: null,
  name: null,
  system_kind: null,
  last_success_at: null,
  connector_backed_readings: 0,
  other_readings: 0,
  recent: [],
  citable_recommendations: [],
  basis:
    "No plant historian is configured for this organization. Recommendations and condition views continue on seed or simulated telemetry. That is not live plant data.",
};

beforeEach(() => {
  role = "reliability_engineer";
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: unknown) => {
    if (name === "get_plant_historian_status") {
      return { data: UNCONFIGURED_HISTORIAN, error: null };
    }
    return {
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
    };
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
      /AI-operator identity is not offered Adopt/,
    );
  });

  it("hides adopt from the AI-operator identity", async () => {
    role = "ai_admin";
    render(<ConditionMonitoring />);
    await screen.findByText("Rolling-element bearing degradation");
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();
    expect(screen.getByTestId("pf-honesty")).toHaveTextContent(
      /AI-operator identity is not offered Adopt/,
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

  it("states seed/sim honestly when no historian is configured", async () => {
    render(<ConditionMonitoring />);
    expect(
      await screen.findByText(/not live plant data/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Cite historian readings/i),
    ).not.toBeInTheDocument();
  });

  it("cites connector-backed readings on a pending recommendation", async () => {
    rpc.mockImplementation(async (name: unknown) => {
      if (name === "get_plant_historian_status") {
        return {
          data: {
            ...UNCONFIGURED_HISTORIAN,
            configured: true,
            enabled: true,
            mapping_approved: true,
            telemetry_mode: "historian_owns",
            connector_key: "site-a-pi",
            name: "Site A PI",
            system_kind: "historian",
            connector_backed_readings: 1,
            recent: [
              {
                external_id: "CR-1",
                asset: "P-101",
                asset_id: "a1",
                sensor: "Vibration — Drive End",
                value: 2.4,
                quality: "good",
                taken_at: "2026-08-01T06:00:00Z",
                source_system: "site-a-pi",
              },
            ],
            citable_recommendations: [
              {
                id: "rec-1",
                title: "Investigate P-101 vibration",
                asset_id: "a1",
                asset: "P-101",
                status: "pending",
              },
            ],
            basis:
              "1 connector-backed reading(s) from source_system=site-a-pi. Cite these on a pending recommendation; they are not seed telemetry.",
          },
          error: null,
        };
      }
      if (name === "attach_plant_historian_evidence") {
        return {
          data: {
            ok: true,
            attached: 1,
            note: "Attached 1 connector-backed historian reading(s) as evidence.",
          },
          error: null,
        };
      }
      return {
        data: {
          coverage: {
            assets: 1,
            monitored_assets: 1,
            coverage_pct: 100,
            critical_assets: 0,
            critical_monitored: 0,
            critical_coverage_pct: null,
            readings: 1,
            basis: "Reading history present; limits are evaluated on ingest.",
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
      };
    });
    render(<ConditionMonitoring />);
    expect(await screen.findByText(/site-a-pi/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByText(/Cite historian readings on: Investigate P-101 vibration/),
    );
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("attach_plant_historian_evidence", {
        p_recommendation_id: "rec-1",
      }),
    );
    expect(
      await screen.findByText(/Attached 1 connector-backed historian reading/),
    ).toBeInTheDocument();
  });
});

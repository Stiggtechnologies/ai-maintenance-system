import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemKpiOptimizationPanel } from "./SystemKpiOptimizationPanel";

const getWorkspace = vi.fn();
const propose = vi.fn();
const decide = vi.fn();

vi.mock("../services/systemKpiOptimizationService", () => ({
  getSystemKpiOptimizationWorkspace: () => getWorkspace(),
  proposeSystemKpiOptimization: (...args: unknown[]) => propose(...args),
  decideSystemKpiOptimization: (...args: unknown[]) => decide(...args),
}));

const basis =
  "Recorded from this tenant's evidence, not calculated by the system.";

const catalog = [
  { kpiKey: "oee", name: "Overall Equipment Effectiveness", page: "executive" },
  { kpiKey: "availability", name: "Availability", page: "asset_performance" },
  {
    kpiKey: "maintenance_cost_rav",
    name: "Maintenance Cost / RAV",
    page: "financial",
  },
  {
    kpiKey: "critical_control_compliance",
    name: "Critical Control Compliance",
    page: "risk_safety",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    boundary:
      "Acceptance records a human judgement across the KPI system. It does not approve work, accept risk, commit spend, change an operating limit or return equipment to service.",
    catalog,
    pages: ["asset_performance", "executive", "financial", "risk_safety"],
    assessments: [
      {
        id: "opt-1",
        status: "proposed",
        focalKpiKey: "oee",
        focalPage: "executive",
        intent: "Raise packing effectiveness while naming the other pages.",
        requiredPages: ["asset_performance", "financial", "risk_safety"],
        safetyKpiWorsens: true,
        recommendationId: null,
        proposedAt: "2026-11-03T00:00:00Z",
        decidedAt: null,
        decisionNote: null,
        escalationNote: null,
        operationalAuthorization: false,
        effects: [
          {
            kpiKey: "critical_control_compliance",
            page: "risk_safety",
            effect: "worsens",
            basis,
          },
        ],
      },
    ],
  });
  propose.mockResolvedValue({
    optimizationId: "opt-2",
    status: "proposed",
    safetyKpiWorsens: false,
    operationalAuthorization: false,
  });
  decide.mockResolvedValue({
    optimizationId: "opt-1",
    status: "accepted",
    safetyKpiWorsens: true,
    operationalAuthorization: false,
  });
});

describe("SystemKpiOptimizationPanel", () => {
  it("keeps a single-KPI draft from being proposed", async () => {
    render(<SystemKpiOptimizationPanel />);
    expect(
      await screen.findByRole("heading", {
        name: "Optimize the whole system, not a single KPI",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not approve work/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Optimization intent"), {
      target: {
        value: "Raise overall equipment effectiveness on the packing line.",
      },
    });
    fireEvent.change(screen.getByLabelText("Focal KPI"), {
      target: { value: "oee" },
    });
    fireEvent.change(screen.getByLabelText(/Basis for judging/i), {
      target: { value: basis },
    });
    expect(
      screen.getByText(/A single KPI is not a system optimization/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Propose system assessment" }),
    ).toBeDisabled();
    expect(propose).not.toHaveBeenCalled();
  });

  it("proposes only after every other catalog page has an effect", async () => {
    render(<SystemKpiOptimizationPanel />);
    await screen.findByLabelText("Focal KPI");
    fireEvent.change(screen.getByLabelText("Optimization intent"), {
      target: {
        value: "Raise overall equipment effectiveness on the packing line.",
      },
    });
    fireEvent.change(screen.getByLabelText("Focal KPI"), {
      target: { value: "oee" },
    });
    fireEvent.change(screen.getByLabelText(/Basis for judging/i), {
      target: { value: basis },
    });
    fireEvent.change(screen.getByLabelText("KPI for Asset Performance"), {
      target: { value: "availability" },
    });
    fireEvent.change(screen.getByLabelText("Effect on Asset Performance"), {
      target: { value: "unchanged" },
    });
    fireEvent.change(screen.getByLabelText("Basis for Asset Performance"), {
      target: { value: basis },
    });
    fireEvent.change(screen.getByLabelText("KPI for Financial"), {
      target: { value: "maintenance_cost_rav" },
    });
    fireEvent.change(screen.getByLabelText("Effect on Financial"), {
      target: { value: "unknown" },
    });
    fireEvent.change(screen.getByLabelText("Basis for Financial"), {
      target: { value: basis },
    });
    fireEvent.change(screen.getByLabelText("KPI for Risk Safety"), {
      target: { value: "critical_control_compliance" },
    });
    fireEvent.change(screen.getByLabelText("Effect on Risk Safety"), {
      target: { value: "worsens" },
    });
    fireEvent.change(screen.getByLabelText("Basis for Risk Safety"), {
      target: { value: basis },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Propose system assessment" }),
    );

    await waitFor(() => {
      expect(propose).toHaveBeenCalledWith({
        focalKpiKey: "oee",
        intent: "Raise overall equipment effectiveness on the packing line.",
        effects: [
          { kpiKey: "oee", page: "executive", effect: "improves", basis },
          {
            kpiKey: "availability",
            page: "asset_performance",
            effect: "unchanged",
            basis,
          },
          {
            kpiKey: "maintenance_cost_rav",
            page: "financial",
            effect: "unknown",
            basis,
          },
          {
            kpiKey: "critical_control_compliance",
            page: "risk_safety",
            effect: "worsens",
            basis,
          },
        ],
      });
      expect(screen.getByLabelText("Optimization intent")).toHaveValue("");
    });
  });

  it("asks a different human to decide and states that acceptance is not execution", async () => {
    render(<SystemKpiOptimizationPanel />);
    expect(
      await screen.findByText(/does not authorize work/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Decision note"), {
      target: {
        value: "The safety worsening is explicit and escalated for review.",
      },
    });
    fireEvent.change(screen.getByLabelText(/Escalation note/i), {
      target: {
        value:
          "Executive review required before any further use of this assessment.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Accept system assessment" }),
    );
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith({
        optimizationId: "opt-1",
        decision: "accepted",
        note: "The safety worsening is explicit and escalated for review.",
        escalationNote:
          "Executive review required before any further use of this assessment.",
      });
      expect(getWorkspace.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("does not treat an empty catalog as an optimized system", async () => {
    getWorkspace.mockResolvedValue({
      boundary: "Acceptance does not approve work.",
      catalog: [],
      pages: [],
      assessments: [],
    });
    render(<SystemKpiOptimizationPanel />);
    expect(
      await screen.findByText(/Nothing has been optimized/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Propose system assessment" }),
    ).not.toBeInTheDocument();
  });
});

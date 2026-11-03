import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionControlData } from "../services/operatingLoopService";
import type { RecommendationRow } from "../types/operating";

const state = vi.hoisted(() => ({
  data: null as MissionControlData | null,
  loading: false,
  error: null,
  refetch: vi.fn(),
  role: "reliability_engineer",
  rules: [] as Array<{
    change_class: string;
    title: string;
    required_role: string;
    basis: string;
  }>,
}));

const classifyEngineeringChange = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useAsyncData", () => ({
  useAsyncData: (loader: () => Promise<unknown>) => {
    if (loader.toString().includes("listEngineeringApprovalRules")) {
      return {
        data: state.rules,
        loading: false,
        error: null,
        refetch: state.refetch,
        isEmpty: state.rules.length === 0,
      };
    }
    return state;
  },
}));
vi.mock("../hooks/useRealtimeRefetch", () => ({
  useRealtimeRefetch: () => ({ live: false }),
}));
vi.mock("../hooks/useOnboardingOperatingLoop", () => ({
  useOnboardingOperatingLoop: () => ({ missionSignals: [] }),
}));
vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: state.role },
    user: { id: "engineer-1" },
  }),
}));
vi.mock("../services/operatingLoopService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operatingLoopService")
  >("../services/operatingLoopService");
  return { ...actual, classifyEngineeringChange };
});
vi.mock("../components/EngineeringModelTracePanel", () => ({
  EngineeringModelTracePanel: () => null,
}));
vi.mock("../components/RecommendationContractPosturePanel", () => ({
  RecommendationContractPosturePanel: () => null,
}));
vi.mock("../components/help/FirstRunNextStepStrip", () => ({
  FirstRunNextStepStrip: () => null,
}));
vi.mock("../components/help/Stage1OperatorRunbook", () => ({
  Stage1OperatorRunbook: () => null,
}));
vi.mock("../components/ChallengeAIModal", () => ({
  ChallengeAIModal: () => null,
}));
vi.mock("../components/RecommendationVerificationPlanDrawer", () => ({
  RecommendationVerificationPlanDrawer: ({
    onSaved,
    onClose,
  }: {
    onSaved: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Verification plan">
      <button onClick={onSaved}>Save plan</button>
      <button onClick={onClose}>Close plan</button>
    </div>
  ),
}));

import { MissionControl } from "./MissionControl";

const recommendation = (id: string): RecommendationRow => ({
  id,
  organization_id: "org-1",
  asset_id: "asset-1",
  agent_id: null,
  title: `Inspect ${id}`,
  issue: "Observed condition requires review",
  action: "Inspect against the approved evidence basis",
  impact: "Outcome not yet verified",
  confidence: 80,
  urgency: "advisory",
  status: "pending",
  accountable: "Reliability engineer",
  responsible: "Planner",
  consulted: "Operations",
  informed: "Maintenance manager",
  approval_required: "Human approval",
  financial_impact: null,
  risk_impact: "Unverified",
  rationale: null,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: "2026-10-05T00:00:00Z",
});

describe("MissionControl recommendation refresh", () => {
  beforeEach(() => {
    state.loading = false;
    state.role = "reliability_engineer";
    state.rules = [];
    classifyEngineeringChange.mockReset();
    state.refetch.mockReset();
    state.data = {
      readinessScore: 75,
      readinessStatus: "Watch",
      readinessReason: "Test fixture only",
      factors: [],
      topRisks: [],
      topRecommendations: [recommendation("C-22"), recommendation("P-101")],
      stats: {
        actionsExecuted: 0,
        pendingApprovals: 2,
        recommendationsToday: 2,
        autonomousRate: 0,
      },
      financialExposures: [],
      valueCreated: 0,
    };
  });

  it("keeps open recommendation actions reachable after saving and refreshing a plan", () => {
    const { rerender } = render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    fireEvent.click(screen.getByRole("button", { name: "Verification plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(state.refetch).toHaveBeenCalledOnce();

    state.loading = true;
    rerender(<MissionControl />);
    expect(screen.queryByText("Inspect C-22")).toBeNull();
    state.loading = false;
    rerender(<MissionControl />);
    fireEvent.click(screen.getByRole("button", { name: "Close plan" }));

    expect(screen.getByRole("button", { name: "Assumptions" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Verification plan" }),
    ).toBeTruthy();
    // The untouched second card remains collapsed; refresh must not expand all cards.
    expect(screen.getAllByRole("button", { name: "Assumptions" })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByText("Inspect C-22"));
    expect(screen.queryByRole("button", { name: "Assumptions" })).toBeNull();
  });

  it("preserves independent expansion choices across realtime refreshes", () => {
    const { rerender } = render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    fireEvent.click(screen.getByText("Inspect P-101"));
    state.loading = true;
    rerender(<MissionControl />);
    state.loading = false;
    rerender(<MissionControl />);
    expect(screen.getAllByRole("button", { name: "Assumptions" })).toHaveLength(
      2,
    );
    fireEvent.click(screen.getByText("Inspect P-101"));
    expect(screen.getAllByRole("button", { name: "Assumptions" })).toHaveLength(
      1,
    );
    expect(
      within(
        screen.getByText("Inspect C-22").closest(".rounded-xl")!,
      ).getByRole("button", { name: "Assumptions" }),
    ).toBeTruthy();
  });

  it("lets a reliability engineer classify an unclassified recommendation", async () => {
    state.rules = [
      {
        change_class: "pm_interval_change",
        title: "Change to a preventive-maintenance interval",
        required_role: "reliability_engineer",
        basis:
          "Proposed: an interval change must be reasoned from failure history.",
      },
    ];
    classifyEngineeringChange.mockResolvedValue({
      changeClass: "pm_interval_change",
      requiredRole: "reliability_engineer",
      classifiedByRole: "reliability_engineer",
      ruleStatus: "draft",
    });
    render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    fireEvent.change(screen.getByLabelText("Engineering change class"), {
      target: { value: "pm_interval_change" },
    });
    fireEvent.change(
      screen.getByLabelText("Why this engineering class applies"),
      {
        target: {
          value: "The recommendation changes the pump inspection interval.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Classify engineering change" }),
    );
    await waitFor(() => {
      expect(classifyEngineeringChange).toHaveBeenCalledWith(
        "C-22",
        "pm_interval_change",
        "The recommendation changes the pump inspection interval.",
      );
    });
  });

  it("does not offer classification to a role the rules do not name", () => {
    state.role = "technician";
    state.rules = [
      {
        change_class: "pm_interval_change",
        title: "Change to a preventive-maintenance interval",
        required_role: "reliability_engineer",
        basis:
          "Proposed: an interval change must be reasoned from failure history.",
      },
    ];
    render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    expect(screen.queryByLabelText("Engineering change class")).toBeNull();
    expect(screen.getByText(/This role cannot classify it/)).toBeTruthy();
  });

  it("shows the signature act once a class is already recorded", () => {
    state.data = {
      ...state.data!,
      topRecommendations: [
        {
          ...recommendation("C-22"),
          change_class: "repair_vs_replace",
        },
      ],
    };
    render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    expect(screen.getByText("repair_vs_replace")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Record sign-off" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Classify engineering change" }),
    ).toBeNull();
  });
});

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionControlData } from "../services/operatingLoopService";
import type { RecommendationRow } from "../types/operating";

const state = vi.hoisted(() => ({
  data: null as MissionControlData | null,
  loading: false,
  error: null,
  refetch: vi.fn(),
}));

vi.mock("../hooks/useAsyncData", () => ({ useAsyncData: () => state }));
vi.mock("../hooks/useRealtimeRefetch", () => ({
  useRealtimeRefetch: () => ({ live: false }),
}));
vi.mock("../hooks/useOnboardingOperatingLoop", () => ({
  useOnboardingOperatingLoop: () => ({ missionSignals: [] }),
}));
vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: "reliability_engineer" },
    user: { id: "engineer-1" },
  }),
}));
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

    expect(
      screen.getByRole("button", { name: "Assumptions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Verification plan" }),
    ).toBeTruthy();
    // The untouched second card remains collapsed; refresh must not expand all cards.
    expect(
      screen.getAllByRole("button", { name: "Assumptions" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByText("Inspect C-22"));
    expect(
      screen.queryByRole("button", { name: "Assumptions" }),
    ).toBeNull();
  });

  it("preserves independent expansion choices across realtime refreshes", () => {
    const { rerender } = render(<MissionControl />);
    fireEvent.click(screen.getByText("Inspect C-22"));
    fireEvent.click(screen.getByText("Inspect P-101"));
    state.loading = true;
    rerender(<MissionControl />);
    state.loading = false;
    rerender(<MissionControl />);
    expect(
      screen.getAllByRole("button", { name: "Assumptions" }),
    ).toHaveLength(2);
    fireEvent.click(screen.getByText("Inspect P-101"));
    expect(
      screen.getAllByRole("button", { name: "Assumptions" }),
    ).toHaveLength(1);
    expect(
      within(
        screen.getByText("Inspect C-22").closest(".rounded-xl")!,
      ).getByRole("button", { name: "Assumptions" }),
    ).toBeTruthy();
  });
});

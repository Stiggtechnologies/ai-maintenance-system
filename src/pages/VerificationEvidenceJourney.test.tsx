import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionControlData } from "../services/operatingLoopService";
import type { RecommendationRow } from "../types/operating";

const recordVerificationResult = vi.hoisted(() => vi.fn());
const recordRecommendationVerificationPlan = vi.hoisted(() => vi.fn());
const getRecommendationVerificationPlan = vi.hoisted(() => vi.fn());
const getVerificationPlanOwners = vi.hoisted(() => vi.fn());
const getOpenVerifications = vi.hoisted(() => vi.fn());
const getOpenObligationIdForRecommendation = vi.hoisted(() => vi.fn());
const getMissionControl = vi.hoisted(() => vi.fn());
const getLearningEvents = vi.hoisted(() => vi.fn());

const rpcState = vi.hoisted(() => ({
  open: [] as Array<Record<string, unknown>>,
}));

vi.mock("../services/operatingLoopService", () => ({
  recordVerificationResult: (...args: unknown[]) =>
    recordVerificationResult(...args),
  recordRecommendationVerificationPlan: (...args: unknown[]) =>
    recordRecommendationVerificationPlan(...args),
  getRecommendationVerificationPlan: (...args: unknown[]) =>
    getRecommendationVerificationPlan(...args),
  getVerificationPlanOwners: (...args: unknown[]) =>
    getVerificationPlanOwners(...args),
  getOpenVerifications: (...args: unknown[]) => getOpenVerifications(...args),
  getOpenObligationIdForRecommendation: (...args: unknown[]) =>
    getOpenObligationIdForRecommendation(...args),
  getMissionControl: (...args: unknown[]) => getMissionControl(...args),
  getLearningEvents: (...args: unknown[]) => getLearningEvents(...args),
  getScenarios: vi.fn(),
  approveRecommendation: vi.fn(),
  signEngineeringReview: vi.fn(),
  setRecommendationStatus: vi.fn(),
  createWorkOrderFromRecommendation: vi.fn(),
  submitChallengeFeedback: vi.fn(),
}));

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: "reliability_engineer" },
    user: { id: "engineer-1" },
  }),
}));

vi.mock("../hooks/useOnboardingOperatingLoop", () => ({
  useOnboardingOperatingLoop: () => ({
    missionSignals: [],
    learningEvents: [],
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

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((name: string) => {
      if (name === "get_verification_posture") {
        return Promise.resolve({
          data: [
            {
              actionedRecommendations: 1,
              withObligation: 1,
              openObligations: rpcState.open.length,
              overdue: 0,
              achieved: 0,
              notAchieved: 0,
              inconclusive: 0,
              waived: 0,
              actionedWithoutObligation: 0,
            },
          ],
          error: null,
        });
      }
      if (name === "get_open_verifications") {
        return Promise.resolve({ data: rpcState.open, error: null });
      }
      if (name === "get_unwatched_verification_actions") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    channel: () => {
      const api = {
        on: () => api,
        subscribe: () => api,
      };
      return api;
    },
    removeChannel: () => Promise.resolve(),
  },
}));

import { ConversationLearn } from "../components/chat/ConversationLearn";
import { LearningLoop } from "./LearningLoop";
import { MissionControl } from "./MissionControl";

const recommendation = (): RecommendationRow => ({
  id: "rec-c408",
  organization_id: "11111111-1111-4111-8111-111111111111",
  asset_id: "asset-1",
  agent_id: null,
  title: "Inspect seal on P-101",
  issue: "Seal leakage recurs after solids-heavy startup.",
  action: "Correct the verified startup seal mechanism.",
  impact: "Avoid repeated leakage.",
  confidence: 84,
  urgency: "action",
  status: "pending",
  accountable: "Reliability engineer",
  responsible: "Planner",
  consulted: "Operations",
  informed: "Maintenance manager",
  approval_required: "Maintenance manager",
  financial_impact: null,
  risk_impact: "Medium",
  rationale: "Exact-asset evidence supports a bounded inspection.",
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
});

const mission = (): MissionControlData => ({
  readinessScore: 75,
  readinessStatus: "Watch",
  readinessReason: "Verification plan is still open.",
  factors: [],
  topRisks: [],
  topRecommendations: [recommendation()],
  stats: {
    actionsExecuted: 0,
    pendingApprovals: 1,
    recommendationsToday: 1,
    autonomousRate: 0,
  },
  financialExposures: [],
  valueCreated: 0,
});

const evidenceObligation = {
  obligationId: "obl-1",
  recommendationId: "rec-c408",
  recommendationTitle: "Inspect seal on P-101",
  assetName: "P-101",
  method: "Compare leakage with the accepted baseline.",
  dueDate: "2027-01-15",
  dueDateAssumed: false,
  daysOverdue: 0,
  intendedOutcome: "The repeat seal leak is removed.",
  subjectKind: "recommendation",
  planComplete: true,
  evidenceRequired: true,
  acceptanceCriteria: "No visible leakage through 72 operating hours.",
  verificationOwnerName: "Riley Chen",
  evidenceCandidates: [
    {
      kind: "evidence_item",
      id: "evidence-1",
      label: "Validated leakage reading",
      sourceSystem: "syncai",
      sourceReference: "EV-1",
      observedAt: "2026-11-03T00:00:00Z",
    },
    {
      kind: "cmms_work_order",
      id: "wo-1",
      label: "WO-100 completed inspection",
      sourceSystem: "cmms-read",
      sourceReference: "100",
      observedAt: "2026-11-03T00:00:00Z",
    },
  ],
};

describe("C4.08 verification journey", () => {
  beforeEach(() => {
    recordVerificationResult.mockReset();
    recordRecommendationVerificationPlan.mockReset();
    getRecommendationVerificationPlan.mockReset();
    getVerificationPlanOwners.mockReset();
    getOpenVerifications.mockReset();
    getOpenObligationIdForRecommendation.mockReset();
    getMissionControl.mockReset();
    getLearningEvents.mockReset();
    rpcState.open = [evidenceObligation];
    getMissionControl.mockResolvedValue(mission());
    getLearningEvents.mockResolvedValue([]);
    getVerificationPlanOwners.mockResolvedValue([
      {
        ownerId: "owner-1",
        fullName: "Riley Chen",
        role: "reliability_engineer",
      },
    ]);
    getRecommendationVerificationPlan.mockResolvedValue({
      recommendationId: "rec-c408",
      obligationId: null,
      recommendationStatus: "pending",
      method: null,
      acceptanceCriteria: null,
      intendedOutcome: null,
      dueDate: null,
      dueDateAssumed: false,
      ownerId: null,
      ownerName: null,
      plannedBy: null,
      plannedAt: null,
      planComplete: false,
      state: "recommendation",
      legacyDebt: false,
      operationalAuthorization: false,
    });
    recordRecommendationVerificationPlan.mockResolvedValue({
      recommendationId: "rec-c408",
      obligationId: null,
      recommendationStatus: "pending",
      method: "Compare post-repair leakage with the accepted baseline.",
      acceptanceCriteria:
        "No visible leakage through 72 operating hours after the repair.",
      intendedOutcome: "The repeat startup seal leak is removed.",
      dueDate: "2027-01-15",
      dueDateAssumed: false,
      ownerId: "owner-1",
      ownerName: "Riley Chen",
      plannedBy: "engineer-1",
      plannedAt: "2026-11-03T00:00:00Z",
      planComplete: true,
      state: "recommendation_planned",
      legacyDebt: false,
      operationalAuthorization: false,
    });
    recordVerificationResult.mockResolvedValue({
      outcome: "recorded",
      learningEventId: "learn-1",
      detail: "Outcome recorded against one governed source.",
    });
    getOpenVerifications.mockResolvedValue([evidenceObligation]);
    getOpenObligationIdForRecommendation.mockResolvedValue("obl-1");
  });

  it("plans from Mission Control, then records one source from Learning Loop and LEARN", async () => {
    const missionView = render(<MissionControl />);
    fireEvent.click(await screen.findByText("Inspect seal on P-101"));
    fireEvent.click(screen.getByRole("button", { name: "Verification plan" }));
    expect(
      await screen.findByRole("heading", { name: "Outcome verification plan" }),
    ).toBeTruthy();
    expect(screen.getByText(/do not authorize work/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Verification method"), {
      target: {
        value: "Compare post-repair leakage with the accepted baseline.",
      },
    });
    fireEvent.change(screen.getByLabelText("Intended outcome"), {
      target: { value: "The repeat startup seal leak is removed." },
    });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: {
        value:
          "No visible leakage through 72 operating hours after the repair.",
      },
    });
    fireEvent.change(screen.getByLabelText("Outcome verification date"), {
      target: { value: "2027-01-15" },
    });
    fireEvent.change(screen.getByLabelText("Named verification owner"), {
      target: { value: "owner-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed verification plan" }),
    );

    await waitFor(() =>
      expect(recordRecommendationVerificationPlan).toHaveBeenCalledWith({
        recommendationId: "rec-c408",
        method: "Compare post-repair leakage with the accepted baseline.",
        acceptanceCriteria:
          "No visible leakage through 72 operating hours after the repair.",
        intendedOutcome: "The repeat startup seal leak is removed.",
        dueDate: "2027-01-15",
        ownerId: "owner-1",
      }),
    );
    expect(await screen.findByText(/Verification plan recorded/)).toBeTruthy();
    missionView.unmount();

    const learning = render(<LearningLoop />);
    expect(await screen.findByText("Named owner: Riley Chen")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Achieved"));
    fireEvent.change(screen.getByPlaceholderText(/vibration at 4.1 mm\/s/i), {
      target: { value: "Leakage stayed at zero through 72 operating hours." },
    });
    const submit = screen.getByRole("button", { name: "Record verification" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Governed evidence source/), {
      target: { value: "cmms_work_order:wo-1" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(recordVerificationResult).toHaveBeenCalledWith(
        "obl-1",
        "achieved",
        "Leakage stayed at zero through 72 operating hours.",
        null,
        "wo-1",
      ),
    );
    const recorded = recordVerificationResult.mock.calls[0];
    expect(recorded[3] == null || recorded[4] == null).toBe(true);
    expect((recorded[3] == null) === (recorded[4] == null)).toBe(false);
    learning.unmount();

    render(
      <MemoryRouter>
        <ConversationLearn
          signedIn
          simulatedApproval={false}
          recommendationId="rec-c408"
        />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("learn-evidence-select")).toBeTruthy();
    fireEvent.change(screen.getByTestId("learn-evidence-select"), {
      target: { value: "evidence_item:evidence-1" },
    });
    expect(await screen.findByTestId("learn-recorder")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Not achieved"));
    fireEvent.change(
      screen.getByPlaceholderText(/What was measured, against what, and when/),
      {
        target: {
          value: "Leakage returned to 4 drops per minute after 36 hours.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() => expect(recordVerificationResult).toHaveBeenCalledTimes(2));
    expect(recordVerificationResult).toHaveBeenLastCalledWith(
      "obl-1",
      "not_achieved",
      "Leakage returned to 4 drops per minute after 36 hours.",
      "evidence-1",
      null,
    );
  });
});

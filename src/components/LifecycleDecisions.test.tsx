import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LifecycleDecisions } from "./LifecycleDecisions";

const rpc = vi.fn();
const refetch = vi.fn();
let role = "maintenance_manager";
let position: Record<string, unknown>;

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: vi.fn(),
  },
}));

vi.mock("../hooks/useAsyncData", () => ({
  useAsyncData: () => ({
    data: position,
    loading: false,
    error: null,
    refetch,
    isEmpty: false,
  }),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    id: "evaluation-1",
    asset: "P-101",
    recommended: "replace",
    uncertainty: "moderate",
    uncertainty_reasons: ["Only four complete failure intervals are available."],
    rationale: "Replacement has the lowest supported annualized cost.",
    evaluated_at: "2026-10-02T12:00:00Z",
    decision: null,
    decision_note: null,
    options: [
      {
        option: "replace",
        annualCostUsd: 25000,
        missingInputs: [],
      },
      {
        option: "repair",
        annualCostUsd: 41000,
        missingInputs: [],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "maintenance_manager";
  position = {
    assets: 1,
    assets_with_economics: 1,
    economics_coverage_pct: 100,
    evaluations: [evaluation()],
    note: "One governed lifecycle evaluation is awaiting a human decision.",
  };
  rpc.mockResolvedValue({
    data: { evaluation_id: "evaluation-1", decision: "accepted" },
    error: null,
  });
});

describe("LifecycleDecisions", () => {
  it("lets an authorized human accept a recorded recommendation with reasoning", async () => {
    render(<LifecycleDecisions />);

    fireEvent.change(screen.getByLabelText("Decision basis for P-101"), {
      target: {
        value: "Approved after reviewing the recorded economics and uncertainty.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Accept replace recommendation" }),
    );

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("decide_lifecycle_evaluation", {
        p_id: "evaluation-1",
        p_decision: "accepted",
        p_note:
          "Approved after reviewing the recorded economics and uncertainty.",
      }),
    );
    expect(
      await screen.findByText("Human decision recorded: accepted."),
    ).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the server refusal and does not claim a decision", async () => {
    rpc.mockResolvedValue({
      data: { error: "this evaluation was already rejected" },
      error: null,
    });
    render(<LifecycleDecisions />);

    fireEvent.change(screen.getByLabelText("Decision basis for P-101"), {
      target: { value: "Defer until the missing evidence has been reviewed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Defer decision" }));

    expect(
      await screen.findByText("this evaluation was already rejected"),
    ).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does not offer the human decision controls to the AI-operator identity", () => {
    role = "ai_admin";
    render(<LifecycleDecisions />);

    expect(
      screen.getByText(/AI may prepare the evaluation, but cannot decide it/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Accept replace recommendation/i }),
    ).not.toBeInTheDocument();
  });

  it("cannot accept an evaluation that has no supported recommendation", () => {
    position = {
      ...(position as object),
      evaluations: [evaluation({ recommended: null, options: [] })],
    };
    render(<LifecycleDecisions />);

    expect(
      screen.getByRole("button", { name: "Accept recommendation unavailable" }),
    ).toBeDisabled();
  });
});

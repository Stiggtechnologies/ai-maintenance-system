import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LifecycleDecisions } from "./LifecycleDecisions";

const rpc = vi.fn();
const from = vi.fn();
const refetch = vi.fn();
let role = "maintenance_manager";
let position: Record<string, unknown>;

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
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
    uncertainty_reasons: [
      "Only four complete failure intervals are available.",
    ],
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
        value:
          "Approved after reviewing the recorded economics and uncertainty.",
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

  it("does not let a maintenance manager record the finance-owned discount rate", () => {
    render(<LifecycleDecisions />);
    expect(
      screen.queryByRole("button", { name: "Record discount policy" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/No governed real discount rate is loaded/i),
    ).toBeInTheDocument();
  });

  it("records a discount policy only from the finance-owner form", async () => {
    role = "executive";
    render(<LifecycleDecisions />);

    fireEvent.change(screen.getByLabelText("Rate (decimal)"), {
      target: { value: "0.07" },
    });
    fireEvent.change(screen.getByLabelText("Finance owner"), {
      target: { value: "Treasury committee" },
    });
    fireEvent.change(screen.getByLabelText("Basis"), {
      target: { value: "Treasury policy TP-12 real WACC 2026" },
    });
    fireEvent.change(screen.getByLabelText("Effective from"), {
      target: { value: "2026-11-03" },
    });
    fireEvent.change(screen.getByLabelText("Review due"), {
      target: { value: "2027-11-03" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record discount policy" }),
    );

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("record_lifecycle_discount_policy", {
        p_rate: 0.07,
        p_owner: "Treasury committee",
        p_basis: "Treasury policy TP-12 real WACC 2026",
        p_effective_from: "2026-11-03",
        p_review_due: "2027-11-03",
      }),
    );
  });

  it("persists the discounted comparison bound to the governed rate", async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      limit: () =>
        Promise.resolve({ data: [{ asset_id: "asset-1" }], error: null }),
    };
    from.mockReturnValue(chain);
    rpc.mockImplementation((name: string) => {
      if (name === "get_lifecycle_inputs") {
        return Promise.resolve({
          data: {
            asset_id: "asset-1",
            asset_name: "P-101",
            criticality: "B",
            inter_failure_hours: [400, 500, 650],
            hours_since_last_failure: 100,
            economics: {
              replacementValueUsd: 1000,
              annualMaintenanceCostUsd: 100,
              downtimeCostPerHourUsd: null,
              expectedRepairCostUsd: null,
              expectedRepairHours: null,
              expectedRemainingLifeYears: 10,
            },
            sufficient_for_failure_model: true,
          },
          error: null,
        });
      }
      if (name === "get_lifecycle_discount_policy") {
        return Promise.resolve({
          data: {
            assumptionId: "42",
            rateText: "0.07",
            owner: "Treasury committee",
            basis: "Treasury policy TP-12 real WACC 2026",
            refusal: null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { evaluation_id: "new" }, error: null });
    });

    render(<LifecycleDecisions />);
    fireEvent.click(
      screen.getByRole("button", { name: "Evaluate worst actor" }),
    );

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "record_lifecycle_evaluation",
        expect.objectContaining({
          p_asset_id: "asset-1",
          p_recommended: expect.stringMatching(/repair|replace|redesign|defer/),
        }),
      ),
    );
    const recorded = rpc.mock.calls.find(
      (call) => call[0] === "record_lifecycle_evaluation",
    )?.[1] as {
      p_recommended: string;
      p_inputs: {
        discountPolicy: { assumptionId: string; rateText: string };
        discounted: { preferred: string; refusal: string | null };
      };
      p_options: { option: string; annualCostUsd: number | null }[];
    };
    expect(recorded.p_inputs.discountPolicy).toMatchObject({
      assumptionId: "42",
      rateText: "0.07",
      owner: "Treasury committee",
    });
    expect(recorded.p_inputs.discounted.preferred).toBe(recorded.p_recommended);
    expect(recorded.p_inputs.discounted.refusal).toBeNull();
    expect(
      recorded.p_options.filter((option) => option.annualCostUsd != null)
        .length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("records an explicit refusal instead of a ranked recommendation when the rate is absent", async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      limit: () =>
        Promise.resolve({ data: [{ asset_id: "asset-1" }], error: null }),
    };
    from.mockReturnValue(chain);
    rpc.mockImplementation((name: string) => {
      if (name === "get_lifecycle_inputs") {
        return Promise.resolve({
          data: {
            asset_name: "P-101",
            criticality: null,
            inter_failure_hours: [400, 500],
            hours_since_last_failure: 100,
            economics: {
              replacementValueUsd: 1000,
              annualMaintenanceCostUsd: 100,
              downtimeCostPerHourUsd: null,
              expectedRepairCostUsd: null,
              expectedRepairHours: null,
              expectedRemainingLifeYears: 10,
            },
            sufficient_for_failure_model: true,
          },
          error: null,
        });
      }
      if (name === "get_lifecycle_discount_policy") {
        return Promise.resolve({
          data: {
            assumptionId: null,
            rateText: null,
            owner: null,
            basis: null,
            refusal:
              "No governed real discount rate is recorded for this tenant.",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { evaluation_id: "new" }, error: null });
    });

    render(<LifecycleDecisions />);
    fireEvent.click(
      screen.getByRole("button", { name: "Evaluate worst actor" }),
    );

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "record_lifecycle_evaluation",
        expect.objectContaining({ p_recommended: null }),
      ),
    );
    const recorded = rpc.mock.calls.find(
      (call) => call[0] === "record_lifecycle_evaluation",
    )?.[1] as { p_inputs: { discounted: { refusal: string } } };
    expect(recorded.p_inputs.discounted.refusal).toMatch(/not assumed/);
  });
});

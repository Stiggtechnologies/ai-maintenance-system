import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValueCalculationPayload } from "../services/valueCalculationService";
import { ValueManagement } from "./ValueManagement";

const runValueCalculations = vi.fn();

vi.mock("../services/valueCalculationService", () => ({
  runValueCalculations: (...args: unknown[]) => runValueCalculations(...args),
}));

function payload(
  sensitivity: ValueCalculationPayload["sensitivity"],
): ValueCalculationPayload {
  return {
    posture: null,
    businessCase: null,
    comparison: null,
    sensitivity,
    planYear: null,
    plan: [],
    prioritisation: null,
    refusals: { optionComparison: [], capitalPlan: [] },
    lineage: {
      optionComparisonRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      capitalPlanRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sensitivityRunId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
    governance: {
      advisory: true,
      operationalAuthorization: false,
      humanApprovalRequired: true,
      note: "These calculations support a decision; they do not approve a business case or authorize capital spending.",
    },
  };
}

describe("ValueManagement sensitivity", () => {
  beforeEach(() => {
    runValueCalculations.mockReset();
  });

  it("shows a solved break-even from the server payload and does not approve it", async () => {
    runValueCalculations.mockResolvedValue(
      payload({
        status: "computed",
        parameter: "discount_rate",
        baseValue: 0.05,
        discountRateSource: "recorded finance policy",
        basis: "npv",
        baseBest: "Invest",
        baseAlternative: "Do nothing",
        decision:
          "Margin of Invest over the best other recorded option on NPV.",
        breakEven: 0.1,
        headroomPct: 1,
        reason: "The decision reverses when discount rate reaches 0.1000.",
        refusal: null,
        uncertainty:
          "Headroom is the distance from the recorded point assumption to the break-even, not a confidence interval. SAP actuals are not read or substituted.",
        sapActualsUsed: false,
        searchLow: 0,
        searchHigh: 0.999999,
        sampledLeadLow: null,
        sampledLeadHigh: null,
      }),
    );

    render(<ValueManagement />);

    expect(
      await screen.findByRole("heading", { name: "Discount-rate sensitivity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10.00%")).toBeInTheDocument();
    expect(screen.getByText(/recorded finance policy/)).toBeInTheDocument();
    expect(screen.getByText(/run cccccccc/)).toBeInTheDocument();
    expect(screen.getByText(/not a confidence interval/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(runValueCalculations).toHaveBeenCalledWith(3_000_000);
  });

  it("shows a refused multi-crossing result with sample bounds, not a break-even", async () => {
    runValueCalculations.mockResolvedValue(
      payload({
        status: "refused",
        parameter: "discount_rate",
        baseValue: 0.08,
        discountRateSource: "DEMO — group finance policy 2026",
        basis: "equivalent_annual",
        baseBest: "Refurbish",
        baseAlternative: "Replace",
        decision: "Margin of Refurbish over the best other recorded option.",
        breakEven: null,
        headroomPct: null,
        reason:
          "The decision margin changes sign 2 times. A single break-even would overclaim.",
        refusal:
          "The decision margin changes sign 2 times. A single break-even would overclaim.",
        uncertainty: "not a confidence interval",
        sapActualsUsed: false,
        searchLow: 0,
        searchHigh: 0.999999,
        sampledLeadLow: 0.03124996875,
        sampledLeadHigh: 0.1874998125,
      }),
    );

    render(<ValueManagement />);

    expect(
      await screen.findByText("none in the stored domain"),
    ).toBeInTheDocument();
    expect(screen.getByText(/changes sign 2 times/)).toBeInTheDocument();
    expect(
      screen.getByText(/leads from 3\.12% through 18\.75%/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not solved break-evens/)).toBeInTheDocument();
    await waitFor(() => expect(runValueCalculations).toHaveBeenCalledTimes(1));
  });
});

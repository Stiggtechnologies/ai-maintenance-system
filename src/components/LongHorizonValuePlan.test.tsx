import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LongHorizonWorkspace } from "../services/longHorizonValuePlanService";

const getLongHorizonValuePlan = vi.fn();
const recordLongHorizonPlan = vi.fn();
const adoptLongHorizonPlan = vi.fn();

vi.mock("../services/longHorizonValuePlanService", () => ({
  getLongHorizonValuePlan: (...args: unknown[]) =>
    getLongHorizonValuePlan(...args),
  recordLongHorizonPlan: (...args: unknown[]) => recordLongHorizonPlan(...args),
  adoptLongHorizonPlan: (...args: unknown[]) => adoptLongHorizonPlan(...args),
}));

import { LongHorizonValuePlan } from "./LongHorizonValuePlan";

const workspace = {
  plans: [],
  decisionBoundary:
    "This plan composes recorded evidence. It does not commit expenditure.",
  selected: {
    planId: "plan-1",
    planCode: "SITE-A",
    version: 1,
    status: "draft" as const,
    startYear: 2027,
    endYear: 2028,
    currency: "CAD",
    forecastMethod: "recorded_only" as const,
    statedAnnualMaintenance: null,
    statedAnnualBasis: null,
    evidenceItemId: "evidence-1",
    basis: "Two recorded capital years.",
    calculationRunId: null,
    createdBy: "author",
    adoptedBy: null,
    expenditureAuthorized: false as const,
    projectSanctioned: false as const,
    workAuthorized: false as const,
    riskAccepted: false as const,
    returnToServiceAuthorized: false as const,
    lifecycleCost: {
      currency: "USD" as const,
      evaluationCount: 0,
      economicsSnapshotCount: 1,
      snapshotsWithAnnualMaintenance: 1,
      recordedAnnualMaintenanceUsd: 80000,
      horizonMultiplication: false as const,
      note: "Recorded annual maintenance stays in USD.",
    },
    risk: {
      openCount: 0,
      highOrCriticalCount: 0,
      currency: null,
      recordedValueAtRisk: null,
      valueWithheldReason: "no open governed risks",
    },
    performance: {
      recordCount: 0,
      unit: null,
      observedUnits: null,
      withheldReason: "no production records",
      label: "observed history, not a forecast",
    },
    resilience: {
      threatScenarioCount: 0,
      climateAssessmentCount: 0,
      score: null,
      note: "Exposure counts are not a resilience rating.",
    },
    capitalAllocation: {
      currency: "CAD",
      years: [
        {
          year: 2027,
          capitalStatus: "recorded" as const,
          capitalAmount: 1000,
          unknownCurrencyCount: 0,
          otherCurrencyCount: 0,
          maintenanceLineCount: 1,
          maintenanceForecastCount: 0,
          capitalBudgetLineCount: 0,
          maintenanceCurrency: null,
          statedMaintenance: null,
          yearTotal: 1000,
          yearTotalBasis: "recorded_capital",
        },
        {
          year: 2028,
          capitalStatus: "not_recorded" as const,
          capitalAmount: null,
          unknownCurrencyCount: 0,
          otherCurrencyCount: 0,
          maintenanceLineCount: 0,
          maintenanceForecastCount: 0,
          capitalBudgetLineCount: 0,
          maintenanceCurrency: null,
          statedMaintenance: null,
          yearTotal: null,
          yearTotalBasis: "not_recorded",
        },
      ],
      maintenanceAssumptionTotal: null,
      capitalHorizonTotal: null,
      combinedHorizonTotal: null,
      horizonTotalStatus: "withheld" as const,
      withheldReason: "a year in the horizon has no currency-matched capital",
      budgetLineNote: "budget lines record no currency",
    },
  },
} satisfies LongHorizonWorkspace;

beforeEach(() => {
  vi.clearAllMocks();
  getLongHorizonValuePlan.mockResolvedValue(workspace);
});

describe("LongHorizonValuePlan", () => {
  it("shows a withheld year instead of a zero and records a draft", async () => {
    recordLongHorizonPlan.mockResolvedValue({
      planId: "plan-2",
      planCode: "SITE-B",
      version: 1,
      status: "draft",
      expenditureAuthorized: false,
    });
    render(<LongHorizonValuePlan />);
    expect(await screen.findByText(/not treated as zero/)).toBeInTheDocument();
    expect(
      screen.getByText(/budget lines record no currency/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/withheld — a year in the horizon/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Plan code"), {
      target: { value: "SITE-B" },
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "CAD" },
    });
    fireEvent.change(screen.getByLabelText("Start year"), {
      target: { value: "2027" },
    });
    fireEvent.change(screen.getByLabelText("End year"), {
      target: { value: "2028" },
    });
    fireEvent.change(screen.getByLabelText("Independently verified evidence"), {
      target: { value: "evidence-2" },
    });
    fireEvent.change(screen.getByLabelText("Plan basis"), {
      target: {
        value: "The horizon names the two planning years under review.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record draft plan" }));

    await waitFor(() =>
      expect(recordLongHorizonPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          planCode: "SITE-B",
          forecastMethod: "recorded_only",
          statedAnnualMaintenance: null,
        }),
      ),
    );
    expect(
      await screen.findByText(/No expenditure was authorized/),
    ).toBeInTheDocument();
  });

  it("shows the server refusal when the author tries to adopt", async () => {
    adoptLongHorizonPlan.mockRejectedValue(
      new Error("the author cannot adopt their own long-horizon plan"),
    );
    render(<LongHorizonValuePlan />);
    await screen.findByText(/not treated as zero/);
    fireEvent.change(screen.getByLabelText("Adoption note"), {
      target: {
        value: "Reviewed the missing year and the withheld horizon total.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adopt plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /author cannot adopt/,
    );
  });
});

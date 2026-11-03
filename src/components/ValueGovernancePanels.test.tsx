import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRates, recordRate, getLoss } = vi.hoisted(() => ({
  listRates: vi.fn(),
  recordRate: vi.fn(),
  getLoss: vi.fn(),
}));

vi.mock("../services/valueGovernanceService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/valueGovernanceService")>();
  return {
    ...actual,
    listProductionLossUnitValues: listRates,
    recordProductionLossUnitValue: recordRate,
  };
});

vi.mock("../services/productionLossService", () => ({
  getProductionLossReconciliation: getLoss,
}));

import {
  CostOfRiskCalculation,
  ProductionLossValuation,
} from "./ValueGovernancePanels";

const reconciliation = {
  windowDays: 90,
  summary: {
    downEvents: 2,
    downHours: 6,
    classifiedHours: 6,
    unclassifiedDownHours: 0,
    classificationCoveragePct: 100,
    measurableEvents: 2,
    lossByUnit: [
      { unitOfMeasure: "t", events: 2, estimatedUnitsLost: 12.5 },
      { unitOfMeasure: "bbl", events: 1, estimatedUnitsLost: 4 },
    ],
  },
  events: [],
  eventsReturned: 0,
  eventsTruncated: false,
  categories: [],
  constraints: [],
  basis: "measured",
  authority: "advisory",
};

beforeEach(() => {
  listRates.mockReset();
  recordRate.mockReset();
  getLoss.mockReset();
  listRates.mockResolvedValue([
    {
      id: 4,
      assumptionKey: "production_loss_unit_value:t",
      unitOfMeasure: "t",
      currency: "USD",
      valuePerUnit: 80,
      unit: "USD/t",
      source: "Mine plan realised margin",
      effectiveFrom: "2026-10-01",
      reviewDue: null,
      label: "Lost production value per t",
    },
  ]);
  getLoss.mockResolvedValue(reconciliation);
});

describe("ProductionLossValuation", () => {
  it("prices the matching measured unit and leaves the other unvalued", async () => {
    render(<ProductionLossValuation />);
    expect(
      await screen.findByText((text) => /USD\s+1[,.]?000/.test(text)),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No sourced unit value is recorded for bbl/),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/Mine plan realised margin/).length,
    ).toBeGreaterThan(0);
  });

  it("records a new assumption version and does not invent a quantity", async () => {
    listRates.mockResolvedValue([]);
    getLoss.mockResolvedValue({
      ...reconciliation,
      summary: { ...reconciliation.summary, lossByUnit: [] },
    });
    recordRate.mockResolvedValue({
      version_id: 8,
      assumption_key: "production_loss_unit_value:t",
    });
    render(<ProductionLossValuation />);
    expect(
      await screen.findByText(/not applied to an invented quantity/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Measured unit"), {
      target: { value: "t" },
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText("Value per unit"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("Source"), {
      target: { value: "Mine plan realised margin" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record production-loss value" }),
    );
    await waitFor(() =>
      expect(recordRate).toHaveBeenCalledWith({
        unitOfMeasure: "t",
        currency: "USD",
        valuePerUnit: 80,
        source: "Mine plan realised margin",
        effectiveFrom: null,
        reviewDue: null,
      }),
    );
    expect(await screen.findByText(/version 8/)).toBeInTheDocument();
  });

  it("shows the server refusal and does not clear it into a zero value", async () => {
    recordRate.mockRejectedValue(
      new Error(
        "recording a financial assumption requires a planning, engineering or governance role",
      ),
    );
    render(<ProductionLossValuation />);
    await screen.findByRole("heading", { name: "Production-loss valuation" });
    fireEvent.change(screen.getByLabelText("Measured unit"), {
      target: { value: "t" },
    });
    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "USD" },
    });
    fireEvent.change(screen.getByLabelText("Value per unit"), {
      target: { value: "90" },
    });
    fireEvent.change(screen.getByLabelText("Source"), {
      target: { value: "Updated commercial settlement" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record production-loss value" }),
    );
    expect(
      await screen.findByText(/planning, engineering or governance role/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/USD 0/)).not.toBeInTheDocument();
  });
});

describe("CostOfRiskCalculation", () => {
  it("states the expectation and that expected value is not risk", () => {
    render(<CostOfRiskCalculation />);
    fireEvent.change(screen.getByLabelText(/Annual probability/), {
      target: { value: "0.02" },
    });
    fireEvent.change(screen.getByLabelText("Consequence cost"), {
      target: { value: "5000000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Calculate cost of risk" }),
    );
    expect(
      screen.getByText(/Expected annual cost 100,000/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Expected value is not risk/)).toBeInTheDocument();
    expect(screen.getByText(/one event every 50 years/)).toBeInTheDocument();
  });

  it("shows the kernel refusal and does not present zero as the cost", () => {
    render(<CostOfRiskCalculation />);
    fireEvent.change(screen.getByLabelText(/Annual probability/), {
      target: { value: "1.4" },
    });
    fireEvent.change(screen.getByLabelText("Consequence cost"), {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Calculate cost of risk" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/between 0 and 1/);
    expect(
      screen.queryByText(/Expected annual cost \d/),
    ).not.toBeInTheDocument();
  });

  it("refuses a negative consequence instead of showing a gain as a cost", () => {
    render(<CostOfRiskCalculation />);
    fireEvent.change(screen.getByLabelText(/Annual probability/), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByLabelText("Consequence cost"), {
      target: { value: "-1000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Calculate cost of risk" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/non-negative loss/);
    expect(
      screen.queryByText(/Expected annual cost \d/),
    ).not.toBeInTheDocument();
  });
});

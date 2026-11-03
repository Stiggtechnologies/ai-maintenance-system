import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceBudgetForecast } from "./MaintenanceBudgetForecast";

const getWorkspace = vi.fn();
const recordLine = vi.fn();
const refreshForecast = vi.fn();

vi.mock("../services/maintenanceBudgetService", () => ({
  getMaintenanceBudgetWorkspace: (...args: unknown[]) => getWorkspace(...args),
  recordMaintenanceBudgetLine: (...args: unknown[]) => recordLine(...args),
  refreshMaintenanceBudgetForecast: (...args: unknown[]) =>
    refreshForecast(...args),
}));

const WORKSPACE = {
  year: 2026,
  siteId: null,
  sites: [{ id: "site-1", name: "North" }],
  lines: [
    {
      id: 7,
      budgetYear: 2026,
      category: "labour",
      siteId: null,
      siteName: null,
      budgeted: 1000,
      budgetBasis: "Approved annual labour budget from the finance pack.",
      committed: 0,
      committedBasis: null,
      actual: 2950000,
      actualMeasured: false,
      forecast: null,
      forecastBasis: null,
      version: 2,
    },
  ],
  previews: [
    {
      category: "labour",
      currency: "USD",
      forecastable: true,
      forecast: 750,
      actualInYear: 460,
      actualMeasured: true,
      basis: "Labour actuals are completed work-order labour hours.",
      reason: "A trend was fitted.",
    },
    {
      category: "contract",
      currency: null,
      forecastable: false,
      forecast: null,
      actualInYear: null,
      actualMeasured: false,
      basis: "This category has no currency-safe recorded actual stream.",
      reason: "This category has no currency-safe recorded actual stream.",
    },
  ],
  authority: {
    expenditureAuthorized: false,
    budgetApproved: false,
    workAuthorized: false,
    externalFinanceSystemRead: false,
    note: "It does not authorize expenditure.",
  },
};

describe("MaintenanceBudgetForecast", () => {
  beforeEach(() => {
    getWorkspace.mockReset();
    recordLine.mockReset();
    refreshForecast.mockReset();
    getWorkspace.mockResolvedValue(WORKSPACE);
  });

  it("shows a measured labour forecast and a refused category", async () => {
    render(<MaintenanceBudgetForecast />);
    expect(await screen.findByText("750.00 USD")).toBeInTheDocument();
    expect(screen.getByText("Forecast refused")).toBeInTheDocument();
    expect(
      screen.getAllByText(/does not authorize expenditure/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/or read SAP/i)).toBeInTheDocument();
    expect(
      screen.getByText(/actual not measured by this forecast/),
    ).toBeInTheDocument();
  });

  it("records the budget without sending a forecast number", async () => {
    recordLine.mockResolvedValue({
      budgetLineId: 8,
      version: 1,
      forecastable: true,
      forecast: 750,
      actualMeasured: true,
      currency: "USD",
      basis: "computed",
      expenditureAuthorized: false,
      budgetApproved: false,
      workAuthorized: false,
      externalFinanceSystemRead: false,
    });
    render(<MaintenanceBudgetForecast />);
    await screen.findByText("750.00 USD");
    fireEvent.change(screen.getByLabelText("Budgeted amount"), {
      target: { value: "4200" },
    });
    fireEvent.change(screen.getByLabelText("Budget basis"), {
      target: { value: "Finance pack for the 2026 labour budget." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record budget and forecast" }),
    );
    await waitFor(() => expect(recordLine).toHaveBeenCalledOnce());
    expect(recordLine.mock.calls[0][0]).toMatchObject({
      category: "labour",
      budgeted: 4200,
      expectedVersion: 2,
    });
    expect(recordLine.mock.calls[0][0]).not.toHaveProperty("forecast");
    expect(await screen.findByText(/Recorded version 1/)).toBeInTheDocument();
  });

  it("refreshes an existing line by its version", async () => {
    refreshForecast.mockResolvedValue({
      budgetLineId: 7,
      version: 3,
      forecastable: false,
      forecast: null,
      actualMeasured: false,
      currency: null,
      basis: "refused",
      expenditureAuthorized: false,
      budgetApproved: false,
      workAuthorized: false,
      externalFinanceSystemRead: false,
    });
    render(<MaintenanceBudgetForecast />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh forecast" }),
    );
    await waitFor(() => expect(refreshForecast).toHaveBeenCalledOnce());
    expect(refreshForecast.mock.calls[0][0]).toEqual({
      year: 2026,
      category: "labour",
      siteId: null,
      expectedVersion: 2,
    });
    expect(await screen.findByText(/records the refusal/)).toBeInTheDocument();
  });
});

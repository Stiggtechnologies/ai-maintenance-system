import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPlans, record, forecast, review, verify, assets, sites } =
  vi.hoisted(() => ({
    getPlans: vi.fn(),
    record: vi.fn(),
    forecast: vi.fn(),
    review: vi.fn(),
    verify: vi.fn(),
    assets: vi.fn(),
    sites: vi.fn(),
  }));

vi.mock("../services/productionPlanForecastService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/productionPlanForecastService")
    >();
  return {
    ...actual,
    getProductionPlanLossForecast: getPlans,
    recordProductionPlan: record,
    forecastProductionPlanLoss: forecast,
    reviewProductionPlanForecast: review,
    verifyProductionPlanForecast: verify,
  };
});

vi.mock("../services/reliabilityCallers", () => ({
  listAssetsForContext: assets,
  listSites: sites,
}));

import { ProductionPlanLossForecast } from "./ProductionPlanLossForecast";

const savedPlan = {
  plans: [
    {
      planId: "plan-1",
      planKey: "sap-000001234567",
      title: "Reviewed SAP planned-order sample",
      sourceKind: "sap_s4_planned_order",
      sourceSystem: "sap_s4_planned_order",
      payloadSha256: "abc",
      basis:
        "Reviewed local SAP planned-order sample for the December campaign.",
      siteId: null,
      recordedAt: "2026-11-03T00:00:00Z",
      supersedesPlanId: null,
      superseded: false,
      lines: [],
      forecast: {
        forecastId: "forecast-1",
        generatedAt: "2026-11-03T01:00:00Z",
        generatedBy: "user-1",
        historyDays: 180,
        frozenVerificationState: "counterfactual",
        verificationState: "counterfactual",
        planStatus: "partial",
        byUnit: [
          {
            unitOfMeasure: "TO",
            forecastedLines: 1,
            refusedLines: 1,
            plannedQuantityForecast: 1250.5,
            expectedUnitsAtRisk: 125.05,
            complete: false,
          },
        ],
        lines: [
          {
            lineNo: 1,
            assetId: "asset-1",
            assetName: "Crusher",
            assetTag: "CR-1",
            plannedQuantity: 1250.5,
            unitOfMeasure: "TO",
            windowStart: "2026-12-01T00:00:00Z",
            windowEnd: "2026-12-15T00:00:00Z",
            status: "forecast",
            refusal: null,
            stateCoveragePct: 80,
            demonstratedRate: 5,
            unplannedShare: 0.1,
            expectedUnitsAtRisk: 125.05,
            expectedAttainableUnits: 1125.45,
            historicalEventLossP50: null,
            historicalEventLossP80: null,
            percentileSample: 3,
            productionRecordCount: 4,
            unplannedEvents: 3,
          },
          {
            lineNo: 2,
            assetId: "asset-2",
            assetName: "Mill",
            assetTag: "ML-1",
            plannedQuantity: 800,
            unitOfMeasure: "TO",
            windowStart: "2026-12-05T06:00:00Z",
            windowEnd: "2026-12-20T18:00:00Z",
            status: "not_assessable",
            refusal: "No operating-state history is available.",
            stateCoveragePct: 0,
            demonstratedRate: null,
            unplannedShare: null,
            expectedUnitsAtRisk: null,
            expectedAttainableUnits: null,
            historicalEventLossP50: null,
            historicalEventLossP80: null,
            percentileSample: 0,
            productionRecordCount: 0,
            unplannedEvents: 0,
          },
        ],
        basis:
          "Point forecast is planned quantity times the unplanned share of covered time.",
        authority:
          "Advisory draft only. This forecast does not change the production plan.",
        rollupBasis: "Unlike units are never added.",
        reviews: [],
        verification: null,
      },
    },
  ],
  basis:
    "Point forecast is planned quantity times the unplanned share of covered time.",
  authority: "Advisory draft only.",
};

describe("ProductionPlanLossForecast", () => {
  beforeEach(() => {
    getPlans.mockResolvedValue({ plans: [], basis: "", authority: "" });
    assets.mockResolvedValue([
      { id: "asset-1", name: "Crusher", asset_tag: "CR-1" },
      { id: "asset-2", name: "Mill", asset_tag: "ML-1" },
    ]);
    sites.mockResolvedValue([{ id: "site-1", name: "North" }]);
    record.mockReset();
    forecast.mockReset();
    review.mockReset();
    verify.mockReset();
  });

  it("loads a mocked SAP document, requires an asset, and records without contacting SAP", async () => {
    record.mockResolvedValue({ planId: "plan-1", idempotent: false });
    render(<ProductionPlanLossForecast />);
    expect(
      await screen.findByRole("heading", {
        name: /production-plan loss forecast/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent to SAP/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /No monetary value is calculated|does not change the production plan/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /load mocked sap planned-order sample/i,
      }),
    );
    expect(
      await screen.findByText(/Planned order 000001234567/),
    ).toBeInTheDocument();
    expect(screen.getByText(/FG-100/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/Nothing is sent to SAP/).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: /record production plan/i }),
    );
    expect(
      await screen.findByText(
        /Every planned order still needs a canonical asset/,
      ),
    ).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText("Asset for planned order 000001234567"),
      { target: { value: "asset-1" } },
    );
    fireEvent.change(
      screen.getByLabelText("Asset for planned order 000001234568"),
      { target: { value: "asset-2" } },
    );
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: {
        value:
          "Reviewed the local SAP planned-order sample against the December campaign.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /record production plan/i }),
    );

    await waitFor(() => expect(record).toHaveBeenCalledTimes(1));
    const input = record.mock.calls[0][0];
    expect(input.sourceKind).toBe("sap_s4_planned_order");
    expect(input.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.lines).toEqual([
      expect.objectContaining({
        assetId: "asset-1",
        plannedQuantity: 1250.5,
        unitOfMeasure: "TO",
        sourceExternalId: "000001234567",
        material: "FG-100",
      }),
      expect.objectContaining({
        assetId: "asset-2",
        sourceExternalId: "000001234568",
        material: "FG-110",
      }),
    ]);
    expect(JSON.stringify(input)).not.toMatch(/https?:\/\//);
  });

  it("shows a counterfactual plan forecast with refusals and no monetary total", async () => {
    getPlans.mockResolvedValue(savedPlan);
    forecast.mockResolvedValue({ forecastId: "forecast-2" });
    verify.mockResolvedValue({
      verified: false,
      refusal:
        "The plan horizon has not ended; the forecast stays counterfactual.",
    });
    render(<ProductionPlanLossForecast />);
    expect(
      (await screen.findAllByText("Counterfactual until verified")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/125\.05/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/No operating-state history is available/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No monetary value is calculated/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/P50\/P80 withheld \(3 events\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /forecast plan loss/i }),
    );
    await waitFor(() => expect(forecast).toHaveBeenCalledWith("plan-1", 180));

    fireEvent.click(
      screen.getByRole("button", { name: /verify against actual production/i }),
    );
    expect(
      await screen.findByText(/forecast stays counterfactual/),
    ).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith("forecast-1");
  });
});

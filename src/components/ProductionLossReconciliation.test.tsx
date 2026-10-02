import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getLoss, classify } = vi.hoisted(() => ({
  getLoss: vi.fn(),
  classify: vi.fn(),
}));

vi.mock("../services/productionLossService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/productionLossService")>();
  return {
    ...actual,
    getProductionLossReconciliation: getLoss,
    classifyDowntimeEvent: classify,
  };
});

import { ProductionLossReconciliation } from "./ProductionLossReconciliation";

const payload = {
  windowDays: 90,
  summary: {
    downEvents: 1,
    downHours: 4,
    classifiedHours: 0,
    unclassifiedDownHours: 4,
    classificationCoveragePct: 0,
    measurableEvents: 0,
    lossByUnit: [],
  },
  events: [
    {
      operatingStateId: 7,
      assetId: "asset-1",
      assetTag: "P-101",
      asset: "Process Pump 101",
      state: "down_unplanned",
      reasonCode: "TRIP",
      sourceSystem: "plant_historian",
      externalId: "trip-7",
      startedAt: "2026-09-01T00:00:00Z",
      endedAt: "2026-09-01T04:00:00Z",
      downHours: 4,
      classification: "unclassified",
      classificationBasis: null,
      classificationReviewId: null,
      supersedesId: null,
      classifiedAt: null,
      classifiedBy: null,
      workOrder: null,
      workOrderId: null,
      candidateWorkOrders: [],
      constraintSignalId: null,
      constraintKind: null,
      constraintKey: null,
      constraintState: null,
      constraintValidUntil: null,
      constraintBasis: null,
      measurementState: "not_measurable",
      measurementRefusal:
        "No completed production records are recorded in the window.",
      demonstratedRate: null,
      runningHours: null,
      productionUnits: null,
      productionRecordCount: null,
      unitOfMeasure: null,
      estimatedUnitsLost: null,
    },
  ],
  eventsReturned: 1,
  eventsTruncated: false,
  categories: [
    {
      classification: "unclassified",
      events: 1,
      downHours: 4,
      sharePct: 100,
    },
  ],
  constraints: [
    {
      id: "signal-1",
      kind: "production",
      key: "feed-limited",
      state: "unavailable",
      assetId: "asset-1",
      siteId: null,
      observedAt: "2026-09-01T00:00:00Z",
      validUntil: "2099-09-01T05:00:00Z",
      current: true,
      sourceSystem: "plant_historian",
      sourceRef: "tag-22",
      basis: "Feed header pressure was below its operating limit.",
    },
  ],
  basis: "Demonstrated production only; never nameplate.",
  authority: "Advisory evidence only.",
};

describe("ProductionLossReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLoss.mockResolvedValue(payload);
    classify.mockResolvedValue({ classified: true });
  });

  it("keeps missing production evidence visibly not measurable", async () => {
    render(<ProductionLossReconciliation />);
    expect(
      await screen.findByRole("heading", {
        name: /production loss reconciliation/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/not measurable/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/no nameplate assumptions/i)).toBeInTheDocument();
  });

  it("requires and submits canonical constraint evidence for constrained classifications", async () => {
    render(<ProductionLossReconciliation />);
    fireEvent.click(await screen.findByRole("button", { name: "Classify" }));
    fireEvent.change(screen.getByLabelText(/classification for p-101/i), {
      target: { value: "upstream_constraint" },
    });
    fireEvent.change(screen.getByLabelText(/supporting constraint signal/i), {
      target: { value: "signal-1" },
    });
    fireEvent.change(screen.getByLabelText(/classification evidence basis/i), {
      target: {
        value:
          "Historian feed-pressure evidence confirms the upstream constraint.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /record review/i }));

    await waitFor(() => expect(classify).toHaveBeenCalledTimes(1));
    expect(classify).toHaveBeenCalledWith({
      operatingStateId: 7,
      classification: "upstream_constraint",
      basis:
        "Historian feed-pressure evidence confirms the upstream constraint.",
      expectedReviewId: null,
      constraintSignalId: "signal-1",
      workOrderId: null,
    });
  });
});

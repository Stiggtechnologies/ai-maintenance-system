import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetOperationalMonitor } from "./AssetOperationalMonitor";
import * as service from "../services/assetOperationalMonitorService";

vi.mock("../services/assetOperationalMonitorService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/assetOperationalMonitorService")
  >("../services/assetOperationalMonitorService");
  return { ...actual, loadAssetOperationalMonitor: vi.fn() };
});

const payload: service.AssetOperationalMonitor = {
  asset: {
    id: "asset-1",
    tag: "P-101",
    name: "Pump 101",
    criticality: "high",
    status: "watch",
  },
  windowDays: 90,
  windowStart: "2026-07-07T00:00:00Z",
  condition: {
    summary: {
      readings: 24,
      sensors: 2,
      goodReadings: 23,
      suspectOrBadReadings: 1,
      openAlerts: 1,
      alarmAlerts: 0,
      latestReadingAt: "2026-10-05T09:00:00Z",
    },
    readings: [
      {
        id: 1,
        sensorId: "sensor-1",
        sensor: "Drive-end vibration",
        signalType: "vibration_velocity",
        value: 5.2,
        unit: "mm/s RMS",
        quality: "good",
        takenAt: "2026-10-05T09:00:00Z",
        sourceSystem: "PI",
      },
    ],
    alerts: [],
    basis: "Canonical condition evidence.",
  },
  work: {
    summary: {
      orders: 3,
      openOrders: 1,
      completedOrders: 2,
      correctiveOrders: 2,
      safetyFlagged: 0,
      latestActivityAt: "2026-10-05T08:00:00Z",
    },
    orders: [
      {
        id: "wo-1",
        number: "WO-101",
        title: "Inspect vibration",
        status: "pending",
        priority: "high",
        workType: "corrective",
        safetyFlag: false,
        productionImpact: "Potential derate",
        createdAt: "2026-10-05T08:00:00Z",
        completedAt: null,
      },
    ],
    basis: "Canonical work history.",
  },
  production: {
    summary: {
      runningHours: 10,
      downHours: 2,
      stateRows: 2,
      productionRecords: 1,
      productionUnits: 1000,
      unitOfMeasure: "tonnes",
      demonstratedRate: 100,
      estimatedUnitsLost: 200,
      measurementState: "demonstrated_rate",
      measurementRefusal: null,
      latestStateAt: "2026-10-05T07:00:00Z",
      latestProductionAt: "2026-10-05T07:00:00Z",
    },
    states: [
      {
        id: 1,
        state: "down_unplanned",
        loadPct: 0,
        startedAt: "2026-10-05T07:00:00Z",
        endedAt: null,
        reasonCode: "vibration",
        sourceSystem: "PI",
      },
    ],
    basis: "Demonstrated production rate only.",
    authority: "Evidence only.",
  },
  risk: {
    summary: {
      emergingRisks: 1,
      warningIndicators: 1,
      criticalIndicators: 0,
      latestSignalAt: "2026-10-05T09:00:00Z",
    },
    risks: [
      {
        id: "risk-1",
        title: "Bearing degradation",
        objectiveAtRisk: "Preserve throughput",
        status: "monitoring",
        level: "High",
        score: 62,
        velocity: 12,
        decisionAction: "MONITOR",
        reviewDate: null,
        updatedAt: "2026-10-05T09:00:00Z",
        indicators: [
          {
            id: "indicator-1",
            name: "Drive-end vibration",
            state: "warning",
            value: 5.2,
            unit: "mm/s RMS",
            observedAt: "2026-10-05T09:00:00Z",
            sourceSystem: "PI",
          },
        ],
      },
    ],
    basis: "Sensitivity-filtered risks.",
  },
  authority: {
    readOnly: true,
    mayCreateWork: false,
    mayChangeWork: false,
    mayApprove: false,
    mayAcceptRisk: false,
    mayCommitSpend: false,
    mayChangeOperatingLimits: false,
    mayReturnToService: false,
  },
};

describe("AssetOperationalMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.loadAssetOperationalMonitor).mockResolvedValue(payload);
  });

  it("renders all four operational evidence streams and the authority boundary", async () => {
    render(<AssetOperationalMonitor assetId="asset-1" />);
    expect(
      await screen.findByText("Operational evidence monitor"),
    ).toBeInTheDocument();
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("Work history")).toBeInTheDocument();
    expect(screen.getByText("Production impact")).toBeInTheDocument();
    expect(screen.getByText("Emerging risk")).toBeInTheDocument();
    expect(screen.getByText(/200 tonnes at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/Bearing degradation/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot create work/i)).toBeInTheDocument();
    expect(service.loadAssetOperationalMonitor).toHaveBeenCalledWith(
      "asset-1",
      90,
    );
  });
});

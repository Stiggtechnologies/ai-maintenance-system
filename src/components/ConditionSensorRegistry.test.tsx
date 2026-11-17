import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConditionSensorRegistry } from "./ConditionSensorRegistry";

const load = vi.fn();
const upsert = vi.fn();
const decommission = vi.fn();
const reactivate = vi.fn();

vi.mock("../services/conditionSensorRegistryService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/conditionSensorRegistryService")
  >("../services/conditionSensorRegistryService");
  return {
    ...actual,
    loadConditionSensorRegistry: () => load(),
    upsertConditionSensor: (...args: unknown[]) => upsert(...args),
    decommissionConditionSensor: (...args: unknown[]) => decommission(...args),
    reactivateConditionSensor: (...args: unknown[]) => reactivate(...args),
  };
});

const activeSensor = {
  sensorId: "sensor-1",
  assetId: "asset-1",
  assetTag: "P-101",
  assetName: "Process pump 101",
  sensorTag: "P101-VIB-DE",
  name: "Drive-end vibration",
  signalType: "vibration_velocity",
  unit: "mm/s RMS",
  detectionTechnique: "Vibration analysis",
  warningLimit: 4.5,
  alarmLimit: 7.1,
  limitDirection: "above" as const,
  sourceSystem: "PI-HISTORIAN",
  registryStatus: "active" as const,
  configurationVersion: 3,
  configurationBasis: "Approved instrument index revision 12.",
  configuredAt: "2026-10-02T00:00:00Z",
  readingCount: 12,
  latestReadingAt: "2026-10-02T00:00:00Z",
  calibration: null,
  diagnosticReportCount: 2,
  latestDiagnosticReportAt: "2026-10-02T00:00:00Z",
  historyCount: 3,
  lastValue: 3.2,
  currentStatus: "normal",
  trend: "stable",
};

function workspace(sensors = [activeSensor]) {
  return {
    assets: [
      {
        assetId: "asset-1",
        assetTag: "P-101",
        name: "Process pump 101",
      },
    ],
    sensors,
    canManage: true,
    basis: "Canonical tenant sensor registry.",
    boundary: "No operational authorization is granted.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(workspace());
  upsert.mockResolvedValue({
    sensorId: "sensor-new",
    version: 1,
    status: "active",
    action: "registered",
    operationalAuthorization: false,
  });
  decommission.mockResolvedValue({
    sensorId: "sensor-1",
    version: 4,
    status: "decommissioned",
    historyPreserved: true,
    operationalAuthorization: false,
  });
});

describe("ConditionSensorRegistry", () => {
  it("registers a customer measurement point without inventing limits", async () => {
    render(<ConditionSensorRegistry />);
    await screen.findByText("Condition sensor registry");
    await waitFor(() =>
      expect(screen.getByLabelText("Canonical asset")).toHaveValue("asset-1"),
    );
    fireEvent.change(screen.getByLabelText("Sensor tag"), {
      target: { value: "P101-TEMP-DE" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Drive-end temperature" },
    });
    fireEvent.change(screen.getByLabelText("Signal type"), {
      target: { value: "bearing_temperature" },
    });
    fireEvent.change(screen.getByLabelText("Engineering unit"), {
      target: { value: "°C" },
    });
    fireEvent.change(screen.getByLabelText("Configuration basis"), {
      target: {
        value: "Approved instrument index and installation drawing.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register sensor" }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-1",
          sensorTag: "P101-TEMP-DE",
          signalType: "bearing_temperature",
          unit: "°C",
          warningLimit: null,
          alarmLimit: null,
          expectedVersion: undefined,
        }),
      ),
    );
  });

  it("records a version-bound decommission while promising history preservation", async () => {
    render(<ConditionSensorRegistry />);
    fireEvent.change(await screen.findByLabelText("Registry sensor"), {
      target: { value: "sensor-1" },
    });
    const reason = await screen.findByPlaceholderText(
      "Decommissioning reason (10+ characters)",
    );
    fireEvent.change(reason, {
      target: { value: "Instrument physically removed after field review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decommission" }));
    await waitFor(() =>
      expect(decommission).toHaveBeenCalledWith({
        sensorId: "sensor-1",
        reason: "Instrument physically removed after field review.",
        expectedVersion: 3,
      }),
    );
    expect(screen.getByText(/never deletes history/i)).toBeInTheDocument();
  });
});

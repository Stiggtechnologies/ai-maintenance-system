import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  decommissionConditionSensor,
  loadConditionSensorRegistry,
  reactivateConditionSensor,
  upsertConditionSensor,
} from "./conditionSensorRegistryService";

beforeEach(() => vi.clearAllMocks());

describe("conditionSensorRegistryService", () => {
  it("loads the tenant registry through the governed read model", async () => {
    rpc.mockResolvedValue({
      data: {
        assets: [],
        sensors: [],
        canManage: true,
        basis: "Canonical sensor registry.",
        boundary: "No operational authorization.",
      },
      error: null,
    });
    const result = await loadConditionSensorRegistry();
    expect(result.canManage).toBe(true);
    expect(rpc).toHaveBeenCalledWith("get_condition_sensor_registry");
  });

  it("passes human-authored configuration and optimistic version to the writer", async () => {
    rpc.mockResolvedValue({
      data: {
        sensorId: "sensor-1",
        version: 4,
        status: "active",
        action: "revised",
        operationalAuthorization: false,
      },
      error: null,
    });
    await upsertConditionSensor({
      sensorId: "sensor-1",
      assetId: "asset-1",
      sensorTag: "P101-VIB-DE",
      name: "Drive-end vibration",
      signalType: "vibration_velocity",
      unit: "mm/s RMS",
      detectionTechnique: "Vibration analysis",
      warningLimit: 4.5,
      alarmLimit: 7.1,
      limitDirection: "above",
      sourceSystem: "PI-HISTORIAN",
      basis: "Approved instrument index revision 12.",
      expectedVersion: 3,
    });
    expect(rpc).toHaveBeenCalledWith("upsert_condition_sensor", {
      p_sensor_id: "sensor-1",
      p_asset_id: "asset-1",
      p_sensor_tag: "P101-VIB-DE",
      p_name: "Drive-end vibration",
      p_signal_type: "vibration_velocity",
      p_unit: "mm/s RMS",
      p_detection_technique: "Vibration analysis",
      p_warning_limit: 4.5,
      p_alarm_limit: 7.1,
      p_limit_direction: "above",
      p_source_system: "PI-HISTORIAN",
      p_basis: "Approved instrument index revision 12.",
      p_expected_version: 3,
    });
  });

  it("uses explicit versioned lifecycle calls and surfaces in-band refusals", async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          sensorId: "sensor-1",
          version: 5,
          status: "decommissioned",
          historyPreserved: true,
          operationalAuthorization: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { error: "sensor changed after it was loaded" },
        error: null,
      });

    await decommissionConditionSensor({
      sensorId: "sensor-1",
      reason: "Instrument was physically removed from service.",
      expectedVersion: 4,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "decommission_condition_sensor", {
      p_sensor_id: "sensor-1",
      p_reason: "Instrument was physically removed from service.",
      p_expected_version: 4,
    });
    await expect(
      reactivateConditionSensor({
        sensorId: "sensor-1",
        basis: "Instrument reinstalled after verified calibration.",
        expectedVersion: 4,
      }),
    ).rejects.toThrow(/changed after it was loaded/i);
  });
});

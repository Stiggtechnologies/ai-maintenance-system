import { supabase } from "../lib/supabase";

export type SensorRegistryStatus = "active" | "inactive" | "decommissioned";
export type SensorLimitDirection = "above" | "below";

export interface ConditionSensorAsset {
  assetId: string;
  assetTag: string;
  name: string;
}

export interface ConditionSensorCalibration {
  calibratedOn: string;
  dueOn: string;
  certificateReference: string;
  asLeftWithinTolerance: boolean;
  posture: "current" | "overdue" | "out_of_tolerance";
}

export interface ConditionSensorRow {
  sensorId: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  sensorTag: string | null;
  name: string;
  signalType: string | null;
  unit: string | null;
  detectionTechnique: string | null;
  warningLimit: number | null;
  alarmLimit: number | null;
  limitDirection: SensorLimitDirection;
  sourceSystem: string | null;
  registryStatus: SensorRegistryStatus;
  configurationVersion: number;
  configurationBasis: string | null;
  configuredAt: string | null;
  readingCount: number;
  latestReadingAt: string | null;
  calibration: ConditionSensorCalibration | null;
  diagnosticReportCount: number;
  latestDiagnosticReportAt: string | null;
  historyCount: number;
  lastValue: number | null;
  currentStatus: string | null;
  trend: string | null;
}

export interface ConditionSensorRegistryWorkspace {
  assets: ConditionSensorAsset[];
  sensors: ConditionSensorRow[];
  canManage: boolean;
  basis: string;
  boundary: string;
}

export interface ConditionSensorInput {
  sensorId?: string | null;
  assetId: string;
  sensorTag: string;
  name: string;
  signalType: string;
  unit: string;
  detectionTechnique?: string | null;
  warningLimit?: number | null;
  alarmLimit?: number | null;
  limitDirection: SensorLimitDirection;
  sourceSystem?: string | null;
  basis: string;
  expectedVersion?: number | null;
}

function unwrap<T>(
  data: T | { error?: string } | null,
  error: { message: string } | null,
  fallback: string,
): T {
  if (error) throw new Error(`${fallback}: ${error.message}`);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  if (!data) throw new Error(fallback);
  return data as T;
}

export async function loadConditionSensorRegistry(): Promise<ConditionSensorRegistryWorkspace> {
  const { data, error } = await supabase.rpc("get_condition_sensor_registry");
  return unwrap(
    data as ConditionSensorRegistryWorkspace | { error?: string } | null,
    error,
    "Could not load the condition-sensor registry",
  );
}

export async function upsertConditionSensor(input: ConditionSensorInput) {
  const { data, error } = await supabase.rpc("upsert_condition_sensor", {
    p_sensor_id: input.sensorId ?? null,
    p_asset_id: input.assetId,
    p_sensor_tag: input.sensorTag,
    p_name: input.name,
    p_signal_type: input.signalType,
    p_unit: input.unit,
    p_detection_technique: input.detectionTechnique ?? null,
    p_warning_limit: input.warningLimit ?? null,
    p_alarm_limit: input.alarmLimit ?? null,
    p_limit_direction: input.limitDirection,
    p_source_system: input.sourceSystem ?? null,
    p_basis: input.basis,
    p_expected_version: input.expectedVersion ?? null,
  });
  return unwrap<{
    sensorId: string;
    version: number;
    status: SensorRegistryStatus;
    action: "registered" | "revised";
    operationalAuthorization: false;
  }>(data as never, error, "Could not save the condition sensor");
}

export async function decommissionConditionSensor(input: {
  sensorId: string;
  reason: string;
  expectedVersion: number;
}) {
  const { data, error } = await supabase.rpc("decommission_condition_sensor", {
    p_sensor_id: input.sensorId,
    p_reason: input.reason,
    p_expected_version: input.expectedVersion,
  });
  return unwrap<{
    sensorId: string;
    version: number;
    status: "decommissioned";
    historyPreserved: true;
    operationalAuthorization: false;
  }>(data as never, error, "Could not decommission the condition sensor");
}

export async function reactivateConditionSensor(input: {
  sensorId: string;
  basis: string;
  expectedVersion: number;
}) {
  const { data, error } = await supabase.rpc("reactivate_condition_sensor", {
    p_sensor_id: input.sensorId,
    p_basis: input.basis,
    p_expected_version: input.expectedVersion,
  });
  return unwrap<{
    sensorId: string;
    version: number;
    status: "active";
    operationalAuthorization: false;
  }>(data as never, error, "Could not reactivate the condition sensor");
}

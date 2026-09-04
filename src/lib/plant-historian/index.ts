/**
 * Canonical condition_reading fields the plant historian pull may map.
 * Mirrors plant_historian_allowed_fields() / required_fields() in
 * 20261212090000_plant_historian_read_adapter.sql.
 */
export const PLANT_HISTORIAN_ALLOWED_FIELDS = [
  "external_id",
  "sensor_name",
  "sensor_id",
  "value",
  "taken_at",
  "quality",
] as const;

export const PLANT_HISTORIAN_REQUIRED_FIELDS = [
  "external_id",
  "value",
  "taken_at",
] as const;

export const DEFAULT_HISTORIAN_COLUMN_MAPPING: Record<string, string> = {
  external_id: "external_id",
  sensor_name: "sensor_name",
  value: "value",
  taken_at: "taken_at",
  quality: "quality",
};

export type PlantHistorianTelemetryMode = "seed_sim" | "historian_owns";

export interface PlantHistorianReading {
  external_id: string | null;
  asset: string | null;
  asset_id: string | null;
  sensor: string | null;
  value: number;
  quality: string | null;
  taken_at: string;
  source_system: string;
}

export interface PlantHistorianCitableRecommendation {
  id: string;
  title: string;
  asset_id: string | null;
  asset: string | null;
  status: string;
}

export interface PlantHistorianStatus {
  configured: boolean;
  enabled: boolean;
  mapping_approved: boolean;
  telemetry_mode: PlantHistorianTelemetryMode;
  connector_key: string | null;
  name: string | null;
  system_kind: string | null;
  last_success_at: string | null;
  connector_backed_readings: number;
  other_readings: number;
  recent: PlantHistorianReading[];
  citable_recommendations: PlantHistorianCitableRecommendation[];
  basis: string;
}

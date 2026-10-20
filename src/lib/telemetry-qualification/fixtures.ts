import {
  CONTRACT_VERSION,
  type Configuration,
  type Telemetry,
} from "./contracts";
import type { ReplayInput } from "./index";

export const AS_OF = "2026-01-01T00:10:00.000Z";
export const configuration: Configuration = {
  version: "synthetic-config-1",
  identity: {
    organizationId: "synthetic-org",
    siteId: "synthetic-site",
    assetId: "synthetic-asset",
    sensorId: "synthetic-sensor",
    componentId: "synthetic-component",
  },
  unit: "mm/s",
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-01-02T00:00:00.000Z",
  maxReceiptDelayMs: 120_000,
  model: { modelKey: "synthetic-feature", version: "1" },
};
export function observation(
  sourceId = "sample-1",
  value: number | null = 2,
  minute = 1,
): Telemetry {
  return {
    contractVersion: CONTRACT_VERSION,
    kind: "measured_observation",
    sourceSystem: "synthetic-generator-v1",
    sourceId,
    identity: { ...configuration.identity },
    capturedAt: `2026-01-01T00:0${minute}:00.000Z`,
    receivedAt: `2026-01-01T00:0${minute}:01.000Z`,
    unit: "mm/s",
    quality: "good",
    configurationVersion: configuration.version,
    provenance: { method: "labelled-synthetic-fixture-v1", sourceRefs: [] },
    value,
  };
}
/** Labels describe constructed signals, not an inferred equipment condition. */
export const fixtures: readonly ReplayInput[] = [
  {
    label: "normal",
    configuration,
    events: [observation(), observation("sample-2", 2, 2)],
  },
  {
    label: "degraded",
    configuration,
    events: [
      observation(),
      observation("sample-2", 4, 2),
      observation("sample-3", 6, 3),
    ],
  },
  {
    label: "sensor_dropout",
    configuration,
    events: [observation(), observation("sample-2", null, 2)],
  },
  {
    label: "contradictory",
    configuration,
    events: [observation(), observation("sample-2", 9)],
  },
  {
    label: "late",
    configuration,
    events: [{ ...observation(), receivedAt: AS_OF }],
  },
  {
    label: "out_of_order",
    configuration,
    events: [observation("sample-2", 4, 2), observation()],
  },
  { label: "duplicate", configuration, events: [observation(), observation()] },
  {
    label: "conflicting_duplicate",
    configuration,
    events: [observation(), observation("sample-1", 9)],
  },
  {
    label: "misconfigured",
    configuration,
    events: [{ ...observation(), unit: "degC" }],
  },
];

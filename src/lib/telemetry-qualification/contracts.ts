import type { ConditionReadingRow } from "../../services/conditionStateService";
import type { EvidenceItemRow } from "../../types/operating";
import type { ModelRecord } from "../model-risk";
import type { CalculationRun } from "../develop/controls";

export const CONTRACT_VERSION = "syncai-telemetry-qualification-v1" as const;
export type Identity = {
  organizationId: EvidenceItemRow["organization_id"];
  siteId: string;
  assetId: NonNullable<ConditionReadingRow["asset_id"]>;
  sensorId: string;
  componentId: string;
};
/** References only: this module neither resolves nor persists canonical records. */
export type SourceRef = CalculationRun["inputRefs"][number] & {
  table:
    | "condition_readings"
    | "operating_states"
    | "evidence_items"
    | "calculation_runs";
};
export type ModelVersion = Pick<ModelRecord, "modelKey" | "version">;
export type Confidence = {
  meaning: "uncalibrated_model_score";
  score: number;
  applicability: string;
  /** A statement, not a validation receipt or a failure probability. */
  basis: string;
};
type Base = {
  contractVersion: typeof CONTRACT_VERSION;
  sourceSystem: string;
  sourceId: string;
  identity: Identity;
  capturedAt: ConditionReadingRow["taken_at"];
  receivedAt: string;
  unit: string;
  quality: "good" | "suspect" | "bad" | "substituted";
  configurationVersion: string;
  provenance: { method: string; sourceRefs: SourceRef[] };
};
export type Telemetry = Base &
  (
    | {
        kind: "measured_observation";
        value: ConditionReadingRow["value"] | null;
      }
    | { kind: "derived_feature"; value: number; model: ModelVersion }
    | {
        kind: "condition_estimate";
        value: number;
        model: ModelVersion;
        confidence: Confidence;
      }
    | {
        kind: "forecast";
        value: number;
        model: ModelVersion;
        confidence: Confidence;
        targetAt: string;
      }
  );
/** Caller-supplied snapshot, never a substitute for an authorized registry read. */
export type Configuration = {
  version: string;
  identity: Identity;
  unit: string;
  validFrom: string;
  validUntil: string;
  maxReceiptDelayMs: number;
  model: ModelVersion | null;
};
export type Outcome =
  "valid" | "invalid" | "unknown" | "quarantined" | "duplicate";
export type Verdict = { outcome: Outcome; reasons: string[] };

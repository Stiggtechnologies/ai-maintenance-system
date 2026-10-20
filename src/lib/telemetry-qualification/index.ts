import {
  CONTRACT_VERSION,
  type Configuration,
  type Identity,
  type Telemetry,
  type Verdict,
} from "./contracts";
export * from "./contracts";

const keys = [
  "organizationId",
  "siteId",
  "assetId",
  "sensorId",
  "componentId",
] as const;
const kinds = [
  "measured_observation",
  "derived_feature",
  "condition_estimate",
  "forecast",
];
const tables = [
  "condition_readings",
  "operating_states",
  "evidence_items",
  "calculation_runs",
];
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonblank = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
/** Canonical UTC milliseconds: rejects ambiguous zones and normalized impossible dates. */
function time(v: unknown): number {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  )
    return NaN;
  const ms = Date.parse(v);
  return Number.isFinite(ms) && new Date(ms).toISOString() === v ? ms : NaN;
}
const identityValid = (v: unknown): v is Identity =>
  object(v) && keys.every((k) => nonblank(v[k]));
const sameIdentity = (a: Identity, b: Identity) =>
  keys.every((k) => a[k] === b[k]);
const versionValid = (v: unknown) =>
  object(v) && nonblank(v.modelKey) && nonblank(v.version);
const verdict = (
  outcome: Verdict["outcome"],
  ...reasons: string[]
): Verdict => ({ outcome, reasons });

/** Validates data fields only. No authentication, authorization, RLS or signature verification. */
export function validateTelemetry(
  input: unknown,
  config: Configuration | null,
  asOf: string,
): Verdict {
  if (!object(input)) return verdict("invalid", "malformed_envelope");
  const e = input;
  if (e.contractVersion !== CONTRACT_VERSION)
    return verdict("invalid", "unsupported_contract");
  if (
    !identityValid(e.identity) ||
    !nonblank(e.sourceId) ||
    !nonblank(e.sourceSystem)
  )
    return verdict("invalid", "missing_identifier");
  if (typeof e.kind !== "string" || !kinds.includes(e.kind))
    return verdict("invalid", "unsupported_kind");
  if (
    !nonblank(e.unit) ||
    typeof e.quality !== "string" ||
    !["good", "suspect", "bad", "substituted"].includes(e.quality)
  )
    return verdict("invalid", "invalid_unit_or_quality");
  if (
    !object(e.provenance) ||
    !nonblank(e.provenance.method) ||
    !Array.isArray(e.provenance.sourceRefs) ||
    !Array.from(e.provenance.sourceRefs).every(
      (r) =>
        object(r) &&
        typeof r.table === "string" &&
        tables.includes(r.table) &&
        nonblank(r.id),
    )
  )
    return verdict("invalid", "invalid_provenance");
  const captured = time(e.capturedAt),
    received = time(e.receivedAt),
    now = time(asOf);
  if (
    ![captured, received, now].every(Number.isFinite) ||
    captured > received ||
    received > now
  )
    return verdict("invalid", "impossible_time");
  if (e.value !== null && !finite(e.value))
    return verdict("invalid", "nonfinite_value");
  if (e.kind === "measured_observation") {
    if ("model" in e || "confidence" in e || "targetAt" in e)
      return verdict("invalid", "observation_has_inference_fields");
  } else {
    if (!versionValid(e.model) || e.provenance.sourceRefs.length === 0)
      return verdict("invalid", "missing_model_or_lineage");
    if (e.kind === "condition_estimate" || e.kind === "forecast") {
      const c = e.confidence;
      if (
        !object(c) ||
        c.meaning !== "uncalibrated_model_score" ||
        !finite(c.score) ||
        c.score < 0 ||
        c.score > 1 ||
        !nonblank(c.applicability) ||
        !nonblank(c.basis)
      )
        return verdict("invalid", "invalid_confidence_semantics");
    } else if ("confidence" in e || "targetAt" in e)
      return verdict("invalid", "feature_has_estimate_fields");
    if (e.kind === "forecast" && !(time(e.targetAt) > captured))
      return verdict("invalid", "invalid_forecast_target");
    if (e.kind === "condition_estimate" && "targetAt" in e)
      return verdict("invalid", "estimate_has_forecast_target");
  }
  if (!config || !nonblank(e.configurationVersion))
    return verdict("unknown", "missing_configuration");
  if (
    !identityValid(config.identity) ||
    !nonblank(config.version) ||
    !nonblank(config.unit) ||
    !finite(config.maxReceiptDelayMs) ||
    config.maxReceiptDelayMs < 0 ||
    !Number.isFinite(time(config.validFrom)) ||
    !Number.isFinite(time(config.validUntil)) ||
    time(config.validFrom) >= time(config.validUntil) ||
    (config.model !== null && !versionValid(config.model))
  )
    return verdict("invalid", "invalid_configuration");
  if (!sameIdentity(e.identity, config.identity))
    return verdict("quarantined", "identity_binding_mismatch");
  if (e.unit !== config.unit) return verdict("quarantined", "unit_mismatch");
  if (
    e.configurationVersion !== config.version ||
    captured < time(config.validFrom) ||
    received >= time(config.validUntil) ||
    now >= time(config.validUntil)
  )
    return verdict("quarantined", "stale_configuration");
  if (e.kind !== "measured_observation") {
    const m = e.model as Record<string, unknown>;
    if (
      !config.model ||
      m.modelKey !== config.model.modelKey ||
      m.version !== config.model.version
    )
      return verdict("quarantined", "model_version_mismatch");
  }
  if (received - captured > config.maxReceiptDelayMs)
    return verdict("quarantined", "late_reading");
  if (e.quality !== "good") return verdict("quarantined", "unusable_quality");
  if (e.value === null)
    return verdict(
      "unknown",
      e.kind === "measured_observation"
        ? "sensor_dropout"
        : "missing_derived_value",
    );
  return verdict("valid", "contract_satisfied");
}

/** Sorted-key representation, not a security digest or a signed-ingest receipt. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export type ReplayInput = {
  label: string;
  events: readonly Telemetry[];
  configuration: Configuration | null;
};
export type ReplayRow = Verdict & {
  sourceId: string;
  kind: Telemetry["kind"];
  /** Qualified value only; never a diagnosis, readiness score, probability or RUL. */
  qualifiedValue: number | null;
};
function quarantine(row: ReplayRow, reason: string) {
  row.reasons =
    row.outcome === "quarantined"
      ? [...new Set([...row.reasons, reason])]
      : [reason];
  row.outcome = "quarantined";
  row.qualifiedValue = null;
}
/** Batch-local deterministic replay in supplied arrival order. No clock, IO, writes or retained state. */
export function replay(input: ReplayInput, asOf: string) {
  const seen = new Map<
    string,
    { content: string; indices: number[]; conflict: boolean }
  >();
  const latest = new Map<string, number>();
  const atTime = new Map<
    string,
    { value: number; indices: number[]; conflict: boolean }
  >();
  const rows: ReplayRow[] = [];
  input.events.forEach((e) => {
    const v = validateTelemetry(e, input.configuration, asOf);
    const row: ReplayRow = {
      ...v,
      sourceId: e.sourceId,
      kind: e.kind,
      qualifiedValue: null,
    };
    rows.push(row);
    // Malformed events never enter the batch identity index.
    if (v.outcome === "invalid") return;
    const id = canonical([
      e.identity.organizationId,
      e.sourceSystem,
      e.sourceId,
    ]);
    const content = canonical(e);
    const prior = seen.get(id);
    if (prior) {
      prior.indices.push(rows.length - 1);
      prior.conflict ||= prior.content !== content;
      if (!prior.conflict)
        Object.assign(row, verdict("duplicate", "same_content_id"));
      else
        for (const index of prior.indices) {
          quarantine(rows[index], "conflicting_content_id");
        }
    } else
      seen.set(id, { content, indices: [rows.length - 1], conflict: false });
    if (v.outcome !== "valid") return;
    // Project declared keys: accepted extension metadata cannot split a series.
    const series = canonical([
      keys.map((key) => e.identity[key]),
      e.sourceSystem,
      e.kind,
      e.unit,
      e.configurationVersion,
      "model" in e ? [e.model.modelKey, e.model.version] : null,
      "targetAt" in e ? e.targetAt : null,
    ]);
    const captured = time(e.capturedAt);
    const point = canonical([series, captured]);
    const other = atTime.get(point);
    if (other) {
      other.indices.push(rows.length - 1);
      other.conflict ||= other.value !== e.value;
      if (other.conflict) {
        for (const index of other.indices)
          quarantine(rows[index], "contradictory_same_time");
        return;
      }
    } else
      atTime.set(point, {
        value: e.value as number,
        indices: [rows.length - 1],
        conflict: false,
      });
    if (row.outcome !== "valid") return;
    if (captured < (latest.get(series) ?? -Infinity)) {
      Object.assign(row, verdict("quarantined", "out_of_order"));
      return;
    }
    latest.set(series, captured);
    row.qualifiedValue = e.value;
  });
  // A duplicate cannot outlive a contradiction discovered later in the batch.
  for (const group of seen.values()) {
    if (
      group.indices.some((i) =>
        rows[i].reasons.includes("contradictory_same_time"),
      )
    ) {
      for (const i of group.indices)
        quarantine(rows[i], "contradictory_same_time");
    }
  }
  return {
    contractVersion: CONTRACT_VERSION,
    replayVersion: "synthetic-replay-v1",
    synthetic: true as const,
    operationalAuthorization: false as const,
    label: input.label,
    asOf,
    rows,
    confidenceMeaning:
      "No predictive performance measured; scores are uncalibrated model assertions.",
  };
}

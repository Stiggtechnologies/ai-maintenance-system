import { supabase } from "../lib/supabase";

export type TimeAssuranceState =
  | "unconfigured"
  | "disabled"
  | "unproven"
  | "stale"
  | "synchronized"
  | "untrusted";

export interface ConnectorTimeAssurance {
  connectorId: string;
  connectorKey: string | null;
  name: string;
  enabled: boolean;
  protocol: "ntp" | "ptp" | "gnss" | "vendor_managed" | "system_managed" | null;
  referenceAuthority: string | null;
  toleranceMs: number | null;
  maxObservationAgeMinutes: number | null;
  configurationRevision: number;
  configurationEvidenceReference: string | null;
  configuredAt: string | null;
  state: TimeAssuranceState;
  eligibleForTimeSensitiveEvidence: boolean;
  withinClockContract: boolean;
  configurationEvidenceVerified: false;
  reason: string;
  observationId: string | null;
  sourceClockAt: string | null;
  referenceClockAt: string | null;
  receivedAt: string | null;
  offsetMs: number | null;
  measurementUncertaintyMs: number | null;
  worstCaseOffsetMs: number | null;
  observationEvidenceReference: string | null;
}

export interface TimeAssuranceWorkspace {
  generatedAt: string;
  operationalAuthority: false;
  setsSourceClocks: false;
  connectors: ConnectorTimeAssurance[];
}

export interface ClockConfigurationIntent {
  connectorId: string;
  idempotencyKey: string;
  protocol: NonNullable<ConnectorTimeAssurance["protocol"]>;
  referenceAuthority: string;
  toleranceMs: number;
  maxObservationAgeMinutes: number;
  evidenceReference: string;
  basis: string;
}

export interface ClockConfigurationAcknowledgement {
  ok: true;
  connector_id: string;
  idempotency_key: string;
  audit_id: string;
  configuration_revision: number;
  current_configuration_revision: number;
  replay: boolean;
  state: "unproven";
  operational_authority: false;
  configuration_evidence_verified: false;
  eligible_for_time_sensitive_evidence: false;
  note: string;
}

export class TimeAssuranceRefusalError extends Error {
  override name = "TimeAssuranceRefusalError";
}

export class TimeAssuranceUnknownOutcomeError extends Error {
  override name = "TimeAssuranceUnknownOutcomeError";
}

export interface EventTimeAssessment {
  connector_id: string;
  event_time: string;
  state: TimeAssuranceState;
  within_clock_contract: boolean;
  contract_scope: "recorded_contract_at_event";
  history_integrity: "verified_recorded_chain" | "unproven";
  history_reason: string | null;
  configuration_audit_id: string | null;
  configuration_revision: number | null;
  configuration_recorded_at: string | null;
  observation_id: string | null;
  worst_case_offset_ms: number | null;
  tolerance_ms: number | null;
  max_observation_age_minutes: number | null;
  configuration_evidence_verified: false;
  eligible_for_time_sensitive_evidence: false;
  operational_authority: false;
  note: string;
}

const states = new Set<unknown>([
  "unconfigured",
  "disabled",
  "unproven",
  "stale",
  "synchronized",
  "untrusted",
]);
const protocols = new Set<unknown>([
  "ntp",
  "ptp",
  "gnss",
  "vendor_managed",
  "system_managed",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const revision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nullable = (value: unknown, predicate: (value: unknown) => boolean) =>
  value === null || predicate(value);

// PostgreSQL preserves microseconds. Date.parse alone would silently equate
// distinct event instants; use it only for the whole-second timezone conversion.
function instant(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (
    calendar.getUTCFullYear() !== Number(year) ||
    calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return null;
  const milliseconds = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.000${zone}`,
  );
  return Number.isFinite(milliseconds)
    ? BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, "0"))
    : null;
}
const timestamp = (value: unknown) => instant(value) !== null;
const noAuthority = (value: Record<string, unknown>) =>
  value.operational_authority === false &&
  value.configuration_evidence_verified === false &&
  value.eligible_for_time_sensitive_evidence === false;
const nonnegative = (value: unknown) => finite(value) && value >= 0;

interface Decimal {
  coefficient: bigint;
  scale: number;
}

// Qualify the decimal values represented on the JSON wire, not an IEEE-754
// addition with an invented engineering epsilon. Unsafe magnitudes are refused.
function decimal(value: unknown): Decimal | null {
  if (!finite(value)) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(
    value.toString(),
  );
  if (!match) return null;
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const scale = fraction.length - Number(exponent);
  const coefficient = BigInt(`${sign}${whole}${fraction}`);
  return scale < 0
    ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 }
    : { coefficient, scale };
}

function compareDecimal(left: Decimal, right: Decimal): bigint {
  const scale = Math.max(left.scale, right.scale);
  return (
    left.coefficient * 10n ** BigInt(scale - left.scale) -
    right.coefficient * 10n ** BigInt(scale - right.scale)
  );
}

function worstOffset(offset: Decimal, uncertainty: Decimal): Decimal {
  const scale = Math.max(offset.scale, uncertainty.scale);
  const absolute =
    offset.coefficient < 0n ? -offset.coefficient : offset.coefficient;
  return {
    coefficient:
      absolute * 10n ** BigInt(scale - offset.scale) +
      uncertainty.coefficient * 10n ** BigInt(scale - uncertainty.scale),
    scale,
  };
}

function validConnector(
  value: unknown,
  generatedAt: bigint,
): value is ConnectorTimeAssurance {
  if (
    !object(value) ||
    !uuid(value.connectorId) ||
    !nullable(value.connectorKey, text) ||
    !text(value.name) ||
    typeof value.enabled !== "boolean" ||
    !Number.isSafeInteger(value.configurationRevision) ||
    (value.configurationRevision as number) < 0 ||
    !states.has(value.state) ||
    !text(value.reason) ||
    value.withinClockContract !== (value.state === "synchronized") ||
    value.configurationEvidenceVerified !== false ||
    value.eligibleForTimeSensitiveEvidence !== false ||
    !nullable(value.observationId, uuid) ||
    !nullable(value.sourceClockAt, timestamp) ||
    !nullable(value.referenceClockAt, timestamp) ||
    !nullable(value.receivedAt, timestamp) ||
    !nullable(value.offsetMs, finite) ||
    !nullable(value.measurementUncertaintyMs, nonnegative) ||
    !nullable(value.worstCaseOffsetMs, nonnegative) ||
    !nullable(value.observationEvidenceReference, text)
  )
    return false;
  if (value.configurationRevision === 0) {
    if (
      value.protocol !== null ||
      value.referenceAuthority !== null ||
      value.toleranceMs !== null ||
      value.maxObservationAgeMinutes !== null ||
      value.configurationEvidenceReference !== null ||
      value.configuredAt !== null ||
      value.state !== "unconfigured"
    )
      return false;
  } else if (
    !protocols.has(value.protocol) ||
    !text(value.referenceAuthority) ||
    !positive(value.toleranceMs) ||
    !revision(value.maxObservationAgeMinutes) ||
    !text(value.configurationEvidenceReference) ||
    !timestamp(value.configuredAt) ||
    value.state === "unconfigured" ||
    (!value.enabled && value.state !== "disabled")
  )
    return false;
  const observationFields = [
    value.sourceClockAt,
    value.referenceClockAt,
    value.receivedAt,
    value.offsetMs,
    value.measurementUncertaintyMs,
    value.worstCaseOffsetMs,
    value.observationEvidenceReference,
  ];
  if (value.observationId === null) {
    if (observationFields.some((field) => field !== null)) return false;
  } else if (observationFields.some((field) => field === null)) return false;
  if (value.configurationRevision === 0) return value.observationId === null;
  const configuredAt = instant(value.configuredAt);
  const tolerance = decimal(value.toleranceMs);
  if (configuredAt === null || configuredAt > generatedAt || tolerance === null)
    return false;
  let expectedState: TimeAssuranceState = value.enabled
    ? "unproven"
    : "disabled";
  if (value.observationId !== null) {
    const source = instant(value.sourceClockAt);
    const reference = instant(value.referenceClockAt);
    const received = instant(value.receivedAt);
    const offset = decimal(value.offsetMs);
    const uncertainty = decimal(value.measurementUncertaintyMs);
    const worst = decimal(value.worstCaseOffsetMs);
    if (
      source === null ||
      reference === null ||
      received === null ||
      received > generatedAt ||
      received < configuredAt ||
      offset === null ||
      uncertainty === null ||
      worst === null ||
      compareDecimal(offset, { coefficient: source - reference, scale: 3 }) !==
        0n ||
      compareDecimal(worst, worstOffset(offset, uncertainty)) !== 0n ||
      (reference > received &&
        compareDecimal(
          { coefficient: reference - received, scale: 3 },
          uncertainty,
        ) > 0n)
    )
      return false;
    if (value.enabled) {
      const expiresAt =
        reference +
        BigInt(value.maxObservationAgeMinutes as number) * 60_000_000n;
      expectedState =
        reference > generatedAt
          ? "unproven"
          : expiresAt < generatedAt
            ? "stale"
            : compareDecimal(worst, tolerance) <= 0n
              ? "synchronized"
              : "untrusted";
    }
  }
  // generatedAt is the server's read witness, never the browser's clock.
  // A state that crossed a boundary during the read is unavailable, not granted
  // a fabricated grace interval or silently relabelled by this service.
  return value.state === expectedState;
}

async function read(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if (object(data) && text(data.error)) throw new Error(data.error);
  if (!object(data) || Object.hasOwn(data, "error"))
    throw new Error(
      "Unqualified time-assurance response; no assessment is available.",
    );
  return data;
}

export const timeSynchronizationActions = {
  status: async (): Promise<TimeAssuranceWorkspace> => {
    const data = await read("get_connector_time_assurance", {});
    const generatedAt = object(data) ? instant(data.generatedAt) : null;
    if (
      !object(data) ||
      generatedAt === null ||
      data.operationalAuthority !== false ||
      data.setsSourceClocks !== false ||
      !Array.isArray(data.connectors) ||
      !data.connectors.every((row) => validConnector(row, generatedAt)) ||
      new Set(data.connectors.map((row) => row.connectorId.toLowerCase()))
        .size !== data.connectors.length
    )
      throw new Error(
        "Unqualified time-assurance workspace; connector posture is unavailable.",
      );
    return data as unknown as TimeAssuranceWorkspace;
  },

  configure: async (
    args: ClockConfigurationIntent,
  ): Promise<ClockConfigurationAcknowledgement> => {
    if (!uuid(args.connectorId) || !uuid(args.idempotencyKey))
      throw new TimeAssuranceRefusalError(
        "A canonical connector and configuration intent UUID are required.",
      );
    let response;
    try {
      response = await supabase.rpc("configure_connector_time_assurance", {
        p_connector_id: args.connectorId,
        p_idempotency_key: args.idempotencyKey,
        p_protocol: args.protocol,
        p_reference_authority: args.referenceAuthority,
        p_tolerance_ms: args.toleranceMs,
        p_max_observation_age_minutes: args.maxObservationAgeMinutes,
        p_evidence_reference: args.evidenceReference,
        p_basis: args.basis,
      });
    } catch {
      throw new TimeAssuranceUnknownOutcomeError(
        "Configuration outcome is unknown; reconcile the same configuration intent safely.",
      );
    }
    const { data, error, status } = response;
    const successfulHttp =
      Number.isInteger(status) && status >= 200 && status < 300;
    if (
      !error &&
      successfulHttp &&
      object(data) &&
      Object.keys(data).length === 1 &&
      text(data.error)
    )
      throw new TimeAssuranceRefusalError(data.error);
    if (
      error ||
      !successfulHttp ||
      !object(data) ||
      Object.hasOwn(data, "error") ||
      data.ok !== true ||
      !uuid(data.connector_id) ||
      data.connector_id.toLowerCase() !== args.connectorId.toLowerCase() ||
      !uuid(data.idempotency_key) ||
      data.idempotency_key.toLowerCase() !==
        args.idempotencyKey.toLowerCase() ||
      !uuid(data.audit_id) ||
      !revision(data.configuration_revision) ||
      !revision(data.current_configuration_revision) ||
      data.current_configuration_revision < data.configuration_revision ||
      typeof data.replay !== "boolean" ||
      (!data.replay &&
        data.current_configuration_revision !== data.configuration_revision) ||
      data.state !== "unproven" ||
      !noAuthority(data) ||
      !text(data.note)
    )
      throw new TimeAssuranceUnknownOutcomeError(
        "Configuration outcome is unknown; its receipt was not qualified. Reconcile the same configuration intent safely.",
      );
    return data as unknown as ClockConfigurationAcknowledgement;
  },

  evaluateEventTime: async (
    connectorId: string,
    eventTime: string,
  ): Promise<EventTimeAssessment> => {
    const expectedInstant = instant(eventTime);
    if (!uuid(connectorId) || expectedInstant === null)
      throw new Error(
        "A canonical connector and explicit-zone microsecond-precision timestamp are required.",
      );
    const data = await read("evaluate_connector_event_time", {
      p_connector_id: connectorId,
      p_event_time: eventTime,
    });
    if (
      !object(data) ||
      !uuid(data.connector_id) ||
      data.connector_id.toLowerCase() !== connectorId.toLowerCase() ||
      instant(data.event_time) !== expectedInstant ||
      !states.has(data.state) ||
      data.within_clock_contract !== (data.state === "synchronized") ||
      data.contract_scope !== "recorded_contract_at_event" ||
      (data.history_integrity !== "verified_recorded_chain" &&
        data.history_integrity !== "unproven") ||
      !nullable(data.history_reason, text) ||
      !nullable(data.configuration_audit_id, uuid) ||
      !nullable(data.configuration_revision, revision) ||
      !nullable(data.configuration_recorded_at, timestamp) ||
      !nullable(data.observation_id, uuid) ||
      !nullable(data.worst_case_offset_ms, nonnegative) ||
      !nullable(data.tolerance_ms, positive) ||
      !nullable(data.max_observation_age_minutes, revision) ||
      !noAuthority(data) ||
      !text(data.note) ||
      (data.history_integrity === "verified_recorded_chain" &&
        data.history_reason !== null)
    )
      throw new Error(
        "Unqualified event-time assessment; no numerical posture is available.",
      );
    if (data.configuration_revision === null) {
      if (
        data.configuration_audit_id !== null ||
        data.configuration_recorded_at !== null ||
        data.tolerance_ms !== null ||
        data.max_observation_age_minutes !== null ||
        data.observation_id !== null ||
        data.worst_case_offset_ms !== null ||
        (data.state !== "unconfigured" &&
          data.state !== "disabled" &&
          data.state !== "unproven")
      )
        throw new Error(
          "Event-time assessment has contradictory missing contract evidence.",
        );
    } else if (
      data.history_integrity !== "verified_recorded_chain" ||
      data.configuration_audit_id === null ||
      data.configuration_recorded_at === null ||
      data.tolerance_ms === null ||
      data.max_observation_age_minutes === null ||
      instant(data.configuration_recorded_at)! > expectedInstant
    )
      throw new Error(
        "Event-time assessment has an unqualified contract receipt.",
      );
    if (data.configuration_revision !== null) {
      if (data.state === "unproven") {
        if (data.observation_id !== null || data.worst_case_offset_ms !== null)
          throw new Error(
            "Unproven event-time assessment contains contradictory observation evidence.",
          );
      } else if (data.state === "stale") {
        if (data.observation_id === null || data.worst_case_offset_ms !== null)
          throw new Error(
            "Stale event-time assessment has contradictory numerical evidence.",
          );
      } else {
        const worst = decimal(data.worst_case_offset_ms);
        const tolerance = decimal(data.tolerance_ms);
        if (
          data.observation_id === null ||
          worst === null ||
          tolerance === null ||
          data.state !==
            (compareDecimal(worst, tolerance) <= 0n
              ? "synchronized"
              : "untrusted")
        )
          throw new Error(
            "Event-time assessment lacks a qualifying numerical observation.",
          );
      }
    }
    return data as unknown as EventTimeAssessment;
  },
};

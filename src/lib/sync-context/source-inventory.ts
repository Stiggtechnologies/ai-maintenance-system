import {
  CONTEXT_RIGHTS_STATES,
  CONTEXT_SOURCE_AUTHORITIES,
  CONTEXT_SOURCE_CLASSES,
  SOURCE_HEALTH_STATES,
  type ContextSource,
  type SourceHealthState,
} from "./contracts";
import { parseContextUiTimestamp } from "./operating-picture";

const ISSUE_KEYS = [
  "invalid_source_clock",
  "rights_not_permitted",
  "health_not_permitted",
  "disabled_or_inactive",
  "stale_observation",
] as const;
export interface ContextInventorySource extends Omit<
  ContextSource,
  "checkedAt"
> {
  checkedAt: string | null;
  reportedHealthState: SourceHealthState;
  enabled: boolean | null;
  registryStatus: string | null;
  checkAgeSeconds: number | null;
  observationAgeSeconds: number | null;
  clockValid: boolean;
  rightsPermit: boolean;
  healthPermit: boolean;
  canEmit: boolean;
  lastSuccessfulCheckAt: null;
  lastSuccessfulCheckBasis: "unknown_no_transport_receipt";
  coverage: { state: "unknown"; basis: "no_governed_coverage_measurement" };
  issues: (typeof ISSUE_KEYS)[number][];
  operationalAuthority: false;
}
export interface SyncContextSourceInventory {
  organizationId: string;
  generatedAt: string;
  scope: "organization";
  complete: true;
  operationalAuthority: false;
  sources: ContextInventorySource[];
}
const SOURCE_KEYS = [
  "id",
  "organizationId",
  "key",
  "name",
  "class",
  "authority",
  "purpose",
  "rightsState",
  "reportedHealthState",
  "state",
  "enabled",
  "registryStatus",
  "checkedAt",
  "observedAt",
  "checkAgeSeconds",
  "observationAgeSeconds",
  "detail",
  "clockValid",
  "rightsPermit",
  "healthPermit",
  "canEmit",
  "displayAsLive",
  "lastSuccessfulCheckAt",
  "lastSuccessfulCheckBasis",
  "coverage",
  "issues",
  "operationalAuthority",
];
function refuse(): never {
  throw new Error("Malformed Sync Context source inventory.");
}
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(result, k))
  )
    refuse();
  return result;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string") refuse();
  // PostgreSQL length(text) counts Unicode characters, not UTF-16 code units.
  // Stop at the boundary without allocating a second copy of untrusted text.
  let count = 0;
  const characters = value[Symbol.iterator]();
  while (!characters.next().done) {
    if (++count > max) refuse();
  }
  return value;
}
function nullableText(value: unknown, max: number): string | null {
  return value === null ? null : text(value, max);
}
function uuid(value: unknown): string {
  const result = text(value, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    refuse();
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") refuse();
  return value;
}
function member<T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) refuse();
  return value as T[number];
}
function time(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(parseContextUiTimestamp(result))) refuse();
  return result;
}
function age(
  value: unknown,
  at: string | null,
  generated: string,
): number | null {
  if (at === null) {
    if (value !== null) refuse();
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    refuse();
  const expected =
    (parseContextUiTimestamp(generated) - parseContextUiTimestamp(at)) / 1000;
  // PostgreSQL retains microseconds; Date parsing is only millisecond display validation.
  if (expected < 0 || Math.abs(expected - value) > 0.002) refuse();
  return value;
}

/** Strict metadata parser: no invalid-row dropping, coverage inference or read authorization. */
export function parseSyncContextSourceInventory(
  value: unknown,
): SyncContextSourceInventory {
  const raw = record(value, [
    "organizationId",
    "generatedAt",
    "scope",
    "complete",
    "operationalAuthority",
    "sources",
  ]);
  const organizationId = uuid(raw.organizationId),
    generatedAt = time(raw.generatedAt);
  if (
    raw.scope !== "organization" ||
    raw.complete !== true ||
    raw.operationalAuthority !== false ||
    !Array.isArray(raw.sources) ||
    raw.sources.length > 500
  )
    refuse();
  const ids = new Set<string>();
  const sources: ContextInventorySource[] = [];
  for (let index = 0; index < raw.sources.length; index++) {
    if (!Object.hasOwn(raw.sources, index)) refuse();
    const s = record(raw.sources[index], SOURCE_KEYS);
    const id = uuid(s.id),
      org = uuid(s.organizationId);
    if (
      org.toLowerCase() !== organizationId.toLowerCase() ||
      ids.has(id.toLowerCase())
    )
      refuse();
    ids.add(id.toLowerCase());
    const checkedAt = s.checkedAt === null ? null : time(s.checkedAt);
    const observedAt = s.observedAt === null ? null : time(s.observedAt);
    if (
      observedAt !== null &&
      (checkedAt === null ||
        parseContextUiTimestamp(observedAt) >
          parseContextUiTimestamp(checkedAt))
    )
      refuse();
    const coverage = record(s.coverage, ["state", "basis"]);
    if (
      s.lastSuccessfulCheckAt !== null ||
      s.lastSuccessfulCheckBasis !== "unknown_no_transport_receipt" ||
      coverage.state !== "unknown" ||
      coverage.basis !== "no_governed_coverage_measurement" ||
      s.operationalAuthority !== false ||
      !Array.isArray(s.issues) ||
      s.issues.length > ISSUE_KEYS.length
    )
      refuse();
    const issues = Array.from(s.issues, (v) => member(v, ISSUE_KEYS));
    if (new Set(issues).size !== issues.length) refuse();
    const source: ContextInventorySource = {
      id,
      organizationId: org,
      key: text(s.key, 256),
      name: text(s.name, 4000),
      class: member(s.class, CONTEXT_SOURCE_CLASSES),
      authority: member(s.authority, CONTEXT_SOURCE_AUTHORITIES),
      purpose: text(s.purpose, 4000),
      rightsState: member(s.rightsState, CONTEXT_RIGHTS_STATES),
      state: member(s.state, SOURCE_HEALTH_STATES),
      reportedHealthState: member(s.reportedHealthState, SOURCE_HEALTH_STATES),
      enabled: s.enabled === null ? null : boolean(s.enabled),
      registryStatus: nullableText(s.registryStatus, 256),
      checkedAt,
      observedAt,
      checkAgeSeconds: age(s.checkAgeSeconds, checkedAt, generatedAt),
      observationAgeSeconds: age(
        s.observationAgeSeconds,
        observedAt,
        generatedAt,
      ),
      detail: nullableText(s.detail, 4000),
      clockValid: boolean(s.clockValid),
      rightsPermit: boolean(s.rightsPermit),
      healthPermit: boolean(s.healthPermit),
      canEmit: boolean(s.canEmit),
      displayAsLive: boolean(s.displayAsLive),
      lastSuccessfulCheckAt: null,
      lastSuccessfulCheckBasis: "unknown_no_transport_receipt",
      coverage: { state: "unknown", basis: "no_governed_coverage_measurement" },
      issues,
      operationalAuthority: false,
    };
    const active =
      source.enabled === true && source.registryStatus === "active";
    if (
      source.clockValid &&
      (checkedAt === null ||
        (observedAt === null &&
          [
            "live",
            "simulated",
            "delayed",
            "conflicting",
            "partial_coverage",
            "clock_skew",
          ].includes(source.reportedHealthState)))
    )
      refuse();
    const rightsMayPermit =
      (source.class === "customer_operational" &&
        source.rightsState === "customer_authorized") ||
      (source.class === "live_external" &&
        ["demo_approved", "production_approved"].includes(
          source.rightsState,
        )) ||
      (source.class === "simulated_industrial" &&
        source.rightsState === "not_required");
    const healthMayPermit =
      active &&
      (source.class === "simulated_industrial"
        ? source.reportedHealthState === "simulated"
        : [
            "connected",
            "live",
            "stale",
            "throttled",
            "delayed",
            "conflicting",
            "partial_coverage",
            "clock_skew",
          ].includes(source.reportedHealthState));
    if (
      (source.rightsPermit && !rightsMayPermit) ||
      source.healthPermit !== healthMayPermit ||
      source.canEmit !==
        (source.clockValid && source.rightsPermit && source.healthPermit)
    )
      refuse();
    const live =
      source.canEmit &&
      source.state === "live" &&
      ((source.class === "customer_operational" &&
        source.rightsState === "customer_authorized") ||
        (source.class === "live_external" &&
          source.rightsState === "production_approved"));
    if (
      source.displayAsLive !== live ||
      (!active && source.state !== "unavailable") ||
      (active && !source.clockValid && source.state !== "malformed") ||
      (active &&
        source.clockValid &&
        source.state !== source.reportedHealthState &&
        !(source.reportedHealthState === "live" && source.state === "stale"))
    )
      refuse();
    const expectedIssues = [
      !source.clockValid && "invalid_source_clock",
      !source.rightsPermit && "rights_not_permitted",
      !source.healthPermit && "health_not_permitted",
      !active && "disabled_or_inactive",
      source.state === "stale" && "stale_observation",
    ].filter(Boolean);
    if (JSON.stringify(issues) !== JSON.stringify(expectedIssues)) refuse();
    sources.push(source);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 8_388_608)
    refuse();
  return {
    organizationId,
    generatedAt,
    scope: "organization",
    complete: true,
    operationalAuthority: false,
    sources,
  };
}

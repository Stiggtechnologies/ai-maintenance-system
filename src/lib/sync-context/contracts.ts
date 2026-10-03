export const CONTEXT_SOURCE_CLASSES = [
  "live_external",
  "simulated_industrial",
  "customer_operational",
] as const;

export const SOURCE_HEALTH_STATES = [
  "connected",
  "live",
  "simulated",
  "not_connected",
  "stale",
  "unavailable",
  "malformed",
  "throttled",
  "delayed",
  "conflicting",
  "partial_coverage",
  "clock_skew",
] as const;

export const GOVERNANCE_STATES = [
  "draft",
  "recommended",
  "approved",
  "executed",
] as const;
export const CONTEXT_SOURCE_AUTHORITIES = [
  "context_only",
  "tenant_authorized",
  "source_asserted",
] as const;
export const CONTEXT_RIGHTS_STATES = [
  "unreviewed",
  "not_required",
  "demo_approved",
  "production_approved",
  "customer_authorized",
  "blocked",
  "expired",
] as const;
const RENDER_MODES = ["object", "polygon", "event"] as const;
const LAYER_AVAILABILITY = [
  "available",
  "empty",
  "degraded",
  "unavailable",
  "unauthorized",
] as const;
const DATA_QUALITY = ["unknown", "poor", "fair", "good", "verified"] as const;
const CANONICAL_SUBJECT_TYPES = [
  "asset",
  "site",
  "linear_route",
  "linear_segment",
  "work_order",
  "evidence",
  "recommendation",
  "decision",
  "approval",
  "risk",
  "recovery",
  "development_case",
  "capital_project",
  "audit_event",
] as const;
const CANONICAL_EVENT_RECORD_TYPES = [
  "geospatial_feature",
  "work_order",
] as const;

export type ContextSourceClass = (typeof CONTEXT_SOURCE_CLASSES)[number];
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];
export type GovernanceState = (typeof GOVERNANCE_STATES)[number];

export interface ContextSource {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  class: ContextSourceClass;
  authority: (typeof CONTEXT_SOURCE_AUTHORITIES)[number];
  purpose: string;
  rightsState: (typeof CONTEXT_RIGHTS_STATES)[number];
  state: SourceHealthState;
  checkedAt: string;
  observedAt: string | null;
  detail: string | null;
  displayAsLive: boolean;
}

export interface CanonicalSubjectRef {
  type: (typeof CANONICAL_SUBJECT_TYPES)[number];
  id: string | number;
}

export interface EngineeringClaim {
  name: string;
  value: string | number;
  unit: string;
  evidenceIds: string[];
  evidenceState: "verified";
}

export interface SpatialObject {
  id: string;
  organizationId: string;
  layerId: string;
  kind: string;
  name: string;
  geometryType: string;
  geometry: { type: string; coordinates: unknown[] };
  source: Pick<ContextSource, "id" | "key" | "class" | "authority"> & {
    healthState: SourceHealthState;
  };
  observedAt: string;
  validUntil: string | null;
  validityKind: "permanent" | "temporary";
  freshness: string;
  dataQuality: (typeof DATA_QUALITY)[number];
  evidenceIds: string[];
  missingEvidence: string[];
  evidenceState: "draft" | "verified";
  authority: { operational: false; label: string };
  subjects: CanonicalSubjectRef[];
  engineeringClaims: EngineeringClaim[];
}

export interface ContextEvent {
  id: string;
  organizationId: string;
  layerId: string;
  kind: string;
  title: string;
  occurredAt: string;
  canonicalRecord: { type: string; id: string | number };
  source: Pick<ContextSource, "id" | "key" | "class">;
  governanceState: GovernanceState;
  approvalId: string | null;
  operationalAuthority: false;
  evidenceIds: string[];
  engineeringClaims: EngineeringClaim[];
}

export interface SpatialLayer {
  id: string;
  label: string;
  renderMode: (typeof RENDER_MODES)[number];
  authorized: boolean;
  sourceDependencies: string[];
  healthStates: SourceHealthState[];
  availability: (typeof LAYER_AVAILABILITY)[number];
  recordCount: number;
  empty: boolean;
  degraded: boolean;
  issues: string[];
}

export interface SyncContextContractIssue {
  scope: "source" | "layer" | "object" | "event";
  index: number;
  id: string | null;
  message: string;
}

export interface SyncContextSnapshot {
  organizationId: string;
  generatedAt: string;
  operationalAuthority: false;
  sources: ContextSource[];
  layers: SpatialLayer[];
  objects: SpatialObject[];
  events: ContextEvent[];
  issues: SyncContextContractIssue[];
}

export interface ContextSourceAdapter {
  readonly adapterKey: string;
  readonly supportedSourceClasses: readonly ContextSourceClass[];
  readSnapshot(): Promise<SyncContextSnapshot>;
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Malformed Sync Context ${label}.`);
  return value as Record<string, unknown>;
};
const string = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Missing Sync Context ${label}.`);
  return value;
};
const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean")
    throw new Error(`Malformed Sync Context ${label}.`);
  return value;
};
const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value))
    throw new Error(`Malformed Sync Context ${label}.`);
  return value;
};
const strings = (value: unknown, label: string): string[] =>
  array(value, label).map((item, index) =>
    string(item, `${label} item ${index}`),
  );

const FORBIDDEN_PERSON_KEYS = new Set([
  "personid",
  "workerid",
  "employeeid",
  "userlocation",
  "biometric",
  "faceid",
  "facialrecognition",
]);
function containsPersonIdentity(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPersonIdentity);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      FORBIDDEN_PERSON_KEYS.has(key.replaceAll("_", "").toLowerCase()) ||
      containsPersonIdentity(item),
  );
}

export function canDisplaySourceAsLive(source: ContextSource): boolean {
  if (source.class === "simulated_industrial" || source.state !== "live")
    return false;
  return (
    source.displayAsLive &&
    ((source.class === "live_external" &&
      source.rightsState === "production_approved") ||
      (source.class === "customer_operational" &&
        source.rightsState === "customer_authorized"))
  );
}

function parseSource(value: unknown, organizationId: string): ContextSource {
  const source = record(value, "source");
  const sourceClass = string(source.class, "source class");
  const health = string(source.state, "source health");
  const authority = string(source.authority, "source authority");
  const rightsState = string(source.rightsState, "source rights state");
  if (!(CONTEXT_SOURCE_CLASSES as readonly string[]).includes(sourceClass))
    throw new Error("Unsupported Sync Context source class.");
  if (!(SOURCE_HEALTH_STATES as readonly string[]).includes(health))
    throw new Error("Unsupported Sync Context source-health state.");
  if (!(CONTEXT_SOURCE_AUTHORITIES as readonly string[]).includes(authority))
    throw new Error("Unsupported Sync Context source authority.");
  if (!(CONTEXT_RIGHTS_STATES as readonly string[]).includes(rightsState))
    throw new Error("Unsupported Sync Context source rights state.");
  if (source.organizationId !== organizationId)
    throw new Error("Cross-tenant Sync Context source refused.");
  if (containsPersonIdentity(source))
    throw new Error("Person identity is prohibited in Sync Context sources.");
  return {
    id: string(source.id, "source id"),
    organizationId,
    key: string(source.key, "source key"),
    name: string(source.name, "source name"),
    class: sourceClass as ContextSourceClass,
    authority: authority as ContextSource["authority"],
    purpose: string(source.purpose, "source purpose"),
    rightsState: rightsState as ContextSource["rightsState"],
    state: health as SourceHealthState,
    checkedAt: string(source.checkedAt, "source check time"),
    observedAt:
      source.observedAt === null
        ? null
        : string(source.observedAt, "source observation time"),
    detail:
      source.detail === null ? null : string(source.detail, "source detail"),
    displayAsLive: boolean(source.displayAsLive, "source live flag"),
  };
}

function parseEngineeringClaims(value: unknown): EngineeringClaim[] {
  if (value === undefined) return [];
  return array(value, "engineering claims").map((raw, index) => {
    const claim = record(raw, `engineering claim ${index}`);
    const evidenceIds = strings(claim.evidenceIds, "engineering evidence ids");
    if (claim.evidenceState !== "verified" || evidenceIds.length === 0) {
      throw new Error(
        "Engineering claims require approved, verified canonical evidence.",
      );
    }
    if (
      typeof claim.value !== "number" &&
      (typeof claim.value !== "string" || claim.value.length === 0)
    ) {
      throw new Error("Engineering claim value must be source supplied.");
    }
    return {
      name: string(claim.name, "engineering claim name"),
      value: claim.value,
      unit: string(claim.unit, "engineering claim unit"),
      evidenceIds,
      evidenceState: "verified",
    };
  });
}

function parseLayer(
  value: unknown,
  validSources: ReadonlyMap<string, ContextSource>,
): SpatialLayer {
  const layer = record(value, "layer");
  if (containsPersonIdentity(layer))
    throw new Error("Person identity is prohibited in Sync Context layers.");
  const renderMode = string(layer.renderMode, "layer render mode");
  if (!(RENDER_MODES as readonly string[]).includes(renderMode))
    throw new Error("Unsupported Sync Context layer render mode.");
  const sourceDependencies = strings(
    layer.sourceDependencies,
    "layer source dependencies",
  );
  const healthStates = strings(layer.healthStates, "layer health states");
  if (
    healthStates.some(
      (state) => !(SOURCE_HEALTH_STATES as readonly string[]).includes(state),
    )
  ) {
    throw new Error("Unsupported Sync Context layer health state.");
  }
  const availability = string(layer.availability, "layer availability");
  if (!(LAYER_AVAILABILITY as readonly string[]).includes(availability))
    throw new Error("Unsupported Sync Context layer availability.");
  if (
    typeof layer.recordCount !== "number" ||
    !Number.isInteger(layer.recordCount) ||
    layer.recordCount < 0
  ) {
    throw new Error("Malformed Sync Context layer record count.");
  }
  const missing = sourceDependencies.filter((id) => !validSources.has(id));
  const serverIssues = strings(layer.issues, "layer issues");
  return {
    id: string(layer.id, "layer id"),
    label: string(layer.label, "layer label"),
    renderMode: renderMode as SpatialLayer["renderMode"],
    authorized: boolean(layer.authorized, "layer authorization"),
    sourceDependencies: sourceDependencies.filter((id) => validSources.has(id)),
    healthStates: [
      ...(healthStates as SourceHealthState[]),
      ...(missing.length && !healthStates.includes("malformed")
        ? ["malformed" as const]
        : []),
    ],
    availability: missing.length
      ? "degraded"
      : (availability as SpatialLayer["availability"]),
    recordCount: layer.recordCount,
    empty: boolean(layer.empty, "layer empty state"),
    degraded:
      Boolean(missing.length) ||
      boolean(layer.degraded, "layer degraded state"),
    issues: missing.length
      ? [
          ...serverIssues,
          `Ignored ${missing.length} unavailable or malformed source dependency.`,
        ]
      : serverIssues,
  };
}

function parseSourceReference(
  value: unknown,
  organizationId: string,
  validSources: ReadonlyMap<string, ContextSource>,
  includeAuthority: boolean,
): ContextSource {
  const source = record(value, "source reference");
  const canonical = validSources.get(string(source.id, "source reference id"));
  if (!canonical || source.organizationId !== organizationId)
    throw new Error("Unknown or cross-tenant Context source reference.");
  if (
    source.key !== canonical.key ||
    source.class !== canonical.class ||
    (includeAuthority && source.authority !== canonical.authority)
  ) {
    throw new Error("Context source reference does not match its authority.");
  }
  return canonical;
}

function parseSpatialObject(
  value: unknown,
  organizationId: string,
  validSources: ReadonlyMap<string, ContextSource>,
): SpatialObject {
  const item = record(value, "object");
  if (containsPersonIdentity(item))
    throw new Error("Person identity is prohibited in SpatialObject.");
  if (item.organizationId !== organizationId)
    throw new Error("Cross-tenant Sync Context object refused.");
  const authority = record(item.authority, "object authority");
  if (authority.operational !== false)
    throw new Error("Spatial object attempted to carry operational authority.");
  const canonical = parseSourceReference(
    item.source,
    organizationId,
    validSources,
    true,
  );
  const source = record(item.source, "object source reference");
  if (source.healthState !== canonical.state)
    throw new Error("Spatial object source health does not match its source.");
  const geometry = record(item.geometry, "object geometry");
  const validityKind = string(item.validityKind, "object validity");
  if (!(["permanent", "temporary"] as readonly string[]).includes(validityKind))
    throw new Error("Unsupported SpatialObject validity.");
  const dataQuality = string(item.dataQuality, "object data quality");
  if (!(DATA_QUALITY as readonly string[]).includes(dataQuality))
    throw new Error("Unsupported SpatialObject data quality.");
  const evidenceState = string(item.evidenceState, "object evidence state");
  if (!(["draft", "verified"] as readonly string[]).includes(evidenceState))
    throw new Error("Unsupported SpatialObject evidence state.");
  const subjectItems = array(item.subjects, "object subjects");
  if (subjectItems.length === 0)
    throw new Error("SpatialObject requires a canonical subject.");
  return {
    id: string(item.id, "object id"),
    organizationId,
    layerId: string(item.layerId, "object layer id"),
    kind: string(item.kind, "object kind"),
    name: string(item.name, "object name"),
    geometryType: string(item.geometryType, "object geometry type"),
    geometry: {
      type: string(geometry.type, "geometry type"),
      coordinates: array(geometry.coordinates, "geometry coordinates"),
    },
    source: {
      id: canonical.id,
      key: canonical.key,
      class: canonical.class,
      authority: canonical.authority,
      healthState: canonical.state,
    },
    observedAt: string(item.observedAt, "object observation time"),
    validUntil:
      item.validUntil === null
        ? null
        : string(item.validUntil, "object valid-until time"),
    validityKind: validityKind as SpatialObject["validityKind"],
    freshness: string(item.freshness, "object freshness"),
    dataQuality: dataQuality as SpatialObject["dataQuality"],
    evidenceIds: strings(item.evidenceIds, "object evidence ids"),
    missingEvidence: strings(item.missingEvidence, "object missing evidence"),
    evidenceState: evidenceState as SpatialObject["evidenceState"],
    authority: {
      operational: false,
      label: string(authority.label, "object authority label"),
    },
    subjects: subjectItems.map((raw, index) => {
      const subject = record(raw, `object subject ${index}`);
      const subjectType = string(subject.type, "subject type");
      if (!(CANONICAL_SUBJECT_TYPES as readonly string[]).includes(subjectType))
        throw new Error("Unsupported canonical Context subject type.");
      return {
        type: subjectType as CanonicalSubjectRef["type"],
        id:
          typeof subject.id === "number"
            ? subject.id
            : string(subject.id, "subject id"),
      };
    }),
    engineeringClaims: parseEngineeringClaims(item.engineeringClaims),
  };
}

function parseContextEvent(
  value: unknown,
  organizationId: string,
  validSources: ReadonlyMap<string, ContextSource>,
): ContextEvent {
  const item = record(value, "event");
  if (containsPersonIdentity(item))
    throw new Error("Person identity is prohibited in ContextEvent.");
  if (item.organizationId !== organizationId)
    throw new Error("Cross-tenant Sync Context event refused.");
  if (item.operationalAuthority !== false)
    throw new Error("Context event attempted to carry operational authority.");
  const governanceState = string(item.governanceState, "governance state");
  if (!(GOVERNANCE_STATES as readonly string[]).includes(governanceState))
    throw new Error("Context event has an unsupported governance state.");
  const approvalId =
    item.approvalId === undefined || item.approvalId === null
      ? null
      : string(item.approvalId, "event approval id");
  if (governanceState === "approved" && approvalId === null)
    throw new Error("Approved Context event requires canonical approval.");
  const canonical = parseSourceReference(
    item.source,
    organizationId,
    validSources,
    false,
  );
  const canonicalRecord = record(item.canonicalRecord, "canonical record");
  const canonicalRecordType = string(
    canonicalRecord.type,
    "canonical record type",
  );
  if (
    !(CANONICAL_EVENT_RECORD_TYPES as readonly string[]).includes(
      canonicalRecordType,
    )
  ) {
    throw new Error("Unsupported canonical Context event record type.");
  }
  return {
    id: string(item.id, "event id"),
    organizationId,
    layerId: string(item.layerId, "event layer id"),
    kind: string(item.kind, "event kind"),
    title: string(item.title, "event title"),
    occurredAt: string(item.occurredAt, "event occurrence time"),
    canonicalRecord: {
      type: canonicalRecordType,
      id:
        typeof canonicalRecord.id === "number"
          ? canonicalRecord.id
          : string(canonicalRecord.id, "canonical record id"),
    },
    source: { id: canonical.id, key: canonical.key, class: canonical.class },
    governanceState: governanceState as GovernanceState,
    approvalId,
    operationalAuthority: false,
    evidenceIds: strings(item.evidenceIds, "event evidence ids"),
    engineeringClaims: parseEngineeringClaims(item.engineeringClaims),
  };
}

export function deriveWorkGovernanceState(
  status: string,
  hasExplicitCanonicalApproval: boolean,
): GovernanceState {
  if (status === "in_progress" || status === "completed") return "executed";
  if (hasExplicitCanonicalApproval) return "approved";
  if (status === "pending" || status === "draft") return "draft";
  return "recommended";
}

export function enforceAdapterSourceSupport(
  supportedSourceClasses: readonly ContextSourceClass[],
  snapshot: SyncContextSnapshot,
): SyncContextSnapshot {
  const unsupported = snapshot.sources.find(
    (source) => !supportedSourceClasses.includes(source.class),
  );
  if (unsupported) {
    throw new Error(
      `Adapter does not declare support for ${unsupported.class}.`,
    );
  }
  return snapshot;
}

function contractIssue(
  scope: SyncContextContractIssue["scope"],
  index: number,
  value: unknown,
  error: unknown,
): SyncContextContractIssue {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).id
      : null;
  return {
    scope,
    index,
    id: typeof candidate === "string" ? candidate : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function parseSyncContextSnapshot(value: unknown): SyncContextSnapshot {
  const snapshot = record(value, "snapshot");
  if (typeof snapshot.error === "string") throw new Error(snapshot.error);
  const organizationId = string(snapshot.organizationId, "organization id");
  if (snapshot.operationalAuthority !== false)
    throw new Error("Sync Context may not assert operational authority.");
  const issues: SyncContextContractIssue[] = [];
  const sources: ContextSource[] = [];
  const sourceMap = new Map<string, ContextSource>();
  array(snapshot.sources, "sources").forEach((raw, index) => {
    try {
      const source = parseSource(raw, organizationId);
      if (sourceMap.has(source.id))
        throw new Error("Duplicate Context source id.");
      sourceMap.set(source.id, source);
      sources.push(source);
    } catch (error) {
      issues.push(contractIssue("source", index, raw, error));
    }
  });
  const layers: SpatialLayer[] = [];
  array(snapshot.layers, "layers").forEach((raw, index) => {
    try {
      layers.push(parseLayer(raw, sourceMap));
    } catch (error) {
      issues.push(contractIssue("layer", index, raw, error));
    }
  });
  const objects: SpatialObject[] = [];
  array(snapshot.objects, "objects").forEach((raw, index) => {
    try {
      objects.push(parseSpatialObject(raw, organizationId, sourceMap));
    } catch (error) {
      issues.push(contractIssue("object", index, raw, error));
    }
  });
  const events: ContextEvent[] = [];
  array(snapshot.events, "events").forEach((raw, index) => {
    try {
      events.push(parseContextEvent(raw, organizationId, sourceMap));
    } catch (error) {
      issues.push(contractIssue("event", index, raw, error));
    }
  });
  return {
    organizationId,
    generatedAt: string(snapshot.generatedAt, "generation time"),
    operationalAuthority: false,
    sources,
    layers,
    objects,
    events,
    issues,
  };
}

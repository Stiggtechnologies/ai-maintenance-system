import {
  parseSyncContextSnapshot,
  type SpatialObject,
  type ContextEvent,
  type SyncContextSnapshot,
  type SpatialLayer,
} from "./contracts";
import {
  parseContextGeometry,
  type ContextCoordinateReference,
  type ContextGeometry,
} from "./geometry";
import { contextSourceEmission } from "./operating-source";

export interface OperatingSpatialObject extends Omit<
  SpatialObject,
  "geometry"
> {
  geometry: ContextGeometry;
  coordinate: ContextCoordinateReference;
  sourceReference: string;
  display: ContextDisplayMeaning;
}

export interface ContextDisplayMeaning {
  demoOnly: boolean;
  live: boolean;
  degraded: boolean;
}
export interface OperatingContextEvent extends ContextEvent {
  locationAvailable: false;
  display: ContextDisplayMeaning;
}

export interface ContextQueryCoverage {
  eligible: number;
  returned: number;
  truncated: boolean;
}

export interface OperatingSpatialLayer extends SpatialLayer {
  /** Scoped, role-visible active population BEFORE eligibility gates. */
  candidateCount: number;
  /** Scoped post-gate population BEFORE object/event limits, not rendered count. */
  eligibleCount: number;
}

export interface SyncContextOperatingPicture extends Omit<
  SyncContextSnapshot,
  "objects" | "events" | "layers"
> {
  layers: OperatingSpatialLayer[];
  objects: OperatingSpatialObject[];
  events: OperatingContextEvent[];
  scope: { siteId: string | null; objectLimit: number; eventLimit: number };
  coverage: {
    objects: ContextQueryCoverage & {
      draftExcluded: number;
      expiredExcluded: number;
      unlinkedExcluded: number;
      coordinateContractMissing: number;
      healthBlocked: number;
      rightsBlocked: number;
      evidenceBlocked: number;
      sourceMissing: number;
      timeBlocked: number;
      payloadBlocked: number;
      scopeConflict: number;
    };
    events: ContextQueryCoverage;
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Missing Context ${name}.`);
  return value as Record<string, unknown>;
}
function integer(
  value: unknown,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Malformed Context ${name}.`);
  }
  return value;
}
function queryCoverage(
  raw: unknown,
  returnedRows: number,
  limit: number,
): ContextQueryCoverage {
  const data = record(raw, "query coverage");
  const eligible = integer(data.eligible, "eligible count");
  const returned = integer(data.returned, "returned count", 0, limit);
  if (
    returned !== returnedRows ||
    returned > eligible ||
    returned !== Math.min(eligible, limit) ||
    data.truncated !== eligible > returned
  ) {
    throw new Error(
      "Context query coverage does not agree with the returned scope.",
    );
  }
  return { eligible, returned, truncated: eligible > returned };
}

function inputRows(value: unknown, name: string, limit?: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing Context ${name} array.`);
  if (limit !== undefined && value.length > limit)
    throw new Error(`Context ${name} exceeds the operating-picture limit.`);
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index))
      throw new Error(`Sparse Context ${name} arrays are refused.`);
    const row = value[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const id = (row as Record<string, unknown>).id;
    if (typeof id !== "string") continue;
    if (ids.has(id)) throw new Error(`Duplicate Context ${name} id.`);
    ids.add(id);
  }
  return value;
}

function timestamp(value: string): number {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts) return Number.NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    parts;
  const year = Number(yearText),
    month = Number(monthText),
    day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  )
    return Number.NaN;
  // This is a millisecond UI check, not a server clock-integrity authority.
  return Date.parse(value);
}

/**
 * New operating-picture wire parser. Reuses the canonical SC-01 snapshot parser
 * and adds renderer eligibility, explicit coordinate provenance and bounded
 * query coverage. The zero-argument SC-01 authoring contract remains unchanged.
 * Coverage is server query metadata, NOT rendered count, source availability or
 * complete tenant coverage. Invalid rows are excluded with explicit issues.
 * No read, rights, health or survey authorization is granted by this parser.
 */
export function parseSyncContextOperatingPicture(
  value: unknown,
): SyncContextOperatingPicture {
  const raw = record(value, "operating picture");
  const rawObjects = inputRows(raw.objects, "object", 500);
  const rawEvents = inputRows(raw.events, "event", 500);
  inputRows(raw.sources, "source", 500);
  inputRows(raw.layers, "layer", 100);
  const snapshot = parseSyncContextSnapshot(raw);
  const scope = record(raw.scope, "scope");
  const objectLimit = integer(scope.objectLimit, "object limit", 1, 500);
  const eventLimit = integer(scope.eventLimit, "event limit", 0, 500);
  if (
    scope.siteId !== null &&
    (typeof scope.siteId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        scope.siteId,
      ))
  ) {
    throw new Error("Malformed Context site scope.");
  }
  const coverage = record(raw.coverage, "coverage");
  const objectCoverage = record(coverage.objects, "object coverage");
  const objectQuery = queryCoverage(
    objectCoverage,
    rawObjects.length,
    objectLimit,
  );
  const eventQuery = queryCoverage(
    coverage.events,
    rawEvents.length,
    eventLimit,
  );
  const exclusions = {
    draftExcluded: integer(
      objectCoverage.draftExcluded,
      "draft exclusion count",
    ),
    expiredExcluded: integer(
      objectCoverage.expiredExcluded,
      "expiry exclusion count",
    ),
    unlinkedExcluded: integer(
      objectCoverage.unlinkedExcluded,
      "unlinked exclusion count",
    ),
    coordinateContractMissing: integer(
      objectCoverage.coordinateContractMissing,
      "coordinate exclusion count",
    ),
    healthBlocked: integer(
      objectCoverage.healthBlocked,
      "health exclusion count",
    ),
    rightsBlocked: integer(
      objectCoverage.rightsBlocked,
      "rights exclusion count",
    ),
    evidenceBlocked: integer(
      objectCoverage.evidenceBlocked,
      "evidence exclusion count",
    ),
    sourceMissing: integer(
      objectCoverage.sourceMissing,
      "source exclusion count",
    ),
    timeBlocked: integer(objectCoverage.timeBlocked, "time exclusion count"),
    payloadBlocked: integer(
      objectCoverage.payloadBlocked,
      "payload exclusion count",
    ),
    scopeConflict: integer(
      objectCoverage.scopeConflict,
      "scope conflict count",
    ),
  };
  const generatedAt = timestamp(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt))
    throw new Error("Malformed Context snapshot time.");
  const issues = [...snapshot.issues];
  const sourceIndices = new Map(
    (raw.sources as Record<string, unknown>[]).map((source, index) => [
      source?.id,
      index,
    ]),
  );
  const invalidTimeSources = new Set<string>();
  const sources = snapshot.sources.map((source) => {
    const checked = timestamp(source.checkedAt);
    const observed =
      source.observedAt === null ? null : timestamp(source.observedAt);
    const observationRequired = [
      "live",
      "simulated",
      "delayed",
      "conflicting",
      "partial_coverage",
      "clock_skew",
    ].includes(source.state);
    if (
      !Number.isFinite(checked) ||
      checked > generatedAt ||
      (observed !== null &&
        (!Number.isFinite(observed) ||
          observed > checked ||
          observed > generatedAt)) ||
      (observationRequired && observed === null)
    ) {
      invalidTimeSources.add(source.id);
      issues.push({
        scope: "source",
        index: sourceIndices.get(source.id) ?? 0,
        id: source.id,
        message:
          "Source check/observation time is malformed, missing or future-dated; emission and live display are refused.",
      });
      return { ...source, displayAsLive: false };
    }
    return source;
  });
  const inputs = new Map<
    string,
    { input: Record<string, unknown>; index: number }
  >();
  rawObjects.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const input = value as Record<string, unknown>;
    if (typeof input.id !== "string") return;
    if (inputs.has(input.id)) throw new Error("Duplicate Context object id.");
    inputs.set(input.id, { input, index });
  });
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const layerPopulations = new Map<
    string,
    { candidateCount: number; eligibleCount: number }
  >();
  (raw.layers as unknown[]).forEach((input) => {
    const data = record(input, "layer population");
    const candidateCount = integer(
      data.candidateCount,
      "layer candidate count",
    );
    const eligibleCount = integer(data.eligibleCount, "layer eligible count");
    if (
      typeof data.id !== "string" ||
      candidateCount !== data.recordCount ||
      eligibleCount > candidateCount
    )
      throw new Error(
        "Context layer populations do not agree with the query metadata.",
      );
    layerPopulations.set(data.id, { candidateCount, eligibleCount });
  });
  const objectLayers = snapshot.layers.filter(
    (layer) => layer.renderMode !== "event",
  );
  const objectEligible = objectLayers.reduce(
    (sum, layer) => sum + layerPopulations.get(layer.id)!.eligibleCount,
    0,
  );
  const objectCandidates = objectLayers.reduce(
    (sum, layer) => sum + layerPopulations.get(layer.id)!.candidateCount,
    0,
  );
  const eventEligible =
    objectEligible +
    snapshot.layers
      .filter((layer) => layer.renderMode === "event")
      .reduce(
        (sum, layer) => sum + layerPopulations.get(layer.id)!.eligibleCount,
        0,
      );
  const classified =
    objectQuery.eligible +
    Object.values(exclusions).reduce((sum, count) => sum + count, 0);
  if (
    !Number.isSafeInteger(classified) ||
    objectEligible !== objectQuery.eligible ||
    objectCandidates !== classified ||
    eventEligible !== eventQuery.eligible
  )
    throw new Error(
      "Context layer populations do not reconcile with scoped coverage and exclusions.",
    );
  for (const rows of [rawObjects, rawEvents]) {
    const perLayer = new Map<string, number>();
    for (const input of rows) {
      if (!input || typeof input !== "object" || Array.isArray(input)) continue;
      const id = (input as Record<string, unknown>).layerId;
      if (typeof id === "string") perLayer.set(id, (perLayer.get(id) ?? 0) + 1);
    }
    for (const [id, returned] of perLayer) {
      if (
        layerPopulations.has(id) &&
        returned > layerPopulations.get(id)!.eligibleCount
      )
        throw new Error(
          "Context returned layer rows exceed its eligible population.",
        );
    }
  }
  const effectiveLayers = snapshot.layers.map((parsedLayer) => {
    const layer = { ...parsedLayer, ...layerPopulations.get(parsedLayer.id)! };
    if (!layer.authorized)
      return { ...layer, availability: "unauthorized" as const };
    if (layer.empty !== (layer.recordCount === 0))
      return {
        ...layer,
        availability: "unavailable" as const,
        degraded: true,
        issues: [
          ...layer.issues,
          "Layer empty state and query count disagree; emission is refused without inventing coverage.",
        ],
      };
    if (layer.sourceDependencies.length === 0)
      return layer.recordCount === 0
        ? layer
        : {
            ...layer,
            availability: "unavailable" as const,
            degraded: true,
            issues: [
              ...layer.issues,
              "No usable canonical source dependency exists for the returned records.",
            ],
          };
    const policies = layer.sourceDependencies.map((id) => {
      const source = sourceMap.get(id);
      return source && !invalidTimeSources.has(id)
        ? contextSourceEmission(source)
        : null;
    });
    const unavailable = policies.every((policy) => !policy?.canEmit);
    const degraded =
      layer.degraded ||
      layer.availability === "degraded" ||
      policies.some((policy) => !policy?.canEmit || policy.degraded);
    return {
      ...layer,
      healthStates: [
        ...new Set(
          layer.sourceDependencies.flatMap((id) => {
            const source = sourceMap.get(id);
            return source ? [source.state] : ["malformed" as const];
          }),
        ),
      ],
      availability: unavailable
        ? ("unavailable" as const)
        : degraded && layer.availability === "available"
          ? ("degraded" as const)
          : layer.availability,
      degraded: layer.degraded || degraded,
      issues: unavailable
        ? [
            ...layer.issues,
            "Source rights or health prevent operating-picture emission; this layer is unavailable, not empty.",
          ]
        : degraded
          ? [
              ...layer.issues,
              "One or more sources are degraded or cannot emit; no live or complete-coverage claim is made.",
            ]
          : layer.issues,
    };
  });
  const layers = new Map(effectiveLayers.map((layer) => [layer.id, layer]));
  const objects: OperatingSpatialObject[] = [];
  snapshot.objects.forEach((object) => {
    const indexed = inputs.get(object.id)!;
    try {
      const source = sourceMap.get(object.source.id);
      if (
        !source ||
        invalidTimeSources.has(source.id) ||
        !contextSourceEmission(source).canEmit
      )
        throw new Error(
          "Source rights or health do not permit operating-picture emission.",
        );
      const layer = layers.get(object.layerId);
      if (
        !layer?.authorized ||
        layer.empty ||
        layer.recordCount === 0 ||
        layer.eligibleCount === 0 ||
        !["available", "degraded"].includes(layer.availability) ||
        layer.renderMode === "event" ||
        !layer.sourceDependencies.includes(source.id)
      )
        throw new Error(
          "Operating object has no compatible, available, source-bound authorized layer.",
        );
      if (object.evidenceState !== "verified" || object.freshness !== "current")
        throw new Error(
          "Draft or non-current geometry cannot be rendered as operational context.",
        );
      if (object.evidenceIds.length === 0)
        throw new Error(
          "Verified geometry requires canonical evidence references; a supplied status is not proof.",
        );
      if (
        !Number.isFinite(timestamp(object.observedAt)) ||
        timestamp(object.observedAt) > generatedAt
      )
        throw new Error("Malformed or future object observation time.");
      if (
        (object.validityKind === "permanent" && object.validUntil !== null) ||
        (object.validityKind === "temporary" &&
          (object.validUntil === null ||
            !Number.isFinite(timestamp(object.validUntil)) ||
            timestamp(object.validUntil) <= generatedAt))
      ) {
        throw new Error(
          "Expired or unspecified temporary geometry cannot be rendered as current context.",
        );
      }
      const input = indexed.input;
      if (
        typeof input.sourceReference !== "string" ||
        input.sourceReference.trim().length < 2
      )
        throw new Error("Missing canonical geometry source reference.");
      const parsed = parseContextGeometry(
        input.geometry,
        object.geometryType,
        input.coordinate,
      );
      objects.push({
        ...object,
        geometry: parsed.geometry,
        coordinate: parsed.coordinate,
        sourceReference: input.sourceReference,
        display: displayMeaning(source, layer),
      });
    } catch (error) {
      issues.push({
        scope: "object",
        index: indexed.index,
        id: object.id,
        message:
          error instanceof Error
            ? error.message
            : "Malformed Context operating object.",
      });
    }
  });
  // Events are context records only. This contract carries no event geometry;
  // work history must not be plotted at an invented/default asset position.
  const eventIndices = new Map(
    rawEvents.map((raw, index) => [
      (raw as Record<string, unknown>)?.id,
      index,
    ]),
  );
  const events: OperatingContextEvent[] = [];
  snapshot.events.forEach((event) => {
    const source = sourceMap.get(event.source.id);
    const layer = layers.get(event.layerId);
    const occurredAt = timestamp(event.occurredAt);
    const permitted =
      source &&
      !invalidTimeSources.has(source.id) &&
      contextSourceEmission(source).canEmit &&
      layer?.authorized === true &&
      !layer.empty &&
      layer.recordCount > 0 &&
      layer.eligibleCount > 0 &&
      ["available", "degraded"].includes(layer.availability) &&
      layer.sourceDependencies.includes(source.id) &&
      Number.isFinite(occurredAt) &&
      occurredAt <= generatedAt;
    if (!permitted)
      issues.push({
        scope: "event",
        index: eventIndices.get(event.id) ?? 0,
        id: event.id,
        message:
          "Event source, layer or occurrence time does not permit operating-picture emission.",
      });
    else
      events.push({
        ...event,
        locationAvailable: false,
        display: displayMeaning(source, layer!),
      });
  });
  return {
    ...snapshot,
    sources,
    layers: effectiveLayers,
    objects,
    events,
    issues,
    scope: { siteId: scope.siteId, objectLimit, eventLimit },
    coverage: {
      objects: { ...objectQuery, ...exclusions },
      events: eventQuery,
    },
  };
}

function displayMeaning(
  source: Parameters<typeof contextSourceEmission>[0],
  layer: { degraded: boolean; availability: string },
): ContextDisplayMeaning {
  const policy = contextSourceEmission(source);
  return {
    demoOnly: policy.demoOnly,
    live:
      policy.displayAsLive &&
      !layer.degraded &&
      layer.availability !== "degraded",
    degraded:
      policy.degraded || layer.degraded || layer.availability === "degraded",
  };
}

// C2.19 transport contract for a customer-operated HTTPS gateway over the
// Bently Nevada System 1 OPC UA export. This is deliberately not presented as
// a native System 1 REST API: the gateway performs OPC UA client work at the
// customer boundary and exposes this bounded, read-only envelope to SyncAI.

export type JsonRecord = Record<string, unknown>;

export interface System1NodeBinding {
  nodeId: string;
  sensorId: string;
  unit: string;
}

export interface System1MappingScope {
  bindings: System1NodeBinding[];
  watermarkFrom: string | null;
  fetchedAt: string;
  maxRows: number;
}

export interface System1GatewayPage {
  items: unknown[];
  nextCursor: string | null;
  complete: boolean;
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function instant(value: unknown, label: string): string {
  const raw = text(value, label);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    throw new Error(`${label} must carry an explicit timezone.`);
  }
  const epoch = Date.parse(raw);
  if (!Number.isFinite(epoch)) throw new Error(`${label} is not a valid time.`);
  return new Date(epoch).toISOString();
}

function exactDecimal(value: unknown, label: string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(
        `${label} must be an exact decimal string or safe integer.`,
      );
    }
    return String(value);
  }
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    throw new Error(`${label} must be an exact finite decimal.`);
  }
  const raw = value.trim();
  const digits = raw.replace(/[-.]/g, "");
  const fraction = raw.split(".")[1] ?? "";
  if (digits.length > 50 || fraction.length > 18) {
    throw new Error(`${label} exceeds the exact-decimal envelope.`);
  }
  return raw;
}

function boundedIdentifier(value: unknown, label: string, max = 512): string {
  const raw = text(value, label);
  if (raw.length > max || hasControlCharacters(raw)) {
    throw new Error(`${label} is outside the bounded identifier contract.`);
  }
  return raw;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function system1GatewayUrl(
  endpoint: URL,
  after: string | null,
  pageSize: number,
  cursor: string | null,
): URL {
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.pathname.endsWith("/syncai/v1/system1/readings")
  ) {
    throw new Error(
      "System 1 gateway must be a credential-free HTTPS readings endpoint.",
    );
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("System 1 page size must be between 1 and 1000.");
  }
  const url = new URL(endpoint.href);
  url.searchParams.set("limit", String(pageSize));
  if (after) url.searchParams.set("after", instant(after, "Watermark"));
  if (cursor) {
    if (cursor.length > 2048 || hasControlCharacters(cursor)) {
      throw new Error("System 1 cursor is outside the bounded opaque contract.");
    }
    url.searchParams.set("cursor", cursor);
  }
  return url;
}

export function readSystem1GatewayPage(
  payload: unknown,
  pageSize: number,
): System1GatewayPage {
  const root = object(payload, "System 1 gateway response");
  const allowed = new Set(["items", "nextCursor", "complete"]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) {
      throw new Error(`System 1 gateway returned unsupported field ${key}.`);
    }
  }
  if (!Array.isArray(root.items) || root.items.length > pageSize) {
    throw new Error("System 1 gateway items exceed the approved page size.");
  }
  if (typeof root.complete !== "boolean") {
    throw new Error("System 1 gateway complete flag must be boolean.");
  }
  const next = root.nextCursor;
  if (next !== null && next !== undefined && typeof next !== "string") {
    throw new Error("System 1 gateway cursor must be a string or null.");
  }
  const nextCursor = typeof next === "string" && next.trim() ? next : null;
  if (nextCursor && (nextCursor.length > 2048 || hasControlCharacters(nextCursor))) {
    throw new Error("System 1 gateway cursor is outside the bounded opaque contract.");
  }
  if (root.complete === Boolean(nextCursor)) {
    throw new Error(
      "System 1 gateway must return a cursor only for an incomplete page.",
    );
  }
  return { items: root.items, nextCursor, complete: root.complete };
}

export function mapSystem1Readings(
  values: unknown[],
  scope: System1MappingScope,
): { rows: JsonRecord[]; maxTakenAt: string } {
  if (
    !Number.isSafeInteger(scope.maxRows) ||
    scope.maxRows < 1 ||
    scope.maxRows > 50_000 ||
    values.length < 1 ||
    values.length > scope.maxRows
  ) {
    throw new Error(
      values.length < 1
        ? "System 1 returned an empty complete snapshot; no healthy state is inferred."
        : "System 1 response exceeds the approved row envelope.",
    );
  }
  const fetchedAt = instant(scope.fetchedAt, "Fetch time");
  const fetchedEpoch = Date.parse(fetchedAt);
  const watermarkEpoch = scope.watermarkFrom
    ? Date.parse(instant(scope.watermarkFrom, "Watermark"))
    : null;
  const bindingByNode = new Map<string, System1NodeBinding>();
  const sensorIds = new Set<string>();
  for (const [index, binding] of scope.bindings.entries()) {
    const nodeId = boundedIdentifier(binding.nodeId, `Binding ${index + 1} node`);
    const sensorId = boundedIdentifier(
      binding.sensorId,
      `Binding ${index + 1} sensor`,
      64,
    );
    const unit = text(binding.unit, `Binding ${index + 1} unit`);
    if (bindingByNode.has(nodeId)) {
      throw new Error(`System 1 node ${nodeId} is bound more than once.`);
    }
    if (sensorIds.has(sensorId)) {
      throw new Error(`Canonical sensor ${sensorId} is bound more than once.`);
    }
    bindingByNode.set(nodeId, { nodeId, sensorId, unit });
    sensorIds.add(sensorId);
  }
  if (bindingByNode.size < 1 || bindingByNode.size > 200) {
    throw new Error("System 1 mapping must contain 1 to 200 node bindings.");
  }

  const qualityMap: Record<string, "good" | "suspect" | "bad"> = {
    Good: "good",
    Uncertain: "suspect",
    Bad: "bad",
  };
  const sampleIds = new Set<string>();
  const sensorTimes = new Set<string>();
  const rows: JsonRecord[] = [];
  let maxEpoch = Number.NEGATIVE_INFINITY;

  values.forEach((value, index) => {
    const row = object(value, `System 1 sample ${index + 1}`);
    const allowed = new Set([
      "sampleId",
      "nodeId",
      "value",
      "timestamp",
      "quality",
      "unit",
    ]);
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) {
        throw new Error(`System 1 sample ${index + 1} has unsupported field ${key}.`);
      }
    }
    const sampleId = boundedIdentifier(
      row.sampleId,
      `System 1 sample ${index + 1} ID`,
      180,
    );
    if (sampleIds.has(sampleId)) {
      throw new Error(`System 1 sample ID ${sampleId} is duplicated.`);
    }
    sampleIds.add(sampleId);
    const nodeId = boundedIdentifier(
      row.nodeId,
      `System 1 sample ${index + 1} node`,
    );
    const binding = bindingByNode.get(nodeId);
    if (!binding) {
      throw new Error(`System 1 node ${nodeId} is not administrator-approved.`);
    }
    const unit = text(row.unit, `System 1 sample ${index + 1} unit`);
    if (unit !== binding.unit) {
      throw new Error(
        `System 1 node ${nodeId} unit ${unit} does not match canonical ${binding.unit}.`,
      );
    }
    const quality = text(
      row.quality,
      `System 1 sample ${index + 1} quality`,
    );
    const canonicalQuality = qualityMap[quality];
    if (!canonicalQuality) {
      throw new Error(`System 1 quality ${quality} is not approved.`);
    }
    const takenAt = instant(
      row.timestamp,
      `System 1 sample ${index + 1} timestamp`,
    );
    const epoch = Date.parse(takenAt);
    if (epoch > fetchedEpoch + 5 * 60_000) {
      throw new Error("System 1 sample timestamp is in the future.");
    }
    if (watermarkEpoch !== null && epoch <= watermarkEpoch) {
      throw new Error("System 1 sample does not advance the clean watermark.");
    }
    const sensorTime = `${binding.sensorId}\u0000${takenAt}`;
    if (sensorTimes.has(sensorTime)) {
      throw new Error(
        `System 1 returned two values for sensor ${binding.sensorId} at ${takenAt}.`,
      );
    }
    sensorTimes.add(sensorTime);
    maxEpoch = Math.max(maxEpoch, epoch);
    rows.push({
      external_id: `system1:${sampleId}`,
      sensor_id: binding.sensorId,
      value: exactDecimal(row.value, `System 1 sample ${index + 1} value`),
      taken_at: takenAt,
      quality: canonicalQuality,
    });
  });

  return { rows, maxTakenAt: new Date(maxEpoch).toISOString() };
}

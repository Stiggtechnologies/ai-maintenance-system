export type JsonRecord = Record<string, unknown>;

export interface SapApmIndicatorBinding {
  characteristicsInternalId: string;
  positionId: string;
  categoryName: string;
  technicalObjectType: string;
  sensorId: string;
}

export interface SapApmIndicatorScope {
  technicalObjectNumber: string;
  siteId: string;
  observedAt: string;
  maxRows: number;
  bindings: SapApmIndicatorBinding[];
}

export interface SapApmIndicatorPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9._:-]{1,80}$/;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function requiredText(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new Error(`${label} exceeds its ${max}-character limit.`);
  }
  return text;
}

function textField(row: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function sapApmIndicatorUrl(
  serviceRoot: URL,
  technicalObjectNumber: string,
): URL {
  if (!TOKEN.test(technicalObjectNumber)) {
    throw new Error("SAP APM technical object number is invalid.");
  }
  const url = new URL(serviceRoot.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/Indicators`;
  url.search = "";
  url.hash = "";
  url.searchParams.set(
    "$filter",
    `technicalObject_number eq '${technicalObjectNumber.replaceAll("'", "''")}'`,
  );
  return url;
}

export function readSapApmIndicatorPage(payload: unknown): {
  rows: unknown[];
  nextUrl: string | null;
} {
  const root = record(payload, "SAP APM response");
  const hasValue = Array.isArray(root.value);
  const envelope =
    root.d && typeof root.d === "object" && !Array.isArray(root.d)
      ? (root.d as JsonRecord)
      : null;
  const hasResults = envelope ? Array.isArray(envelope.results) : false;
  if (hasValue === hasResults) {
    throw new Error(
      "SAP APM indicator response must be either an OData V4 value collection or an OData V2 d.results collection.",
    );
  }
  const rows = hasValue
    ? (root.value as unknown[])
    : (envelope?.results as unknown[]);
  const next = hasValue ? root["@odata.nextLink"] : envelope?.__next;
  if (next !== undefined && next !== null && typeof next !== "string") {
    throw new Error("SAP APM next link must be a URL string when present.");
  }
  if (typeof next === "string" && next.length > 4096) {
    throw new Error("SAP APM next link exceeds its 4096-character limit.");
  }
  return {
    rows,
    nextUrl: typeof next === "string" && next.trim() ? next.trim() : null,
  };
}

export function validateSapApmNextUrl(nextValue: string, firstUrl: URL): URL {
  const next = new URL(nextValue, firstUrl);
  if (
    next.protocol !== "https:" ||
    next.username ||
    next.password ||
    next.origin !== firstUrl.origin ||
    next.pathname !== firstUrl.pathname ||
    next.hash
  ) {
    throw new Error(
      "SAP APM pagination attempted to leave the approved HTTPS resource.",
    );
  }
  if (next.searchParams.get("$filter") !== firstUrl.searchParams.get("$filter")) {
    throw new Error("SAP APM pagination changed the approved $filter query.");
  }
  const allowed = new Set(["$filter", "$top", "$skip", "$skiptoken"]);
  for (const [key] of next.searchParams) {
    if (!allowed.has(key)) {
      throw new Error("SAP APM pagination added an unapproved query parameter.");
    }
  }
  return next;
}

export function normalizeSapApmIndicatorPullRequest(
  value: unknown,
): SapApmIndicatorPullRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SAP APM indicator pull request must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const connectorKey = requiredText(body.connector_key, "connector_key", 160);
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  return { connectorKey, dryRun: body.dry_run !== false };
}

function bindingKey(binding: {
  technicalObjectType: string;
  characteristicsInternalId: string;
  positionId: string;
  categoryName: string;
}): string {
  return [
    binding.technicalObjectType,
    binding.characteristicsInternalId,
    binding.positionId,
    binding.categoryName,
  ].join("\u001f");
}

export function mapSapApmIndicators(
  values: unknown[],
  scope: SapApmIndicatorScope,
): JsonRecord[] {
  if (
    !TOKEN.test(scope.technicalObjectNumber) ||
    !UUID.test(scope.siteId) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(scope.observedAt) ||
    !Number.isFinite(Date.parse(scope.observedAt)) ||
    !Number.isSafeInteger(scope.maxRows) ||
    scope.maxRows < 1 ||
    scope.maxRows > 5000 ||
    scope.bindings.length < 1 ||
    scope.bindings.length > 40
  ) {
    throw new Error("SAP APM indicator mapping scope is invalid.");
  }
  const byKey = new Map<string, SapApmIndicatorBinding>();
  for (const binding of scope.bindings) {
    if (
      !TOKEN.test(binding.characteristicsInternalId) ||
      !TOKEN.test(binding.positionId) ||
      !TOKEN.test(binding.categoryName) ||
      !TOKEN.test(binding.technicalObjectType) ||
      !UUID.test(binding.sensorId)
    ) {
      throw new Error("SAP APM indicator binding is invalid.");
    }
    const key = bindingKey(binding);
    if (byKey.has(key)) {
      throw new Error("SAP APM indicator bindings repeat an indicator identity.");
    }
    byKey.set(key, binding);
  }
  if (values.length === 0) {
    throw new Error(
      "SAP APM returned no indicators; SyncAI will not treat a missing indicator as a healthy asset.",
    );
  }
  if (values.length > scope.maxRows) {
    throw new Error("SAP APM indicator response exceeds the approved row limit.");
  }

  const seen = new Set<string>();
  const mapped: JsonRecord[] = [];
  for (const [index, value] of values.entries()) {
    const row = record(value, `SAP APM indicator row ${index + 1}`);
    if (
      row.value != null ||
      row.time != null ||
      row.values != null
    ) {
      throw new Error(
        "SAP APM indicator definition included a measurement. This read does not promote unverified time-series values.",
      );
    }
    const technicalObjectNumber = textField(row, [
      "technicalObjectNumber",
      "technicalObject_number",
    ]);
    const technicalObjectType = textField(row, [
      "technicalObjectType",
      "technicalObject_type",
    ]);
    const characteristicsInternalId = textField(row, [
      "characteristicsInternalId",
      "characteristics_characteristicsInternalId",
    ]);
    const positionId = textField(row, ["positionID", "positionDetails_ID"]);
    const categoryName = textField(row, ["categoryName", "category_name"]);
    if (
      !TOKEN.test(technicalObjectNumber) ||
      !TOKEN.test(technicalObjectType) ||
      !TOKEN.test(characteristicsInternalId) ||
      !TOKEN.test(positionId) ||
      !TOKEN.test(categoryName)
    ) {
      throw new Error(
        `SAP APM indicator row ${index + 1} is missing a documented identity field.`,
      );
    }
    if (technicalObjectNumber !== scope.technicalObjectNumber) {
      throw new Error(
        "SAP APM indicator escaped the approved technical-object filter.",
      );
    }
    const key = bindingKey({
      technicalObjectType,
      characteristicsInternalId,
      positionId,
      categoryName,
    });
    const binding = byKey.get(key);
    if (!binding) {
      throw new Error(
        "SAP APM returned an indicator outside the administrator binding.",
      );
    }
    if (seen.has(key)) {
      throw new Error("SAP APM returned the same indicator more than once.");
    }
    seen.add(key);
    mapped.push({
      external_id: `${technicalObjectNumber}:${technicalObjectType}:${characteristicsInternalId}:${positionId}:${categoryName}`,
      sensor_id: binding.sensorId,
      technical_object_number: technicalObjectNumber,
      technical_object_type: technicalObjectType,
      characteristics_internal_id: characteristicsInternalId,
      position_id: positionId,
      category_name: categoryName,
      site_id: scope.siteId,
      observed_at: scope.observedAt,
    });
  }
  if (seen.size !== byKey.size) {
    throw new Error(
      "An approved SAP APM indicator was not returned; SyncAI will not infer that absence as health.",
    );
  }
  return mapped.sort((left, right) =>
    String(left.external_id).localeCompare(String(right.external_id)),
  );
}

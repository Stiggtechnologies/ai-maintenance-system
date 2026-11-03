export type JsonRecord = Record<string, unknown>;

export interface SapMaintenancePhaseMapping {
  phaseCode: string;
  status: string;
}

export interface SapMaintenanceOrderScope {
  planningPlant: string;
  siteId: string;
  observedAt: string;
  maxRows: number;
  phaseMap: SapMaintenancePhaseMapping[];
}

export interface SapMaintenanceOrderPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAP_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Status values already used by canonical work_orders. Approval and critical are governance states this read does not assert. */
export const SAP_MAINTENANCE_ORDER_STATUSES = [
  "pending",
  "scheduled",
  "in_progress",
  "blocked",
  "completed",
] as const;

export const SAP_MAINTENANCE_ORDER_FIELDS = [
  "MaintenanceOrder",
  "MaintenanceOrderDesc",
  "MaintenancePlanningPlant",
  "Equipment",
  "TechnicalObjectLabel",
  "MaintOrdProcessPhaseCode",
  "MaintOrdBasicStartDate",
  "MaintOrdBasicEndDate",
] as const;

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

function optionalText(value: unknown, label: string, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when present.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new Error(`${label} exceeds its ${max}-character limit.`);
  }
  return text;
}

function odataLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sapTimestamp(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be an OData date-time string when present.`);
  }
  const text = value.trim();
  if (!text) return null;
  if (!SAP_TIMESTAMP.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(
      `${label} must be an ISO-8601 timestamp with a timezone, matching the published Maintenance Order read sample.`,
    );
  }
  return text;
}

export function sapMaintenanceOrderUrl(
  serviceRoot: URL,
  planningPlant: string,
  pageSize: number,
): URL {
  if (!/^[A-Za-z0-9]{1,4}$/.test(planningPlant)) {
    throw new Error("SAP maintenance planning plant is invalid.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
    throw new Error("SAP page size must be between 1 and 5000.");
  }
  const url = new URL(serviceRoot.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/MaintenanceOrder`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("$select", SAP_MAINTENANCE_ORDER_FIELDS.join(","));
  url.searchParams.set(
    "$filter",
    `MaintenancePlanningPlant eq ${odataLiteral(planningPlant)}`,
  );
  url.searchParams.set("$orderby", "MaintenanceOrder");
  url.searchParams.set("$top", String(pageSize));
  url.searchParams.set("$format", "json");
  return url;
}

export function readSapODataPage(payload: unknown): {
  rows: unknown[];
  nextUrl: string | null;
} {
  const root = record(payload, "SAP OData response");
  const envelope = record(root.d, "SAP OData response d envelope");
  if (!Array.isArray(envelope.results)) {
    throw new Error("SAP OData response d.results must be an array.");
  }
  const next = envelope.__next;
  if (next !== undefined && next !== null && typeof next !== "string") {
    throw new Error("SAP OData __next must be a URL string when present.");
  }
  if (typeof next === "string" && next.length > 4096) {
    throw new Error("SAP OData __next exceeds its 4096-character limit.");
  }
  return {
    rows: envelope.results,
    nextUrl: typeof next === "string" && next.trim() ? next.trim() : null,
  };
}

export function validateSapNextUrl(nextValue: string, firstUrl: URL): URL {
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
      "SAP pagination attempted to leave the approved HTTPS resource.",
    );
  }
  for (const key of ["$select", "$filter", "$orderby", "$format"] as const) {
    if (next.searchParams.get(key) !== firstUrl.searchParams.get(key)) {
      throw new Error(`SAP pagination changed the approved ${key} query.`);
    }
  }
  const allowed = new Set([
    "$select",
    "$filter",
    "$orderby",
    "$format",
    "$top",
    "$skip",
    "$skiptoken",
  ]);
  for (const [key] of next.searchParams) {
    if (!allowed.has(key)) {
      throw new Error("SAP pagination added an unapproved query parameter.");
    }
  }
  return next;
}

export function normalizeSapMaintenanceOrderPullRequest(
  value: unknown,
): SapMaintenanceOrderPullRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SAP maintenance order pull request must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const connectorKey = requiredText(body.connector_key, "connector_key", 160);
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  return { connectorKey, dryRun: body.dry_run !== false };
}

function statusForPhase(
  phaseCode: string,
  phaseMap: SapMaintenancePhaseMapping[],
  order: string,
): string | null {
  if (!phaseCode) return null;
  const match = phaseMap.find((item) => item.phaseCode === phaseCode);
  if (!match) {
    throw new Error(
      `SAP maintenance order ${order} process phase ${phaseCode} has no administrator status mapping.`,
    );
  }
  return match.status;
}

export function mapSapMaintenanceOrders(
  values: unknown[],
  scope: SapMaintenanceOrderScope,
): JsonRecord[] {
  if (
    !/^[A-Za-z0-9]{1,4}$/.test(scope.planningPlant) ||
    !UUID.test(scope.siteId) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(scope.observedAt) ||
    !Number.isFinite(Date.parse(scope.observedAt)) ||
    !Number.isSafeInteger(scope.maxRows) ||
    scope.maxRows < 1 ||
    scope.maxRows > 25000 ||
    scope.phaseMap.length > 20 ||
    scope.phaseMap.some(
      (item) =>
        !/^[A-Za-z0-9]{1,2}$/.test(item.phaseCode) ||
        !SAP_MAINTENANCE_ORDER_STATUSES.includes(
          item.status as (typeof SAP_MAINTENANCE_ORDER_STATUSES)[number],
        ),
    )
  ) {
    throw new Error("SAP maintenance order mapping scope is invalid.");
  }
  const phases = new Set(scope.phaseMap.map((item) => item.phaseCode));
  if (phases.size !== scope.phaseMap.length) {
    throw new Error("SAP maintenance order phase map repeats a phase code.");
  }
  if (values.length === 0) {
    throw new Error(
      "SAP returned no maintenance orders; SyncAI will not infer an empty plant as a closed backlog.",
    );
  }
  if (values.length > scope.maxRows) {
    throw new Error(
      "SAP maintenance order response exceeds the approved row limit.",
    );
  }

  const seen = new Set<string>();
  const mapped: JsonRecord[] = [];
  for (const [index, value] of values.entries()) {
    const row = record(value, `SAP maintenance order row ${index + 1}`);
    const order = requiredText(
      row.MaintenanceOrder,
      `SAP maintenance order row ${index + 1} MaintenanceOrder`,
      12,
    );
    if (!/^[A-Za-z0-9]+$/.test(order)) {
      throw new Error(`SAP maintenance order ${order} is not a plain identifier.`);
    }
    const plant = requiredText(
      row.MaintenancePlanningPlant,
      `SAP maintenance order ${order} MaintenancePlanningPlant`,
      4,
    );
    if (plant !== scope.planningPlant) {
      throw new Error(
        "SAP maintenance order escaped the approved planning-plant filter.",
      );
    }
    const equipment = requiredText(
      row.Equipment,
      `SAP maintenance order ${order} Equipment`,
      18,
    );
    if (!/^[A-Za-z0-9]+$/.test(equipment)) {
      throw new Error(
        `SAP maintenance order ${order} Equipment is not a plain identifier.`,
      );
    }
    const technicalObjectLabel = optionalText(
      row.TechnicalObjectLabel,
      `SAP maintenance order ${order} TechnicalObjectLabel`,
      40,
    );
    if (technicalObjectLabel && technicalObjectLabel !== equipment) {
      throw new Error(
        `SAP maintenance order ${order} Equipment and TechnicalObjectLabel disagree.`,
      );
    }
    const description = requiredText(
      row.MaintenanceOrderDesc,
      `SAP maintenance order ${order} MaintenanceOrderDesc`,
      40,
    );
    const phase = optionalText(
      row.MaintOrdProcessPhaseCode,
      `SAP maintenance order ${order} MaintOrdProcessPhaseCode`,
      2,
    );
    if (phase && !/^[A-Za-z0-9]{1,2}$/.test(phase)) {
      throw new Error(
        `SAP maintenance order ${order} process phase is not a 1-2 character code.`,
      );
    }
    const externalId = `${plant}:${order}`;
    if (seen.has(externalId)) {
      throw new Error(`SAP maintenance order ${order} was returned more than once.`);
    }
    seen.add(externalId);
    mapped.push({
      external_id: externalId,
      wo_number: order,
      title: description,
      equipment,
      phase_code: phase,
      status: statusForPhase(phase, scope.phaseMap, order),
      scheduled_start: sapTimestamp(
        row.MaintOrdBasicStartDate,
        `SAP maintenance order ${order} MaintOrdBasicStartDate`,
      ),
      basic_end: sapTimestamp(
        row.MaintOrdBasicEndDate,
        `SAP maintenance order ${order} MaintOrdBasicEndDate`,
      ),
      site_id: scope.siteId,
      observed_at: scope.observedAt,
    });
  }
  return mapped.sort((left, right) =>
    String(left.external_id).localeCompare(String(right.external_id)),
  );
}

export type JsonRecord = Record<string, unknown>;

export interface SapInventoryScope {
  plant: string;
  storageLocation: string;
  siteId: string;
  observedAt: string;
  maxRows: number;
}

export interface SapInventoryPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SAP_MATERIAL_STOCK_FIELDS = [
  "Material",
  "Plant",
  "StorageLocation",
  "InventoryStockType",
  "InventorySpecialStockType",
  "MaterialBaseUnit",
  "MatlWrhsStkQtyInMatlBaseUnit",
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

function quantity(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return parsed;
}

function odataLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sapMaterialStockUrl(
  serviceRoot: URL,
  plant: string,
  storageLocation: string,
  pageSize: number,
): URL {
  if (!plant.trim() || !storageLocation.trim()) {
    throw new Error("SAP plant and storage location are required.");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
    throw new Error("SAP page size must be between 1 and 5000.");
  }
  const url = new URL(serviceRoot.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/A_MatlStkInAcctMod`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("$select", SAP_MATERIAL_STOCK_FIELDS.join(","));
  url.searchParams.set(
    "$filter",
    [
      `Plant eq ${odataLiteral(plant.trim())}`,
      `StorageLocation eq ${odataLiteral(storageLocation.trim())}`,
      "InventoryStockType eq '01'",
      "InventorySpecialStockType eq ''",
    ].join(" and "),
  );
  url.searchParams.set("$orderby", "Material,MaterialBaseUnit");
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

export function normalizeSapInventoryPullRequest(
  value: unknown,
): SapInventoryPullRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SAP inventory pull request must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const connectorKey = requiredText(
    body.connector_key,
    "connector_key",
    160,
  );
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  return { connectorKey, dryRun: body.dry_run !== false };
}

export function mapSapMaterialStock(
  values: unknown[],
  scope: SapInventoryScope,
): JsonRecord[] {
  if (
    !scope.plant.trim() ||
    scope.plant.trim().length > 20 ||
    !scope.storageLocation.trim() ||
    scope.storageLocation.trim().length > 20 ||
    !UUID.test(scope.siteId) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(scope.observedAt) ||
    !Number.isFinite(Date.parse(scope.observedAt)) ||
    !Number.isSafeInteger(scope.maxRows) ||
    scope.maxRows < 1 ||
    scope.maxRows > 25000
  ) {
    throw new Error("SAP inventory mapping scope is invalid.");
  }
  if (values.length === 0) {
    throw new Error(
      "SAP returned no unrestricted stock rows; SyncAI will not infer zero balances from an empty response.",
    );
  }
  if (values.length > scope.maxRows) {
    throw new Error("SAP inventory response exceeds the approved row limit.");
  }

  const aggregated = new Map<string, { uom: string; qty: number }>();
  for (const [index, value] of values.entries()) {
    const row = record(value, `SAP stock row ${index + 1}`);
    const material = requiredText(
      row.Material,
      `SAP stock row ${index + 1} Material`,
      255,
    );
    const plant = requiredText(row.Plant, `SAP stock ${material} Plant`, 20);
    const storage = requiredText(
      row.StorageLocation,
      `SAP stock ${material} StorageLocation`,
      20,
    );
    const stockType = requiredText(
      row.InventoryStockType,
      `SAP stock ${material} InventoryStockType`,
      20,
    );
    const specialType =
      typeof row.InventorySpecialStockType === "string"
        ? row.InventorySpecialStockType.trim()
        : "";
    if (plant !== scope.plant || storage !== scope.storageLocation) {
      throw new Error(
        "SAP stock row escaped the approved plant/storage filter.",
      );
    }
    if (stockType !== "01" || specialType) {
      throw new Error(
        "SAP stock row is not unrestricted, non-special stock and cannot be counted as general on-hand inventory.",
      );
    }
    const uom = requiredText(
      row.MaterialBaseUnit,
      `SAP stock ${material} base unit`,
      40,
    );
    const qty = quantity(
      row.MatlWrhsStkQtyInMatlBaseUnit,
      `SAP stock ${material} quantity`,
    );
    const existing = aggregated.get(material);
    if (existing && existing.uom !== uom) {
      throw new Error(
        `SAP material ${material} returned conflicting base units.`,
      );
    }
    const total = (existing?.qty ?? 0) + qty;
    if (!Number.isFinite(total)) {
      throw new Error(
        `SAP material ${material} aggregate quantity overflowed.`,
      );
    }
    aggregated.set(material, { uom, qty: total });
  }

  return Array.from(aggregated.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([material, value]) => ({
      external_id: `${scope.plant}:${scope.storageLocation}:${material}`,
      material_code: material,
      unit_of_measure: value.uom,
      qty_on_hand: value.qty,
      site_id: scope.siteId,
      observed_at: scope.observedAt,
    }));
}

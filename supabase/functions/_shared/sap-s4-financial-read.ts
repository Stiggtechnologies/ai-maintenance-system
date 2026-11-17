export type JsonRecord = Record<string, unknown>;

export interface SapGlCostMapping {
  wbsElementInternalId: string;
  glAccount: string;
  costItemRef: string;
}

export interface SapGlActualScope {
  ledger: string;
  companyCode: string;
  currency: string;
  postingDateFrom: string;
  postingDateTo: string;
  developmentCaseId: string;
  mappings: SapGlCostMapping[];
  observedAt: string;
  sourceDigest: string;
  maxRows: number;
}

export const SAP_GL_ACTUAL_FIELDS = [
  "Ledger",
  "CompanyCode",
  "WBSElementInternalID",
  "GLAccount",
  "PostingDate",
  "CompanyCodeCurrency",
  "AmountInCompanyCodeCurrency",
] as const;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

function signedAmount(value: unknown, label: string): ExactDecimal {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(
      `${label} must be supplied as an exact decimal string or safe integer.`,
    );
  }
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^-?\d+(?:\.\d+)?$/.test(raw.trim())) {
    throw new Error(`${label} must be an exact finite decimal.`);
  }
  const normalized = raw.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  if (whole.length + fraction.length > 50 || fraction.length > 18) {
    throw new Error(`${label} exceeds the supported exact-decimal envelope.`);
  }
  const coefficient = BigInt(`${negative ? "-" : ""}${whole}${fraction}`);
  return { coefficient, scale: fraction.length };
}

function addDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function decimalText(value: ExactDecimal): string {
  const negative = value.coefficient < 0n;
  const absolute = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole = value.scale ? absolute.slice(0, -value.scale) : absolute;
  const fraction = value.scale
    ? absolute.slice(-value.scale).replace(/0+$/, "")
    : "";
  const rendered = fraction ? `${whole}.${fraction}` : whole;
  return `${negative && value.coefficient !== 0n ? "-" : ""}${rendered}`;
}

function odataLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function dateOnly(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return value;
}

function sapPostingDate(value: unknown, label: string): string {
  const raw = requiredText(value, label);
  const odata = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(raw);
  if (odata) {
    const milliseconds = Number(odata[1]);
    if (!Number.isSafeInteger(milliseconds)) {
      throw new Error(`${label} is outside the supported date envelope.`);
    }
    const parsed = new Date(milliseconds);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error(`${label} is not a valid SAP date.`);
    }
    return parsed.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) {
    throw new Error(`${label} is not a supported SAP date.`);
  }
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} is not a valid SAP date.`);
  }
  return dateOnly(parsed.toISOString().slice(0, 10), label);
}

function mappingKey(wbsElementInternalId: string, glAccount: string): string {
  return `${wbsElementInternalId}\u0000${glAccount}`;
}

export function sapGlActualsUrl(
  serviceRoot: URL,
  scope: Pick<
    SapGlActualScope,
    "ledger" | "companyCode" | "postingDateFrom" | "postingDateTo" | "mappings"
  >,
  pageSize: number,
): URL {
  const ledger = requiredText(scope.ledger, "SAP ledger");
  const company = requiredText(scope.companyCode, "SAP company code");
  const from = dateOnly(scope.postingDateFrom, "Posting start date");
  const to = dateOnly(scope.postingDateTo, "Posting end date");
  if (from > to)
    throw new Error("Posting start date cannot follow the end date.");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000) {
    throw new Error("SAP page size must be between 1 and 5000.");
  }
  if (
    !Array.isArray(scope.mappings) ||
    scope.mappings.length < 1 ||
    scope.mappings.length > 40
  ) {
    throw new Error(
      "SAP financial mapping must contain between 1 and 40 approved pairs.",
    );
  }

  const seen = new Set<string>();
  const pairs = scope.mappings.map((mapping, index) => {
    const wbs = requiredText(
      mapping.wbsElementInternalId,
      `Mapping ${index + 1} WBS`,
    );
    const gl = requiredText(
      mapping.glAccount,
      `Mapping ${index + 1} G/L account`,
    );
    requiredText(
      mapping.costItemRef,
      `Mapping ${index + 1} cost item reference`,
    );
    const key = mappingKey(wbs, gl);
    if (seen.has(key))
      throw new Error(`SAP mapping ${wbs}/${gl} is duplicated.`);
    seen.add(key);
    return `(WBSElementInternalID eq ${odataLiteral(wbs)} and GLAccount eq ${odataLiteral(gl)})`;
  });

  const url = new URL(serviceRoot.href);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/GLAccountLineItem`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("$select", SAP_GL_ACTUAL_FIELDS.join(","));
  url.searchParams.set(
    "$filter",
    [
      `Ledger eq ${odataLiteral(ledger)}`,
      `CompanyCode eq ${odataLiteral(company)}`,
      `PostingDate ge datetime'${from}T00:00:00'`,
      `PostingDate le datetime'${to}T23:59:59'`,
      `(${pairs.join(" or ")})`,
    ].join(" and "),
  );
  url.searchParams.set(
    "$orderby",
    "WBSElementInternalID,GLAccount,PostingDate",
  );
  url.searchParams.set("$top", String(pageSize));
  url.searchParams.set("$format", "json");
  if (url.href.length > 12_000) {
    throw new Error(
      "Approved SAP financial mapping makes the bounded request URL too large.",
    );
  }
  return url;
}

export function readSapGlODataPage(payload: unknown): {
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
  return {
    rows: envelope.results,
    nextUrl: typeof next === "string" && next.trim() ? next.trim() : null,
  };
}

export function validateSapGlNextUrl(nextValue: string, firstUrl: URL): URL {
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
  for (const key of [
    "$select",
    "$filter",
    "$orderby",
    "$format",
    "$top",
  ] as const) {
    if (next.searchParams.getAll(key).length !== 1) {
      throw new Error(`SAP pagination duplicated or omitted ${key}.`);
    }
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
    if (!allowed.has(key))
      throw new Error("SAP pagination added an unapproved query parameter.");
  }
  for (const key of ["$skip", "$skiptoken"] as const) {
    if (next.searchParams.getAll(key).length > 1) {
      throw new Error("SAP pagination duplicated its paging cursor.");
    }
  }
  const cursors = ["$skip", "$skiptoken"].filter((key) =>
    next.searchParams.get(key)?.trim(),
  );
  if (cursors.length !== 1) {
    throw new Error("SAP pagination must supply exactly one paging cursor.");
  }
  return next;
}

export function mapSapGlActuals(
  values: unknown[],
  scope: SapGlActualScope,
): { rows: JsonRecord[]; missingMappings: string[] } {
  const ledger = requiredText(scope.ledger, "SAP ledger");
  const company = requiredText(scope.companyCode, "SAP company code");
  const currency = requiredText(
    scope.currency,
    "Company code currency",
  ).toUpperCase();
  const from = dateOnly(scope.postingDateFrom, "Posting start date");
  const to = dateOnly(scope.postingDateTo, "Posting end date");
  if (from > to)
    throw new Error("Posting start date cannot follow the end date.");
  if (
    !scope.developmentCaseId.trim() ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(scope.observedAt) ||
    !Number.isFinite(Date.parse(scope.observedAt)) ||
    !/^[0-9a-f]{64}$/.test(scope.sourceDigest) ||
    !Number.isSafeInteger(scope.maxRows) ||
    scope.maxRows < 1 ||
    scope.maxRows > 25000
  ) {
    throw new Error("SAP financial mapping scope is invalid.");
  }
  if (values.length === 0) {
    throw new Error(
      "SAP returned no mapped journal rows; SyncAI will not infer zero actuals from an empty response.",
    );
  }
  if (values.length > scope.maxRows) {
    throw new Error("SAP financial response exceeds the approved row limit.");
  }

  const approved = new Map<string, SapGlCostMapping>();
  for (const [index, mapping] of scope.mappings.entries()) {
    const wbs = requiredText(
      mapping.wbsElementInternalId,
      `Mapping ${index + 1} WBS`,
    );
    const gl = requiredText(
      mapping.glAccount,
      `Mapping ${index + 1} G/L account`,
    );
    const ref = requiredText(
      mapping.costItemRef,
      `Mapping ${index + 1} cost item reference`,
    );
    const key = mappingKey(wbs, gl);
    if (approved.has(key))
      throw new Error(`SAP mapping ${wbs}/${gl} is duplicated.`);
    approved.set(key, {
      wbsElementInternalId: wbs,
      glAccount: gl,
      costItemRef: ref,
    });
  }
  if (approved.size < 1 || approved.size > 40) {
    throw new Error(
      "SAP financial mapping must contain between 1 and 40 approved pairs.",
    );
  }

  const totals = new Map<string, ExactDecimal>();
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const row = record(value, `SAP G/L row ${index + 1}`);
    const rowLedger = requiredText(
      row.Ledger,
      `SAP G/L row ${index + 1} Ledger`,
    );
    const rowCompany = requiredText(
      row.CompanyCode,
      `SAP G/L row ${index + 1} CompanyCode`,
    );
    const wbs = requiredText(
      row.WBSElementInternalID,
      `SAP G/L row ${index + 1} WBS`,
    );
    const gl = requiredText(
      row.GLAccount,
      `SAP G/L row ${index + 1} G/L account`,
    );
    const postingDate = sapPostingDate(
      row.PostingDate,
      `SAP G/L row ${index + 1} PostingDate`,
    );
    if (postingDate < from || postingDate > to) {
      throw new Error(
        "SAP journal row escaped the approved cumulative posting window.",
      );
    }
    const rowCurrency = requiredText(
      row.CompanyCodeCurrency,
      `SAP G/L row ${index + 1} currency`,
    ).toUpperCase();
    if (rowLedger !== ledger || rowCompany !== company) {
      throw new Error(
        "SAP journal row escaped the approved ledger/company filter.",
      );
    }
    if (rowCurrency !== currency) {
      throw new Error(
        `SAP journal row currency ${rowCurrency} does not match approved ${currency}.`,
      );
    }
    const key = mappingKey(wbs, gl);
    const mapping = approved.get(key);
    if (!mapping)
      throw new Error(
        "SAP journal row escaped the approved WBS/G/L mapping filter.",
      );
    const amount = signedAmount(
      row.AmountInCompanyCodeCurrency,
      `SAP ${wbs}/${gl} amount`,
    );
    const total = addDecimal(
      totals.get(mapping.costItemRef) ?? { coefficient: 0n, scale: 0 },
      amount,
    );
    totals.set(mapping.costItemRef, total);
    seen.add(key);
  }

  for (const [ref, total] of totals) {
    if (total.coefficient < 0n) {
      throw new Error(
        `SAP cumulative actual for ${ref} is negative; resolve the source accounting classification before import.`,
      );
    }
  }

  const digest = scope.sourceDigest.slice(0, 24);
  const rows = Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([costItemRef, actual]) => ({
      external_id: `sapgl:${ledger}:${company}:${costItemRef}:${digest}`,
      development_case_id: scope.developmentCaseId,
      cost_item_ref: costItemRef,
      actual_to_date: decimalText(actual),
      currency,
      as_of: scope.observedAt,
      basis: `SAP S/4 G/L actuals ${ledger}/${company}, postings ${from} through ${to}; WBS/G/L mapping approved on the connector.`,
    }));
  const missingMappings = Array.from(approved.entries())
    .filter(([key]) => !seen.has(key))
    .map(
      ([, mapping]) => `${mapping.wbsElementInternalId}/${mapping.glAccount}`,
    )
    .sort();
  return { rows, missingMappings };
}

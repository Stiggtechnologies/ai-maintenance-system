export type DataLakeFormat = "csv" | "jsonl" | "json";

export interface DataLakeCursor {
  last_modified: string;
  path: string;
}

export interface AdlsPathItem {
  name: string;
  isDirectory?: string | boolean;
  contentLength?: string | number;
  lastModified?: string;
  etag?: string;
}

export interface SelectedAdlsObject {
  path: string;
  contentLength: number;
  lastModified: string;
  etag: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const object = record(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

/** Strict RFC 4180 parser used by the deployed Edge transport. */
export function parseCsvObjects(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
      } else {
        field += character;
      }
      index += 1;
      continue;
    }
    if (character === '"') {
      if (field.length) throw new Error("CSV quote must start a field.");
      quoted = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n") {
      endRow();
    } else if (character !== "\r") {
      field += character;
    }
    index += 1;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field !== "" || row.length) endRow();
  if (rows.length < 2)
    throw new Error("CSV object must contain a header and at least one row.");
  const headers = rows[0].map((header) => header.trim());
  if (
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  ) {
    throw new Error("CSV headers must be non-empty and unique.");
  }
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}.`,
      );
    }
    return Object.fromEntries(
      headers.map((header, column) => [header, values[column]]),
    );
  });
}

export function parseDataLakeObject(
  text: string,
  format: DataLakeFormat,
  sourceArrayPath: string,
): Array<Record<string, unknown>> {
  if (format === "csv") return parseCsvObjects(text);
  if (format === "jsonl") {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) throw new Error("JSONL object contains no rows.");
    return lines.map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`JSONL line ${index + 1} is not valid JSON.`);
      }
      const item = record(parsed);
      if (!item)
        throw new Error(`JSONL line ${index + 1} must be a JSON object.`);
      return item;
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON object is not valid JSON.");
  }
  const selected = valueAtPath(parsed, sourceArrayPath);
  if (!Array.isArray(selected) || selected.some((item) => !record(item))) {
    throw new Error(
      "JSON object must contain an array of objects at the approved source path.",
    );
  }
  return selected as Array<Record<string, unknown>>;
}

export function validateObjectPath(path: string): string {
  const value = path.trim();
  if (
    !value ||
    value.length > 2048 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//") ||
    value.split("/").some((segment) => segment === ".." || segment === ".") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error("ADLS returned an unsafe object path.");
  }
  return value;
}

export function encodeObjectPath(path: string): string {
  return validateObjectPath(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function cursorOrder(left: DataLakeCursor, right: DataLakeCursor): number {
  const leftTime = Date.parse(left.last_modified);
  const rightTime = Date.parse(right.last_modified);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    throw new Error("ADLS object last-modified timestamp is invalid.");
  }
  if (leftTime !== rightTime) return leftTime - rightTime;
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left.path);
  const rightBytes = encoder.encode(right.path);
  for (
    let index = 0;
    index < Math.min(leftBytes.length, rightBytes.length);
    index += 1
  ) {
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }
  return leftBytes.length - rightBytes.length;
}

export function selectAdlsObjects(
  items: AdlsPathItem[],
  prefix: string,
  format: DataLakeFormat,
  previous: DataLakeCursor | null,
  maxFiles: number,
  maxBytes = Number.MAX_SAFE_INTEGER,
): { objects: SelectedAdlsObject[]; cursor: DataLakeCursor | null } {
  const suffix = format === "jsonl" ? ".jsonl" : `.${format}`;
  const eligible = items
    .filter(
      (item) =>
        item.isDirectory !== true &&
        String(item.isDirectory ?? "false").toLowerCase() !== "true",
    )
    .map((item) => {
      const path = validateObjectPath(String(item.name ?? ""));
      const contentLength = Number(item.contentLength ?? -1);
      const lastModified = String(item.lastModified ?? "");
      const etag = String(item.etag ?? "");
      if (!path.startsWith(prefix) || !path.toLowerCase().endsWith(suffix)) {
        return null;
      }
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        !Number.isFinite(Date.parse(lastModified)) ||
        !etag
      )
        throw new Error("ADLS object is missing valid immutable metadata.");
      return { path, contentLength, lastModified, etag };
    })
    .filter((item): item is SelectedAdlsObject => item !== null)
    .sort((left, right) =>
      cursorOrder(
        { last_modified: left.lastModified, path: left.path },
        { last_modified: right.lastModified, path: right.path },
      ),
    )
    .filter(
      (item) =>
        !previous ||
        cursorOrder(
          { last_modified: item.lastModified, path: item.path },
          previous,
        ) > 0,
    );
  const objects: SelectedAdlsObject[] = [];
  let bytes = 0;
  for (const object of eligible) {
    if (objects.length >= maxFiles) break;
    if (bytes + object.contentLength > maxBytes) {
      if (!objects.length)
        throw new Error(
          "Next ADLS object exceeds the administrator-approved byte limit.",
        );
      break;
    }
    objects.push(object);
    bytes += object.contentLength;
  }
  const last = objects.at(-1);
  return {
    objects,
    cursor: last ? { last_modified: last.lastModified, path: last.path } : null,
  };
}

export function applyDataLakeMapping(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
  valueMaps: Record<string, Record<string, string>>,
  constants: Record<string, unknown>,
  provenance: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const raw = valueAtPath(row, source);
    if (raw === undefined || raw === null || raw === "") continue;
    result[target] = valueMaps[target]?.[String(raw)] ?? raw;
  }
  for (const [target, value] of Object.entries(constants)) {
    if (value !== undefined && value !== null && value !== "")
      result[target] = value;
  }
  result._sync_source = provenance;
  return result;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const exact = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exact.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

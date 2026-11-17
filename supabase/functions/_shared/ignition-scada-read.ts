// Read-only Ignition tag snapshot.
//
// Inductive Automation documents two pieces this adapter depends on, and no
// tag-write API is called:
//
// 1. WebDev Python resources are mounted at
//    `/system/webdev/<project>/<resource>` and `doGet` receives query
//    parameters as strings on `request['params']`. Returning `{'json': ...}`
//    produces `application/json`.
//    https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev
//    https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/web-dev/simple-web-server
//
// 2. `system.tag.readBlocking(tagPaths)` returns QualifiedValue objects whose
//    attributes are `value`, `quality` and `timestamp`. A gateway-scope path
//    includes the provider, for example `[default]Plant/Temperature`.
//    https://www.docs.inductiveautomation.com/docs/8.3/appendix/scripting-functions/system-tag/system-tag-readBlocking
//    https://www.docs.inductiveautomation.com/docs/8.3/platform/scripting/scripting-examples/reading-and-writing-to-tags
//
// JSON has no Java Date, so the approved WebDev resource must emit the
// QualifiedValue timestamp as ISO-8601 text and `quality` as a string
// (`str(qv.quality)`). This module issues HTTP GET only. It refuses a
// write-enabled source, a WebDev path that names a write resource, and any
// response that is not the one configured tag.

export type JsonRecord = Record<string, unknown>;

export interface IgnitionPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

export interface IgnitionTagReading {
  path: string;
  value: string | number | boolean | null;
  quality: string;
  timestamp: string;
}

export interface IgnitionReadInput {
  resource: string;
  tagPaths: string[];
  authorization: string;
  direction: string;
  writeEnabled: boolean;
  allowLoopback?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface IgnitionReadResult {
  readings: IgnitionTagReading[];
  manifest: JsonRecord[];
  totalBytes: number;
  fetchedAt: string;
}

export const IGNITION_MAX_TAGS = 20;
export const IGNITION_MAX_PATH = 200;
export const IGNITION_MAX_TAG_BYTES = 64 * 1024;
export const IGNITION_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const IGNITION_MAX_TRANSPORT_MS = 55_000;

const TAG_PATH = /^\[[A-Za-z][A-Za-z0-9_-]{0,63}\][^\s?#]{1,180}$/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) <= 31) return true;
  }
  return false;
}
const QUALITY = /^[A-Za-z][A-Za-z0-9_ .[\]-]{0,79}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const PRIVATE_HOST =
  /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;

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

export function normalizeIgnitionTagPaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > IGNITION_MAX_TAGS
  ) {
    throw new Error(
      `Ignition tag list must contain 1 to ${IGNITION_MAX_TAGS} paths.`,
    );
  }
  const paths = value.map((entry, index) =>
    requiredText(entry, `Ignition tag path ${index + 1}`, IGNITION_MAX_PATH),
  );
  if (new Set(paths).size !== paths.length) {
    throw new Error("Ignition tag list repeats a path.");
  }
  for (const path of paths) {
    if (
      !TAG_PATH.test(path) ||
      path.includes("..") ||
      path.includes("\\") ||
      /write/i.test(path) ||
      hasControlCharacter(path)
    ) {
      throw new Error(
        `Ignition tag path ${path.slice(0, 80)} is not an approved provider path.`,
      );
    }
  }
  return paths;
}

export function assertIgnitionResourceUrl(
  value: string,
  allowLoopback = false,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Ignition WebDev resource is not a URL.");
  }
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  const privateHost = PRIVATE_HOST.test(host);
  const pathOk =
    /^\/system\/webdev\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(
      url.pathname,
    );
  if (url.username || url.password || url.search || url.hash || !pathOk) {
    throw new Error(
      "Ignition resource must be a credential-free /system/webdev/<project>/<resource> URL with no query or fragment.",
    );
  }
  if (/write/i.test(url.pathname) || /webdev_staging/i.test(url.pathname)) {
    throw new Error(
      "Ignition resource must be a published read WebDev path, not a write or staging resource.",
    );
  }
  if (allowLoopback && host === "127.0.0.1") {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Ignition loopback resource must be HTTP or HTTPS.");
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    url.hash = "";
    url.search = "";
    return url;
  }
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    loopback ||
    privateHost ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.startsWith("[")
  ) {
    throw new Error(
      "Ignition resource is not a credential-free public HTTPS URL.",
    );
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.hash = "";
  url.search = "";
  return url;
}

export function ignitionTagReadUrl(
  resource: URL,
  tagPath: string,
  allowLoopback = false,
): URL {
  const approved = assertIgnitionResourceUrl(resource.href, allowLoopback);
  const [path] = normalizeIgnitionTagPaths([tagPath]);
  const url = new URL(approved.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("tagPath", path);
  return url;
}

export function normalizeIgnitionPullRequest(
  value: unknown,
): IgnitionPullRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ignition pull request must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const connectorKey = requiredText(body.connector_key, "connector_key", 160);
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  return { connectorKey, dryRun: body.dry_run !== false };
}

function tagValue(value: unknown, label: string): IgnitionTagReading["value"] {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number when numeric.`);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 2000 || hasControlCharacter(value)) {
      throw new Error(
        `${label} exceeds its text limit or contains control characters.`,
      );
    }
    return value;
  }
  throw new Error(`${label} must be a string, number, boolean or null.`);
}

export function parseIgnitionQualifiedValue(
  payload: unknown,
  expectedPath: string,
): IgnitionTagReading {
  const body = record(payload, "Ignition tag read");
  const allowed = new Set(["path", "value", "quality", "timestamp"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error(
        "Ignition tag read returned a field outside path, value, quality and timestamp.",
      );
    }
  }
  const path = requiredText(body.path, "Ignition tag path", IGNITION_MAX_PATH);
  if (path !== expectedPath) {
    throw new Error("Ignition tag read escaped the approved tag path.");
  }
  const quality = requiredText(body.quality, "Ignition tag quality", 80);
  if (!QUALITY.test(quality)) {
    throw new Error(
      "Ignition tag quality is not a QualifiedValue quality string.",
    );
  }
  const timestamp = requiredText(body.timestamp, "Ignition tag timestamp", 40);
  if (!TIMESTAMP.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Ignition tag timestamp must be ISO-8601 with a timezone.");
  }
  const takenAt = Date.parse(timestamp);
  if (takenAt > Date.now() + 5 * 60 * 1000) {
    throw new Error("Ignition tag timestamp is in the future.");
  }
  return {
    path,
    value: tagValue(body.value, "Ignition tag value"),
    quality,
    timestamp,
  };
}

export function mapIgnitionTagReads(
  readings: IgnitionTagReading[],
  approvedPaths: string[],
): JsonRecord[] {
  const paths = normalizeIgnitionTagPaths(approvedPaths);
  if (readings.length !== paths.length) {
    throw new Error("Ignition response did not include every approved tag.");
  }
  return readings.map((reading, index) => {
    if (reading.path !== paths[index]) {
      throw new Error(
        "Ignition response did not follow the approved tag order.",
      );
    }
    return {
      external_id: reading.path,
      path: reading.path,
      value: reading.value,
      quality: reading.quality,
      timestamp: reading.timestamp,
    };
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Ignition tag response exceeds its transport byte limit.");
  }
  if (!response.body) throw new Error("Ignition tag response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(
        "Ignition tag response exceeds its transport byte limit.",
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertReadOnly(input: IgnitionReadInput): void {
  if (input.direction !== "read_only" || input.writeEnabled !== false) {
    throw new Error("Ignition source is not enabled and read-only.");
  }
  if (
    typeof input.authorization !== "string" ||
    input.authorization.length < 12 ||
    input.authorization.length > 4096 ||
    /[\r\n]/.test(input.authorization) ||
    (!input.authorization.startsWith("Basic ") &&
      !input.authorization.startsWith("Bearer "))
  ) {
    throw new Error("Ignition authorization header is invalid.");
  }
}

export async function readIgnitionTagSnapshot(
  input: IgnitionReadInput,
): Promise<IgnitionReadResult> {
  assertReadOnly(input);
  const paths = normalizeIgnitionTagPaths(input.tagPaths);
  const resource = assertIgnitionResourceUrl(
    input.resource,
    input.allowLoopback === true,
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const clock = input.now ?? Date.now;
  const deadline = clock() + IGNITION_MAX_TRANSPORT_MS;
  const readings: IgnitionTagReading[] = [];
  const manifest: JsonRecord[] = [];
  let totalBytes = 0;

  for (const tagPath of paths) {
    const remaining = deadline - clock();
    if (remaining <= 0) {
      throw new Error("Ignition tag read exceeded its time limit.");
    }
    const remainingBytes = IGNITION_MAX_TOTAL_BYTES - totalBytes;
    if (remainingBytes <= 0) {
      throw new Error("Ignition tag read exceeds the total byte limit.");
    }
    const url = ignitionTagReadUrl(
      resource,
      tagPath,
      input.allowLoopback === true,
    );
    if (url.searchParams.get("tagPath") !== tagPath) {
      throw new Error("Ignition tag path was not preserved on the GET query.");
    }
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: input.authorization,
      },
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(25_000, remaining)),
    });
    if (
      !response.ok ||
      !(response.headers.get("content-type") ?? "")
        .toLowerCase()
        .includes("application/json")
    ) {
      throw new Error(
        "Ignition tag read did not return successful application/json.",
      );
    }
    const bytes = await boundedBytes(
      response,
      Math.min(IGNITION_MAX_TAG_BYTES, remainingBytes),
    );
    totalBytes += bytes.byteLength;
    if (totalBytes > IGNITION_MAX_TOTAL_BYTES) {
      throw new Error("Ignition tag read exceeds the total byte limit.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error("Ignition tag response is not valid UTF-8 JSON.");
    }
    const reading = parseIgnitionQualifiedValue(payload, tagPath);
    readings.push(reading);
    manifest.push({
      transport: "ignition_webdev_get",
      resource: "system.tag.readBlocking",
      page: manifest.length + 1,
      tag_path: tagPath,
      sha256: await sha256Hex(bytes),
      bytes: bytes.byteLength,
    });
  }

  if (clock() > deadline) {
    throw new Error("Ignition tag read exceeded its time limit.");
  }
  return {
    readings,
    manifest,
    totalBytes,
    fetchedAt: new Date(clock()).toISOString(),
  };
}

// Read-only OPC-UA contract shared by the Deno pull function and the Node
// gateway shim. The edge runtime never opens opc.tcp. It validates this
// envelope and POSTs it to an allowlisted HTTPS /v1/read gateway. The gateway
// is the only component that speaks OPC UA Binary, and only the Read service.

export type JsonRecord = Record<string, unknown>;

export const OPC_UA_SECURITY_MODES = [
  "None",
  "Sign",
  "SignAndEncrypt",
] as const;
export const OPC_UA_SECURITY_POLICIES = [
  "None",
  "Basic256Sha256",
  "Aes128_Sha256_RsaOaep",
  "Aes256_Sha256_RsaPss",
] as const;
export const OPC_UA_AUTH_MODES = ["anonymous", "username"] as const;

export type OpcUaSecurityMode = (typeof OPC_UA_SECURITY_MODES)[number];
export type OpcUaSecurityPolicy = (typeof OPC_UA_SECURITY_POLICIES)[number];
export type OpcUaAuthMode = (typeof OPC_UA_AUTH_MODES)[number];

export interface OpcUaPullRequest {
  connectorKey: string;
  dryRun: boolean;
}

export interface ParsedOpcUaNodeId {
  canonical: string;
  namespace: number;
  identifierType: "numeric" | "string";
  numericId?: number;
  stringId?: string;
}

export interface OpcUaAnonymousIdentity {
  type: "anonymous";
}

export interface OpcUaUsernameIdentity {
  type: "username";
  username: string;
  password: string;
}

export type OpcUaUserIdentity = OpcUaAnonymousIdentity | OpcUaUsernameIdentity;

export interface OpcUaReading {
  nodeId: string;
  value: string | number | boolean | null;
  statusCode: string;
  sourceTimestamp: string;
}

export interface OpcUaReadScope {
  nodeIds: string[];
  maxNodes: number;
}

const PRIVATE_IPV4 =
  /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;

const FORBIDDEN_BODY_KEYS = new Set([
  "write",
  "call",
  "method",
  "methodid",
  "method_id",
  "valuetowrite",
  "value_to_write",
  "operation",
]);

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
  if ([...text].some((character) => character.charCodeAt(0) <= 31)) {
    throw new Error(`${label} contains a control character.`);
  }
  return text;
}

export function normalizeOpcUaPullRequest(value: unknown): OpcUaPullRequest {
  const body = record(value, "OPC-UA pull request");
  const connectorKey = requiredText(body.connector_key, "connector_key", 160);
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    throw new Error("dry_run must be true or false when supplied.");
  }
  assertReadOnlyEnvelope(body);
  return { connectorKey, dryRun: body.dry_run !== false };
}

export function assertReadOnlyEnvelope(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertReadOnlyEnvelope(item);
    return;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_BODY_KEYS.has(key.toLowerCase())) {
      throw new Error(
        "OPC-UA read refuses write, call and method-invocation fields.",
      );
    }
    assertReadOnlyEnvelope(child);
  }
}

export function parseOpcUaNodeId(value: string): ParsedOpcUaNodeId {
  const text = requiredText(value, "OPC-UA nodeId", 512);
  const numeric = /^(?:ns=(\d+);)?i=(\d+)$/.exec(text);
  if (numeric) {
    const namespace = numeric[1] ? Number(numeric[1]) : 0;
    const numericId = Number(numeric[2]);
    if (
      !Number.isInteger(namespace) ||
      namespace < 0 ||
      namespace > 65535 ||
      !Number.isSafeInteger(numericId) ||
      numericId < 0 ||
      numericId > 0xffffffff
    ) {
      throw new Error(`OPC-UA nodeId ${text} is outside the numeric range.`);
    }
    return {
      canonical:
        namespace === 0 ? `i=${numericId}` : `ns=${namespace};i=${numericId}`,
      namespace,
      identifierType: "numeric",
      numericId,
    };
  }
  const textual = /^(?:ns=(\d+);)?s=(.+)$/.exec(text);
  if (
    !textual ||
    !textual[2] ||
    (/\s/.test(textual[2]) && textual[2].trim() !== textual[2])
  ) {
    throw new Error(
      "OPC-UA nodeId must be i=<id>, s=<name>, ns=<n>;i=<id> or ns=<n>;s=<name>.",
    );
  }
  const namespace = textual[1] ? Number(textual[1]) : 0;
  const stringId = textual[2];
  if (
    !Number.isInteger(namespace) ||
    namespace < 0 ||
    namespace > 65535 ||
    stringId.length > 500
  ) {
    throw new Error(`OPC-UA nodeId ${text} is outside the string contract.`);
  }
  return {
    canonical:
      namespace === 0 ? `s=${stringId}` : `ns=${namespace};s=${stringId}`,
    namespace,
    identifierType: "string",
    stringId,
  };
}

export function normalizeOpcUaNodeList(
  value: unknown,
  maxNodes = 50,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error("OPC-UA node list must be an array.");
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 50) {
    throw new Error("OPC-UA node list limit must be between 1 and 50.");
  }
  if (value.length < 1 || value.length > maxNodes) {
    throw new Error("OPC-UA node list must contain between 1 and 50 node ids.");
  }
  const canonical: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error("OPC-UA node list entries must be strings.");
    }
    const node = parseOpcUaNodeId(item);
    if (seen.has(node.canonical)) {
      throw new Error(
        `OPC-UA node ${node.canonical} is listed more than once.`,
      );
    }
    seen.add(node.canonical);
    canonical.push(node.canonical);
  }
  return canonical;
}

export function assertOpcUaSecuritySelection(
  mode: OpcUaSecurityMode,
  policy: OpcUaSecurityPolicy,
): void {
  if (mode !== "None" || policy !== "None") {
    throw new Error(
      "Configured OPC-UA security is not SecurityPolicy None. The read-only gateway shim will not downgrade Sign or SignAndEncrypt onto an open channel.",
    );
  }
}

export function assertOpcTcpEndpoint(
  value: string,
  allowedHosts: readonly string[],
): { href: string; hostname: string; port: number } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("OPC-UA endpoint must be an opc.tcp URL.");
  }
  const hostname = url.hostname.toLowerCase();
  const port = url.port ? Number(url.port) : 0;
  if (
    url.protocol !== "opc.tcp:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !hostname ||
    hostname.includes("@") ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "OPC-UA endpoint must be a credential-free opc.tcp URL with an explicit port.",
    );
  }
  const allow = new Set(
    allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
  );
  if (!allow.has(hostname)) {
    throw new Error("OPC-UA server host is not in the deployment allowlist.");
  }
  const path = url.pathname === "/" ? "" : url.pathname;
  return { href: `opc.tcp://${hostname}:${port}${path}`, hostname, port };
}

export function assertHttpsReadGateway(
  value: string,
  allowedHosts: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("OPC-UA gateway URL is invalid.");
  }
  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.startsWith("[") ||
    PRIVATE_IPV4.test(host);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    privateHost ||
    !url.pathname.endsWith("/v1/read")
  ) {
    throw new Error(
      "OPC-UA gateway must be a credential-free public HTTPS URL ending in /v1/read.",
    );
  }
  const allow = new Set(
    allowedHosts.map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
  if (!allow.size || !allow.has(host)) {
    throw new Error("OPC-UA gateway host is not in the deployment allowlist.");
  }
  return url;
}

export function resolveOpcUaCredential(
  registryJson: string,
  binding: string,
  authMode: OpcUaAuthMode,
): OpcUaUserIdentity {
  const reference = requiredText(binding, "credential binding", 500);
  let registry: unknown;
  try {
    registry = JSON.parse(registryJson);
  } catch {
    throw new Error("OPC-UA credential registry is not valid JSON.");
  }
  const root = record(registry, "OPC-UA credential registry");
  const entry = record(root[reference], "OPC-UA credential binding");
  if (entry.type !== authMode) {
    throw new Error(
      "OPC-UA credential binding does not match the configured authentication mode.",
    );
  }
  if (authMode === "anonymous") {
    if ("password" in entry || "username" in entry) {
      throw new Error("Anonymous OPC-UA credential must not carry a password.");
    }
    return { type: "anonymous" };
  }
  const username = requiredText(entry.username, "OPC-UA username", 160);
  const password = requiredText(entry.password, "OPC-UA password", 512);
  if (password.length < 8) {
    throw new Error("OPC-UA password is shorter than the 8-character minimum.");
  }
  return { type: "username", username, password };
}

export interface OpcUaGatewayCall {
  url: string;
  body: {
    endpointUrl: string;
    securityMode: OpcUaSecurityMode;
    securityPolicy: OpcUaSecurityPolicy;
    userIdentity: OpcUaUserIdentity;
    nodeIds: string[];
    timeoutMs: number;
  };
}

export function buildOpcUaReadGatewayCall(input: {
  gatewayUrl: string;
  allowedGatewayHosts: readonly string[];
  endpointUrl: string;
  allowedServerHosts: readonly string[];
  securityMode: OpcUaSecurityMode;
  securityPolicy: OpcUaSecurityPolicy;
  userIdentity: OpcUaUserIdentity;
  nodeIds: readonly string[];
  timeoutMs: number;
}): OpcUaGatewayCall {
  assertOpcUaSecuritySelection(input.securityMode, input.securityPolicy);
  const gateway = assertHttpsReadGateway(
    input.gatewayUrl,
    input.allowedGatewayHosts,
  );
  const endpoint = assertOpcTcpEndpoint(
    input.endpointUrl,
    input.allowedServerHosts,
  );
  const nodeIds = normalizeOpcUaNodeList([...input.nodeIds]);
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 20000
  ) {
    throw new Error("OPC-UA read timeout must be between 1 and 20 seconds.");
  }
  const body = {
    endpointUrl: endpoint.href,
    securityMode: input.securityMode,
    securityPolicy: input.securityPolicy,
    userIdentity: input.userIdentity,
    nodeIds,
    timeoutMs: input.timeoutMs,
  };
  assertReadOnlyEnvelope(body);
  return { url: gateway.href, body };
}

function statusCode(value: unknown): string {
  const text = requiredText(value, "OPC-UA statusCode", 16).toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(text)) {
    throw new Error("OPC-UA statusCode must be an 8-digit hex status word.");
  }
  return text;
}

function sourceTimestamp(value: unknown): string {
  const text = requiredText(value, "OPC-UA sourceTimestamp", 40);
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    throw new Error(
      "OPC-UA sourceTimestamp must be a timezone-qualified instant.",
    );
  }
  return new Date(text).toISOString();
}

function readingValue(value: unknown): string | number | boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("OPC-UA value must be a finite scalar.");
    }
    return value;
  }
  if (typeof value === "string") {
    return requiredText(value, "OPC-UA value", 4000);
  }
  throw new Error("OPC-UA value must be a boolean, number, string or null.");
}

export function mapOpcUaReadings(
  payload: unknown,
  scope: OpcUaReadScope,
): OpcUaReading[] {
  const approved = normalizeOpcUaNodeList(scope.nodeIds, scope.maxNodes);
  const root = record(payload, "OPC-UA gateway response");
  assertReadOnlyEnvelope(root);
  if (!Array.isArray(root.readings)) {
    throw new Error("OPC-UA gateway response readings must be an array.");
  }
  if (root.readings.length !== approved.length) {
    throw new Error(
      "OPC-UA gateway response does not cover the approved node list exactly.",
    );
  }
  const byNode = new Map<string, OpcUaReading>();
  for (const [index, item] of root.readings.entries()) {
    const row = record(item, `OPC-UA reading ${index + 1}`);
    const keys = Object.keys(row);
    if (
      keys.some(
        (key) =>
          !["nodeId", "value", "statusCode", "sourceTimestamp"].includes(key),
      )
    ) {
      throw new Error(
        "OPC-UA reading contains a field outside the read contract.",
      );
    }
    const node = parseOpcUaNodeId(requiredText(row.nodeId, "nodeId", 512));
    if (!approved.includes(node.canonical) || byNode.has(node.canonical)) {
      throw new Error(
        `OPC-UA node ${node.canonical} is not an approved unique read target.`,
      );
    }
    const status = statusCode(row.statusCode);
    const value = readingValue(row.value);
    if (status === "0x00000000" && value === null) {
      throw new Error(`Good OPC-UA node ${node.canonical} omitted its value.`);
    }
    byNode.set(node.canonical, {
      nodeId: node.canonical,
      value,
      statusCode: status,
      sourceTimestamp: sourceTimestamp(row.sourceTimestamp),
    });
  }
  return approved.map((nodeId) => {
    const reading = byNode.get(nodeId);
    if (!reading) {
      throw new Error(
        `OPC-UA node ${nodeId} was missing from the gateway response.`,
      );
    }
    return reading;
  });
}

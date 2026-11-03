/**
 * Human-approved SAP S/4HANA OData V2 write adapter.
 *
 * Allowlisted operations, named from the published API contracts:
 *
 * 1. maintenance_notification_create — POST entity set MaintenanceNotification
 *    on OData service API_MAINTNOTIFICATION. SAP Cloud SDK VDM
 *    MaintenanceNotificationService (generated from the Business Accelerator
 *    Hub API) exposes createMaintenanceNotification for that service.
 *    https://javadoc.io/static/com.sap.cloud.sdk.s4hana/s4hana-api-odata/4.30.0/com/sap/cloud/sdk/s4hana/datamodel/odata/services/MaintenanceNotificationService.html
 *
 * 2. maintenance_notification_text_update — PATCH the same entity set.
 *    The same service exposes updateMaintenanceNotification. The key is the
 *    notification number; the only mutable field sent is NotificationText.
 *
 * 3. maintenance_order_release — POST function import ReleaseMaintenanceOrder
 *    on API_MAINTENANCEORDER. SAP Cloud SDK lists ReleaseMaintenanceOrderFluentHelper
 *    for that service. SAP KBA 3614398 documents the sibling status imports on
 *    the same service as POST
 *    /sap/opu/odata/SAP/API_MAINTENANCEORDER;v=2/<Import>?MaintenanceOrder=''
 *    https://javadoc.io/static/com.sap.cloud.sdk.s4hana/s4hana-api-odata/3.73.0/com/sap/cloud/sdk/s4hana/datamodel/odata/namespaces/maintenanceorder/package-summary.html
 *    https://userapps.support.sap.com/sap/support/knowledge/en/3614398
 *
 * CSRF: SAP Gateway requires a preceding GET with header `X-CSRF-Token: Fetch`,
 * then that token and the session cookie on the mutating request. The CSRF GET
 * is still a call to SAP and runs only after the request is approved.
 *
 * Approval roles are the human set in public.app_role_has_approval_authority
 * (supabase/migrations/00000000000022_approval_authority_contract.sql) and in
 * supabase/functions/autonomous-orchestrator/index.ts. The orchestrator's
 * internal service-role bypass is not reused: a SAP write stays human-approved.
 * The requester cannot approve, reject, or execute their own request.
 */

export const SAP_WRITE_APPROVAL_ROLES = [
  "admin",
  "manager",
  "maintenance_manager",
  "plant_manager",
  "operations_manager",
  "reliability_engineer",
] as const;

export type SapWriteApprovalRole = (typeof SAP_WRITE_APPROVAL_ROLES)[number];

export const SAP_WRITE_OPERATIONS = {
  maintenance_notification_create: {
    service: "API_MAINTNOTIFICATION",
    entity: "MaintenanceNotification",
    method: "POST",
  },
  maintenance_notification_text_update: {
    service: "API_MAINTNOTIFICATION",
    entity: "MaintenanceNotification",
    method: "PATCH",
  },
  maintenance_order_release: {
    service: "API_MAINTENANCEORDER",
    entity: "ReleaseMaintenanceOrder",
    method: "POST",
  },
} as const;

export type SapWriteOperation = keyof typeof SAP_WRITE_OPERATIONS;

export interface SapWriteExecutionClaim {
  callSap: boolean;
  requestId: string;
  statusAtClaim: string;
  tenantWriteEnabled: boolean;
  connectorWriteEnabled: boolean;
  operation: string;
  serviceRoot: string;
  payloadJson: string;
  payloadSha256: string;
  idempotencyKey: string;
  error?: string;
  idempotentReplay?: boolean;
  sapHttpStatus?: number | null;
}

export interface SapWriteCompletion {
  requestId: string;
  httpStatus: number | null;
  error: string | null;
  succeeded: boolean;
  payloadSha256: string;
  mutatingCalls: number;
}

export type SapFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface SapWriteExecutionResult {
  sapCalled: boolean;
  httpCalls: number;
  mutatingCalls: number;
  idempotentReplay: boolean;
  error: string | null;
  httpStatus: number | null;
  payloadSha256: string;
  completion: SapWriteCompletion | null;
}

const NOTIFICATION_SERVICE = /\/API_MAINTNOTIFICATION\/?$/;
const ORDER_SERVICE = /\/API_MAINTENANCEORDER(?:;v=(?:2|0002))?\/?$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textField(
  payload: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  label: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is outside the published field bound.`);
  }
  return value;
}

function isShortText(value: string): boolean {
  if (value.length < 1 || value.length > 40) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function optionalText(
  payload: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  label: string,
): void {
  if (payload[key] === undefined) return;
  textField(payload, key, pattern, label);
}

function assertKeys(
  payload: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) {
      throw new Error(`SAP write payload field ${key} is not allowlisted.`);
    }
  }
}

/** Structural field bounds taken from the published short header, not operating limits. */
export function assertAllowlistedPayload(
  operation: SapWriteOperation,
  payload: Record<string, unknown>,
): void {
  if (operation === "maintenance_notification_create") {
    assertKeys(payload, [
      "NotificationType",
      "NotificationText",
      "ReportedByUser",
    ]);
    textField(payload, "NotificationType", /^[A-Za-z0-9]{1,4}$/, "NotificationType");
    if (
      typeof payload.NotificationText !== "string" ||
      !isShortText(payload.NotificationText)
    ) {
      throw new Error("NotificationText is outside the published field bound.");
    }
    optionalText(
      payload,
      "ReportedByUser",
      /^[A-Za-z0-9._-]{1,12}$/,
      "ReportedByUser",
    );
    return;
  }
  if (operation === "maintenance_notification_text_update") {
    assertKeys(payload, ["MaintenanceNotification", "NotificationText"]);
    textField(
      payload,
      "MaintenanceNotification",
      /^[A-Za-z0-9]{1,12}$/,
      "MaintenanceNotification",
    );
    if (
      typeof payload.NotificationText !== "string" ||
      !isShortText(payload.NotificationText)
    ) {
      throw new Error("NotificationText is outside the published field bound.");
    }
    return;
  }
  assertKeys(payload, ["MaintenanceOrder"]);
  textField(payload, "MaintenanceOrder", /^[A-Za-z0-9]{1,12}$/, "MaintenanceOrder");
}

export function isSapWriteOperation(value: string): value is SapWriteOperation {
  return Object.prototype.hasOwnProperty.call(SAP_WRITE_OPERATIONS, value);
}

export function serviceRootMatchesOperation(
  serviceRoot: string,
  operation: SapWriteOperation,
): boolean {
  const path = serviceRootPath(serviceRoot);
  if (SAP_WRITE_OPERATIONS[operation].service === "API_MAINTNOTIFICATION") {
    return NOTIFICATION_SERVICE.test(path);
  }
  return ORDER_SERVICE.test(path);
}

function serviceRootPath(serviceRoot: string): string {
  return new URL(serviceRoot).pathname.replace(/\/$/, "");
}

export function assertPublicHttpsServiceRoot(
  serviceRoot: string,
  allowedHosts: readonly string[],
): URL {
  const url = new URL(serviceRoot);
  const host = url.hostname.toLowerCase();
  const privateIpv4 =
    /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      host,
    );
  const path = url.pathname.replace(/\/$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.startsWith("[") ||
    privateIpv4 ||
    (!NOTIFICATION_SERVICE.test(path) && !ORDER_SERVICE.test(path))
  ) {
    throw new Error(
      "SAP write service root must be a credential-free public HTTPS API_MAINTNOTIFICATION or API_MAINTENANCEORDER URL.",
    );
  }
  if (!allowedHosts.length || !allowedHosts.includes(host)) {
    throw new Error("Configured SAP host is not in the deployment allowlist.");
  }
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function decideSapWrite(input: {
  role: string | null | undefined;
  requesterId: string;
  approverId: string;
  currentStatus: string;
  decision: string;
}):
  | { ok: true; status: "approved" | "rejected" }
  | { ok: false; error: string } {
  const role = String(input.role ?? "").toLowerCase();
  if (
    role === "ai_admin" ||
    !SAP_WRITE_APPROVAL_ROLES.includes(role as SapWriteApprovalRole)
  ) {
    return { ok: false, error: "approval_authority_required" };
  }
  if (!input.approverId || input.approverId === input.requesterId) {
    return {
      ok: false,
      error: "the requester cannot approve their own SAP write",
    };
  }
  if (input.currentStatus !== "pending") {
    return { ok: false, error: "request_not_pending" };
  }
  if (input.decision !== "approved" && input.decision !== "rejected") {
    return { ok: false, error: "decision_not_allowed" };
  }
  return { ok: true, status: input.decision };
}

export function normalizeSapWriteExecuteRequest(value: unknown): {
  requestId: string;
} {
  if (!isRecord(value)) {
    throw new Error("SAP write execution request must be a JSON object.");
  }
  const requestId = value.request_id;
  if (typeof requestId !== "string" || !UUID.test(requestId)) {
    throw new Error("request_id must be a UUID.");
  }
  if (Object.keys(value).some((key) => key !== "request_id")) {
    throw new Error("SAP write execution accepts only request_id.");
  }
  return { requestId };
}

export function readSapWriteClaim(value: unknown): SapWriteExecutionClaim {
  if (!isRecord(value)) {
    throw new Error("SAP write claim must be a JSON object.");
  }
  const callSap = value.call_sap === true;
  const requestId = typeof value.request_id === "string" ? value.request_id : "";
  if (!callSap) {
    return {
      callSap: false,
      requestId,
      statusAtClaim: typeof value.status === "string" ? value.status : "",
      tenantWriteEnabled: value.tenant_write_enabled === true,
      connectorWriteEnabled: value.connector_write_enabled === true,
      operation: typeof value.operation === "string" ? value.operation : "",
      serviceRoot: "",
      payloadJson: "",
      payloadSha256:
        typeof value.payload_sha256 === "string" ? value.payload_sha256 : "",
      idempotencyKey: "",
      error: typeof value.error === "string" ? value.error : undefined,
      idempotentReplay: value.idempotent_replay === true,
      sapHttpStatus:
        typeof value.sap_http_status === "number" ? value.sap_http_status : null,
    };
  }
  const operation = typeof value.operation === "string" ? value.operation : "";
  const serviceRoot = typeof value.service_root === "string" ? value.service_root : "";
  const payloadJson = typeof value.payload_json === "string" ? value.payload_json : "";
  const payloadSha256 =
    typeof value.payload_sha256 === "string" ? value.payload_sha256 : "";
  const idempotencyKey =
    typeof value.idempotency_key === "string" ? value.idempotency_key : "";
  const ready =
    isSapWriteOperation(operation) &&
    value.status_at_claim === "approved" &&
    value.tenant_write_enabled === true &&
    value.connector_write_enabled === true &&
    serviceRoot.length > 0 &&
    payloadJson.length > 0 &&
    /^[0-9a-f]{64}$/.test(payloadSha256) &&
    idempotencyKey.length > 0 &&
    UUID.test(requestId);
  if (!ready) {
    return {
      callSap: false,
      requestId,
      statusAtClaim:
        typeof value.status_at_claim === "string" ? value.status_at_claim : "",
      tenantWriteEnabled: value.tenant_write_enabled === true,
      connectorWriteEnabled: value.connector_write_enabled === true,
      operation,
      serviceRoot,
      payloadJson,
      payloadSha256,
      idempotencyKey,
      error:
        value.status_at_claim === "approved"
          ? "sap_write_claim_incomplete"
          : "request_not_approved",
    };
  }
  return {
    callSap: true,
    requestId,
    statusAtClaim: "approved",
    tenantWriteEnabled: true,
    connectorWriteEnabled: true,
    operation,
    serviceRoot,
    payloadJson,
    payloadSha256,
    idempotencyKey,
  };
}

function odataKey(value: string): string {
  return value.replaceAll("'", "''");
}

export function sapWriteTarget(
  serviceRoot: string,
  operation: SapWriteOperation,
  payload: Record<string, unknown>,
  allowedHosts: readonly string[],
): { url: URL; method: "POST" | "PATCH"; body: string | null } {
  const root = assertPublicHttpsServiceRoot(serviceRoot, allowedHosts);
  if (!serviceRootMatchesOperation(root.href, operation)) {
    throw new Error("SAP write operation does not match the connector service.");
  }
  assertAllowlistedPayload(operation, payload);
  if (operation === "maintenance_notification_create") {
    const url = new URL(root.href);
    url.pathname = `${root.pathname}/MaintenanceNotification`;
    return { url, method: "POST", body: null };
  }
  if (operation === "maintenance_notification_text_update") {
    const url = new URL(root.href);
    const key = odataKey(String(payload.MaintenanceNotification));
    url.pathname = `${root.pathname}/MaintenanceNotification('${key}')`;
    return {
      url,
      method: "PATCH",
      body: JSON.stringify({ NotificationText: payload.NotificationText }),
    };
  }
  const url = new URL(root.href);
  url.pathname = `${root.pathname}/ReleaseMaintenanceOrder`;
  url.search = `?MaintenanceOrder='${odataKey(String(payload.MaintenanceOrder))}'`;
  return { url, method: "POST", body: null };
}

function headerValue(headers: Headers, name: string): string {
  return headers.get(name)?.trim() ?? "";
}

function sessionCookie(headers: Headers): string {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  const listed = withGetter.getSetCookie?.() ?? [];
  const raw = listed.length > 0 ? listed : [headers.get("set-cookie") ?? ""];
  const pairs = raw
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((cookie) => cookie.includes("="));
  if (pairs.length === 0) {
    throw new Error("SAP CSRF response did not return a session cookie.");
  }
  return pairs.join("; ");
}

function sapErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  const message = payload.error.message;
  const text = isRecord(message)
    ? message.value
    : typeof message === "string"
      ? message
      : payload.error.code;
  if (typeof text !== "string" || !text.trim()) return "SAP returned an OData error.";
  return text.replace(/\s+/g, " ").slice(0, 500);
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("SAP write response exceeds its byte limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("SAP write response exceeds its byte limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function refused(
  error: string,
  payloadSha256 = "",
  requestId = "",
): SapWriteExecutionResult {
  return {
    sapCalled: false,
    httpCalls: 0,
    mutatingCalls: 0,
    idempotentReplay: false,
    error,
    httpStatus: null,
    payloadSha256,
    completion: requestId
      ? {
          requestId,
          httpStatus: null,
          error,
          succeeded: false,
          payloadSha256,
          mutatingCalls: 0,
        }
      : null,
  };
}

export async function executeApprovedSapWrite(args: {
  claim: SapWriteExecutionClaim;
  fetchImpl: SapFetch;
  accessToken: string;
  allowedHosts: readonly string[];
}): Promise<SapWriteExecutionResult> {
  const { claim } = args;
  if (!claim.callSap || claim.statusAtClaim !== "approved") {
    return refused(
      claim.error ?? "request_not_approved",
      claim.payloadSha256,
    );
  }
  if (!claim.tenantWriteEnabled || !claim.connectorWriteEnabled) {
    return refused("sap_writes_disabled", claim.payloadSha256, claim.requestId);
  }
  if (!isSapWriteOperation(claim.operation)) {
    return refused("operation_not_allowlisted", claim.payloadSha256, claim.requestId);
  }
  if (
    args.accessToken.length < 32 ||
    /[\r\n]/.test(args.accessToken) ||
    claim.payloadJson.length === 0 ||
    claim.payloadJson.length > 4000
  ) {
    return refused("sap_write_credential_or_payload_invalid", claim.payloadSha256, claim.requestId);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(claim.payloadJson);
    if (!isRecord(parsed)) throw new Error("payload");
    payload = parsed;
    assertAllowlistedPayload(claim.operation, payload);
    if ((await sha256Hex(claim.payloadJson)) !== claim.payloadSha256) {
      throw new Error("hash");
    }
  } catch (error) {
    const reason =
      error instanceof Error && error.message === "hash"
        ? "payload_hash_mismatch"
        : "payload_not_allowlisted";
    return refused(reason, claim.payloadSha256, claim.requestId);
  }

  let target: { url: URL; method: "POST" | "PATCH"; body: string | null };
  try {
    target = sapWriteTarget(
      claim.serviceRoot,
      claim.operation,
      payload,
      args.allowedHosts,
    );
    if (claim.operation === "maintenance_notification_create") {
      target = { ...target, body: claim.payloadJson };
    }
  } catch (error) {
    return refused(
      error instanceof Error ? error.message : "sap_target_refused",
      claim.payloadSha256,
      claim.requestId,
    );
  }

  const auth = { Authorization: `Bearer ${args.accessToken}` };
  const csrfUrl = assertPublicHttpsServiceRoot(
    claim.serviceRoot,
    args.allowedHosts,
  );
  let csrf: string;
  let cookie: string;
  try {
    const csrfResponse = await args.fetchImpl(csrfUrl, {
      method: "GET",
      headers: {
        ...auth,
        Accept: "application/json",
        "X-CSRF-Token": "Fetch",
        DataServiceVersion: "2.0",
      },
      redirect: "error",
    });
    csrf = headerValue(csrfResponse.headers, "x-csrf-token");
    if (!csrfResponse.ok || !csrf || csrf.toLowerCase() === "fetch") {
      return {
        sapCalled: false,
        httpCalls: 1,
        mutatingCalls: 0,
        idempotentReplay: false,
        error: "sap_csrf_fetch_failed",
        httpStatus: csrfResponse.status,
        payloadSha256: claim.payloadSha256,
        completion: {
          requestId: claim.requestId,
          httpStatus: csrfResponse.status,
          error: "sap_csrf_fetch_failed",
          succeeded: false,
          payloadSha256: claim.payloadSha256,
          mutatingCalls: 0,
        },
      };
    }
    cookie = sessionCookie(csrfResponse.headers);
  } catch (error) {
    return {
      sapCalled: false,
      httpCalls: 1,
      mutatingCalls: 0,
      idempotentReplay: false,
      error: error instanceof Error ? error.message : "sap_csrf_fetch_failed",
      httpStatus: null,
      payloadSha256: claim.payloadSha256,
      completion: {
        requestId: claim.requestId,
        httpStatus: null,
        error: "sap_csrf_fetch_failed",
        succeeded: false,
        payloadSha256: claim.payloadSha256,
        mutatingCalls: 0,
      },
    };
  }

  try {
    const headers: Record<string, string> = {
      ...auth,
      Accept: "application/json",
      "X-CSRF-Token": csrf,
      Cookie: cookie,
      DataServiceVersion: "2.0",
    };
    if (target.body !== null) headers["Content-Type"] = "application/json";
    if (target.method === "PATCH") headers["If-Match"] = "*";
    const response = await args.fetchImpl(target.url, {
      method: target.method,
      headers,
      body: target.body ?? undefined,
      redirect: "error",
    });
    const raw = await readBoundedText(response, 1024 * 1024);
    let parsed: unknown = null;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const odataError = sapErrorMessage(parsed);
    const succeeded = response.ok && !odataError;
    const error = succeeded
      ? null
      : odataError ??
        `SAP write returned HTTP ${response.status}.`;
    return {
      sapCalled: true,
      httpCalls: 2,
      mutatingCalls: 1,
      idempotentReplay: false,
      error,
      httpStatus: response.status,
      payloadSha256: claim.payloadSha256,
      completion: {
        requestId: claim.requestId,
        httpStatus: response.status,
        error,
        succeeded,
        payloadSha256: claim.payloadSha256,
        mutatingCalls: 1,
      },
    };
  } catch (error) {
    return {
      sapCalled: true,
      httpCalls: 2,
      mutatingCalls: 1,
      idempotentReplay: false,
      error: error instanceof Error ? error.message : "sap_write_failed",
      httpStatus: null,
      payloadSha256: claim.payloadSha256,
      completion: {
        requestId: claim.requestId,
        httpStatus: null,
        error: "sap_write_failed_after_request",
        succeeded: false,
        payloadSha256: claim.payloadSha256,
        mutatingCalls: 1,
      },
    };
  }
}

export async function runSapWriteExecution(args: {
  claim: () => Promise<unknown>;
  complete: (result: SapWriteCompletion) => Promise<void>;
  fetchImpl: SapFetch;
  accessToken: string;
  allowedHosts: readonly string[];
}): Promise<SapWriteExecutionResult> {
  const raw = await args.claim();
  const claimedCall = isRecord(raw) && raw.call_sap === true;
  const claim = readSapWriteClaim(raw);
  if (!claim.callSap) {
    if (claimedCall && claim.requestId) {
      await args.complete({
        requestId: claim.requestId,
        httpStatus: null,
        error: claim.error ?? "request_not_approved",
        succeeded: false,
        payloadSha256: claim.payloadSha256,
        mutatingCalls: 0,
      });
    }
    return {
      sapCalled: false,
      httpCalls: 0,
      mutatingCalls: 0,
      idempotentReplay: claim.idempotentReplay === true,
      error: claim.error ?? null,
      httpStatus: claim.sapHttpStatus ?? null,
      payloadSha256: claim.payloadSha256,
      completion: null,
    };
  }
  const result = await executeApprovedSapWrite({
    claim,
    fetchImpl: args.fetchImpl,
    accessToken: args.accessToken,
    allowedHosts: args.allowedHosts,
  });
  if (result.completion) await args.complete(result.completion);
  return result;
}

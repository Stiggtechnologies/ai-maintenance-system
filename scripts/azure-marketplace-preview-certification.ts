import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  evaluateMarketplacePreviewCertification,
  type MarketplaceCertificationInput,
} from "../src/lib/azure-marketplace-certification.ts";
import {
  buildMeteringBatchRequest,
  marketplaceMeteringBatchUrl,
  normalizeMeteringBatchResponse,
  type ClaimedMeteringEvent,
  type NormalizedMeteringResult,
} from "../supabase/functions/marketplace-metering/core.ts";

const MAX_RESPONSE_BYTES = 128 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function positiveNumber(name: string, allowZero = false): number {
  const value = Number(required(name));
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("marketplace_response_too_large");
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("marketplace_response_invalid_json");
  }
}

function supabaseHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
  };
}

async function selectRows(
  baseUrl: string,
  serviceKey: string,
  table: string,
  query: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${baseUrl}/rest/v1/${table}?${query}`, {
    headers: supabaseHeaders(serviceKey),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await boundedJson(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new Error(`canonical_read_failed_${table}_${response.status}`);
  }
  return body.filter((item): item is Record<string, unknown> =>
    Boolean(record(item)),
  );
}

async function callRpc(
  baseUrl: string,
  serviceKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(serviceKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  const body = record(await boundedJson(response));
  if (!response.ok || !body) {
    throw new Error(`canonical_rpc_failed_${name}_${response.status}`);
  }
  return body;
}

async function publisherToken(config: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://marketplaceapi.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = record(await boundedJson(response));
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (!response.ok || token.length < 32) {
    throw new Error(`publisher_auth_failed_${response.status}`);
  }
  return token;
}

async function microsoftSubscription(
  subscriptionId: string,
  token: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://marketplaceapi.microsoft.com/api/saas/subscriptions/${encodeURIComponent(subscriptionId)}?api-version=2018-08-31`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const body = record(await boundedJson(response));
  if (!response.ok || !body) {
    throw new Error(`marketplace_subscription_read_failed_${response.status}`);
  }
  return body;
}

async function submitMeteringWitness(
  event: ClaimedMeteringEvent,
  token: string,
): Promise<NormalizedMeteringResult> {
  const claim = { claimToken: randomUUID(), events: [event] };
  const response = await fetch(marketplaceMeteringBatchUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-ms-requestid": randomUUID(),
      "x-ms-correlationid": randomUUID(),
    },
    body: JSON.stringify(buildMeteringBatchRequest(claim)),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await boundedJson(response);
  if (!response.ok) {
    throw new Error(`marketplace_metering_witness_failed_${response.status}`);
  }
  const normalized = normalizeMeteringBatchResponse(body, claim);
  if (!normalized || normalized.length !== 1) {
    throw new Error("marketplace_metering_witness_invalid_response");
  }
  return normalized[0];
}

function first(
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  return rows[0] ?? null;
}

function exactHourIso(value: unknown): string {
  if (typeof value !== "string") throw new Error("accepted_meter_hour_absent");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("accepted_meter_hour_invalid");
  if (date.getTime() < Date.now() - 23 * 60 * 60 * 1000) {
    throw new Error("accepted_meter_too_old_for_safe_duplicate_witness");
  }
  return date.toISOString();
}

function numeric(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`invalid_${name}`);
  return parsed;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const primarySubscriptionId = required("MARKETPLACE_PREVIEW_SUBSCRIPTION_ID");
  const unsubscribeSubscriptionId = required(
    "MARKETPLACE_PREVIEW_UNSUBSCRIBE_SUBSCRIPTION_ID",
  );
  if (
    !UUID.test(primarySubscriptionId) ||
    !UUID.test(unsubscribeSubscriptionId)
  ) {
    throw new Error("preview_subscription_ids_must_be_uuids");
  }
  const expected = {
    publisherId: required("AZURE_MARKETPLACE_PUBLISHER_ID"),
    offerId: required("AZURE_MARKETPLACE_OFFER_ID"),
    planId: required("AZURE_MARKETPLACE_METER_PLAN_ID"),
    dimension: required("AZURE_MARKETPLACE_METER_DIMENSION"),
    unitSize: positiveNumber("AZURE_MARKETPLACE_METER_UNIT_SIZE"),
    includedQuantity: positiveNumber(
      "AZURE_MARKETPLACE_METER_INCLUDED_QUANTITY",
      true,
    ),
    quantityScale: positiveNumber(
      "AZURE_MARKETPLACE_METER_QUANTITY_SCALE",
      true,
    ),
  };
  if (!Number.isInteger(expected.quantityScale) || expected.quantityScale > 6) {
    throw new Error("invalid_azure_marketplace_meter_quantity_scale");
  }
  const publisher = {
    clientId: required("AZURE_MARKETPLACE_CLIENT_ID"),
    clientSecret: required("AZURE_MARKETPLACE_CLIENT_SECRET"),
    tenantId: required("AZURE_MARKETPLACE_TENANT_ID"),
  };
  const escapedPrimary = encodeURIComponent(`eq.${primarySubscriptionId}`);
  const escapedTerminal = encodeURIComponent(`eq.${unsubscribeSubscriptionId}`);
  const billingSelect =
    "select=id,organization_id,billing_source,marketplace_subscription_id,marketplace_publisher_id,marketplace_offer_id,marketplace_plan_id,marketplace_quantity,marketplace_status,status,marketplace_activated_at,updated_at";
  const resolutionSelect =
    "select=id,marketplace_subscription_id,publisher_id,offer_id,plan_id,marketplace_status,internal_status,organization_id,billing_subscription_id,activated_at,term_start,term_end,updated_at";
  const operationSelect =
    "select=id,marketplace_subscription_id,microsoft_operation_id,action,microsoft_status,processing_state,requested_plan_id,requested_quantity,request_id,correlation_id,received_at,completed_at";
  const [
    primaryBillingRows,
    primaryResolutionRows,
    primaryOperations,
    terminalBillingRows,
    terminalResolutionRows,
    terminalOperations,
    meteringRows,
  ] = await Promise.all([
    selectRows(
      supabaseUrl,
      serviceKey,
      "billing_subscriptions",
      `${billingSelect}&marketplace_subscription_id=${escapedPrimary}&limit=1`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "marketplace_fulfillment_resolutions",
      `${resolutionSelect}&marketplace_subscription_id=${escapedPrimary}&limit=1`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "marketplace_fulfillment_operations",
      `${operationSelect}&marketplace_subscription_id=${escapedPrimary}&order=received_at.asc`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "billing_subscriptions",
      `${billingSelect}&marketplace_subscription_id=${escapedTerminal}&limit=1`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "marketplace_fulfillment_resolutions",
      `${resolutionSelect}&marketplace_subscription_id=${escapedTerminal}&limit=1`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "marketplace_fulfillment_operations",
      `${operationSelect}&marketplace_subscription_id=${escapedTerminal}&order=received_at.asc`,
    ),
    selectRows(
      supabaseUrl,
      serviceKey,
      "marketplace_hourly_metering_events",
      `select=*&marketplace_subscription_id=${escapedPrimary}&status=eq.accepted&order=usage_hour.desc&limit=1`,
    ),
  ]);
  const primaryBilling = first(primaryBillingRows);
  const acceptedMeteringEvent = first(meteringRows);
  const organizationId = primaryBilling?.organization_id;
  const audits =
    typeof organizationId === "string" && UUID.test(organizationId)
      ? await selectRows(
          supabaseUrl,
          serviceKey,
          "audit_events",
          `select=id,entity_type,event_data,created_at&organization_id=${encodeURIComponent(`eq.${organizationId}`)}&entity_type=in.(azure_marketplace_subscription,azure_marketplace_metering)&order=created_at.asc`,
        )
      : [];
  if (!acceptedMeteringEvent)
    throw new Error("accepted_metering_event_required");
  const token = await publisherToken(publisher);
  const marketplacePrimary = await microsoftSubscription(
    primarySubscriptionId,
    token,
  );
  const duplicateEvent: ClaimedMeteringEvent = {
    recordId: randomUUID(),
    resourceId: primarySubscriptionId,
    dimension: expected.dimension,
    quantity: numeric(
      acceptedMeteringEvent.quantity,
      "accepted_meter_quantity",
    ),
    effectiveStartTime: exactHourIso(acceptedMeteringEvent.usage_hour),
    planId: expected.planId,
  };
  const duplicateResult = await submitMeteringWitness(duplicateEvent, token);
  if (
    duplicateResult.status !== "Duplicate" ||
    !duplicateResult.exactDuplicate
  ) {
    throw new Error("microsoft_exact_duplicate_not_witnessed");
  }
  const currentHour = new Date();
  currentHour.setUTCMinutes(0, 0, 0);
  const rejectedResult = await submitMeteringWitness(
    {
      recordId: randomUUID(),
      resourceId: randomUUID(),
      dimension: expected.dimension,
      quantity: 1,
      effectiveStartTime: currentHour.toISOString(),
      planId: expected.planId,
    },
    token,
  );
  if (
    rejectedResult.status === "Accepted" ||
    rejectedResult.status === "Duplicate"
  ) {
    throw new Error("synthetic_non_billable_rejection_not_witnessed");
  }
  const input: MarketplaceCertificationInput = {
    expected,
    primarySubscriptionId,
    unsubscribeSubscriptionId,
    primaryBilling,
    primaryResolution: first(primaryResolutionRows),
    primaryOperations,
    terminalBilling: first(terminalBillingRows),
    terminalResolution: first(terminalResolutionRows),
    terminalOperations,
    acceptedMeteringEvent,
    marketplacePrimary,
    duplicateResult,
    rejectedResult,
    auditEvents: audits,
    partnerCenterEvidence: {
      reference: required("PARTNER_CENTER_USAGE_EVIDENCE_REFERENCE"),
      sha256: required("PARTNER_CENTER_USAGE_EVIDENCE_SHA256").toLowerCase(),
      capturedAt: required("PARTNER_CENTER_USAGE_EVIDENCE_CAPTURED_AT"),
    },
    witnessedBy: required("MARKETPLACE_CERTIFICATION_WITNESS"),
    reviewedBy: required("MARKETPLACE_CERTIFICATION_REVIEWER"),
  };
  const checks = evaluateMarketplacePreviewCertification(input);
  const passed = checks.every((check) => check.passed);
  const gitSha = required("GITHUB_SHA").toLowerCase();
  const githubRunId = required("GITHUB_RUN_ID");
  const report = {
    schemaVersion: 1,
    suite: "syncai-azure-marketplace-preview-certification",
    status: passed ? "passed" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    git: {
      sha: gitSha,
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runId: githubRunId,
      actor: process.env.GITHUB_ACTOR ?? null,
    },
    scope: {
      publisherFingerprint: fingerprint(expected.publisherId),
      offerFingerprint: fingerprint(expected.offerId),
      planId: expected.planId,
      dimension: expected.dimension,
      primarySubscriptionFingerprint: fingerprint(primarySubscriptionId),
      unsubscribeSubscriptionFingerprint: fingerprint(
        unsubscribeSubscriptionId,
      ),
    },
    externalEvidence: {
      referenceFingerprint: fingerprint(input.partnerCenterEvidence.reference),
      sha256: input.partnerCenterEvidence.sha256,
      capturedAt: input.partnerCenterEvidence.capturedAt,
    },
    witnesses: {
      observedByFingerprint: fingerprint(
        input.witnessedBy.trim().toLowerCase(),
      ),
      independentlyReviewedByFingerprint: fingerprint(
        input.reviewedBy.trim().toLowerCase(),
      ),
    },
    checks,
  };
  const canonical = JSON.stringify(report, null, 2);
  const reportSha256 = createHash("sha256").update(canonical).digest("hex");
  const witnessFingerprint = fingerprint(
    input.witnessedBy.trim().toLowerCase(),
  );
  const reviewerFingerprint = fingerprint(
    input.reviewedBy.trim().toLowerCase(),
  );
  const externalReferenceFingerprint = fingerprint(
    input.partnerCenterEvidence.reference,
  );
  const auditReceipt = passed
    ? await callRpc(
        supabaseUrl,
        serviceKey,
        "record_marketplace_preview_certification",
        {
          p_primary_subscription_id: primarySubscriptionId,
          p_unsubscribe_subscription_id: unsubscribeSubscriptionId,
          p_report_sha256: reportSha256,
          p_external_evidence_sha256: input.partnerCenterEvidence.sha256,
          p_external_reference_fingerprint: externalReferenceFingerprint,
          p_witness_fingerprint: witnessFingerprint,
          p_reviewer_fingerprint: reviewerFingerprint,
          p_git_sha: gitSha,
          p_github_run_id: githubRunId,
          p_evidence_captured_at: input.partnerCenterEvidence.capturedAt,
          p_checks: checks,
        },
      )
    : null;
  const envelope = {
    ...report,
    reportSha256,
    auditReceipt,
  };
  const output = resolve(
    process.env.MARKETPLACE_CERTIFICATION_OUTPUT ??
      "artifacts/azure-marketplace-preview-certification.json",
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  console.log(
    `Azure Marketplace preview certification ${envelope.status}: ${checks.filter((check) => check.passed).length}/${checks.length} checks; report=${output}; sha256=${envelope.reportSha256}`,
  );
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    `Azure Marketplace preview certification failed: ${error instanceof Error ? error.message : "unknown_error"}`,
  );
  process.exitCode = 1;
});

import type { RiskUncertaintySubmission } from "./riskOperatingService";

export const RISK_UNCERTAINTY_REPLACEMENT_PREPARATION_ERROR =
  "Could not prepare a valid uncertainty replacement request";

/**
 * Exact UTF-8 request boundary for this client/source contract and the future
 * SQL octet-length guard. This is a resource bound, not a financial,
 * engineering, evidence-quality or authorization limit.
 */
export const RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES = 1024 * 1024;

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export interface RiskUncertaintyReplacementRequestInput {
  intentId: string;
  organizationId: string;
  actorId: string;
  riskId: string;
  predecessor: {
    analysisId: string;
    version: number;
    digestVersion: 1 | 2;
    analysisDigest: string;
    currentDigest: string;
  };
  policyDigest: string;
  reason: string;
  analysis: RiskUncertaintySubmission;
  evidenceItemIds: string[];
}

export interface PreparedRiskUncertaintyReplacementRequest {
  readonly requestText: string;
  readonly requestFingerprint: string;
  readonly intentId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly riskId: string;
  readonly predecessor: DeepReadonly<
    RiskUncertaintyReplacementRequestInput["predecessor"]
  >;
  readonly policyDigest: string;
  readonly reason: string;
  readonly analysis: DeepReadonly<RiskUncertaintySubmission>;
  readonly evidenceItemIds: readonly string[];
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/;

function refuse(): never {
  throw new Error(RISK_UNCERTAINTY_REPLACEMENT_PREPARATION_ERROR);
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    refuse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse();
  return value as Record<string, unknown>;
}

function dataField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) refuse();
  return descriptor.value;
}

function arrayValues(value: unknown, minimum: number, maximum: number) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    refuse();
  const length = value.length;
  if (!Number.isInteger(length) || length < minimum || length > maximum)
    refuse();
  const captured: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) refuse();
    captured.push(descriptor.value);
  }
  return captured;
}

function safeString(value: unknown): string {
  if (typeof value !== "string" || value.includes("\u0000")) refuse();
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) refuse();
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      refuse();
    }
  }
  return value;
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum?: number,
): string {
  const text = safeString(value);
  const length = Array.from(text.replace(/^ +| +$/g, "")).length;
  if (length < minimum || (maximum !== undefined && length > maximum)) refuse();
  return text;
}

function canonicalUuid(value: unknown): string {
  const text = safeString(value);
  if (!uuidPattern.test(text)) refuse();
  return text.toLowerCase();
}

function digest(value: unknown): string {
  const text = safeString(value);
  if (!digestPattern.test(text)) refuse();
  return text;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) refuse();
  return Object.is(value, -0) ? 0 : value;
}

function futureTimestamp(value: unknown, observedNow: number): string {
  const text = safeString(value);
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:(?:0\d|1[0-4]):[0-5]\d|15:[0-5]\d))$/.exec(
      text,
    );
  if (!parts) refuse();
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) refuse();
  const instant = Date.parse(text);
  if (!Number.isFinite(instant) || instant <= observedNow) refuse();
  return text;
}

function pgVersion(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    refuse();
  return value;
}

function captureSensitivity(value: unknown) {
  return arrayValues(value, 1, 20).map((candidate) => {
    const record = plainRecord(candidate);
    const lowInput = finite(dataField(record, "low_input"));
    const baseInput = finite(dataField(record, "base_input"));
    const highInput = finite(dataField(record, "high_input"));
    const lowOutput = finite(dataField(record, "low_output"));
    const baseOutput = finite(dataField(record, "base_output"));
    const highOutput = finite(dataField(record, "high_output"));
    if (
      lowInput > baseInput ||
      baseInput > highInput ||
      lowOutput < 0 ||
      baseOutput < 0 ||
      highOutput < 0
    )
      refuse();
    return {
      name: boundedText(dataField(record, "name"), 2),
      basis: boundedText(dataField(record, "basis"), 20),
      low_input: lowInput,
      base_input: baseInput,
      high_input: highInput,
      low_output: lowOutput,
      base_output: baseOutput,
      high_output: highOutput,
    };
  });
}

function captureAnalysis(
  value: unknown,
  observedNow: number,
): RiskUncertaintySubmission {
  const record = plainRecord(value);
  const probabilityLower = finite(dataField(record, "probability_lower"));
  const probabilityCentral = finite(dataField(record, "probability_central"));
  const probabilityUpper = finite(dataField(record, "probability_upper"));
  const confidenceLevel = finite(dataField(record, "confidence_level"));
  const confidenceLower = finite(
    dataField(record, "confidence_interval_lower"),
  );
  const confidenceUpper = finite(
    dataField(record, "confidence_interval_upper"),
  );
  const bestLoss = finite(dataField(record, "best_case_loss"));
  const expectedLoss = finite(dataField(record, "expected_case_loss"));
  const worstLoss = finite(dataField(record, "worst_case_loss"));
  const informationCost = finite(dataField(record, "voi_information_cost"));
  const wrongCost = finite(dataField(record, "voi_decision_cost_if_wrong"));
  const uncertaintyReduction = finite(
    dataField(record, "voi_uncertainty_reduction"),
  );
  const decisionChangeProbability = finite(
    dataField(record, "voi_probability_decision_changes"),
  );
  if (
    probabilityLower < 0 ||
    probabilityUpper > 1 ||
    probabilityLower > probabilityCentral ||
    probabilityCentral > probabilityUpper ||
    confidenceLevel <= 0 ||
    confidenceLevel > 1 ||
    confidenceLower < 0 ||
    confidenceUpper > 1 ||
    confidenceLower > confidenceUpper ||
    bestLoss < 0 ||
    bestLoss > expectedLoss ||
    expectedLoss > worstLoss ||
    informationCost < 0 ||
    wrongCost < 0 ||
    uncertaintyReduction < 0 ||
    uncertaintyReduction > 1 ||
    decisionChangeProbability < 0 ||
    decisionChangeProbability > 1
  )
    refuse();

  const currency = safeString(dataField(record, "currency"));
  if (!/^[A-Z]{3}$/.test(currency)) refuse();
  const reviewDueAt = futureTimestamp(
    dataField(record, "review_due_at"),
    observedNow,
  );
  const reassessmentTriggers = arrayValues(
    dataField(record, "reassessment_triggers"),
    1,
    20,
  ).map((trigger) => boundedText(trigger, 10, 500));

  return {
    method: boundedText(dataField(record, "method"), 3),
    basis: boundedText(dataField(record, "basis"), 20),
    probability_lower: probabilityLower,
    probability_central: probabilityCentral,
    probability_upper: probabilityUpper,
    confidence_level: confidenceLevel,
    confidence_interval_lower: confidenceLower,
    confidence_interval_upper: confidenceUpper,
    best_case_loss: bestLoss,
    expected_case_loss: expectedLoss,
    worst_case_loss: worstLoss,
    currency,
    sensitivity: captureSensitivity(dataField(record, "sensitivity")),
    reassessment_triggers: reassessmentTriggers,
    review_due_at: reviewDueAt,
    voi_action: boundedText(dataField(record, "voi_action"), 10),
    voi_information_cost: informationCost,
    voi_decision_cost_if_wrong: wrongCost,
    voi_uncertainty_reduction: uncertaintyReduction,
    voi_probability_decision_changes: decisionChangeProbability,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function capture(input: unknown) {
  const record = plainRecord(input);
  const predecessorRecord = plainRecord(dataField(record, "predecessor"));
  const digestVersionValue = dataField(predecessorRecord, "digestVersion");
  if (digestVersionValue !== 1 && digestVersionValue !== 2) refuse();
  const digestVersion: 1 | 2 = digestVersionValue;
  const evidenceItemIds = [
    ...new Set(
      arrayValues(dataField(record, "evidenceItemIds"), 1, 20).map(
        canonicalUuid,
      ),
    ),
  ].sort();
  if (evidenceItemIds.length < 1 || evidenceItemIds.length > 20) refuse();

  return deepFreeze({
    intentId: canonicalUuid(dataField(record, "intentId")),
    organizationId: canonicalUuid(dataField(record, "organizationId")),
    actorId: canonicalUuid(dataField(record, "actorId")),
    riskId: canonicalUuid(dataField(record, "riskId")),
    predecessor: {
      analysisId: canonicalUuid(dataField(predecessorRecord, "analysisId")),
      version: pgVersion(dataField(predecessorRecord, "version")),
      digestVersion,
      analysisDigest: digest(dataField(predecessorRecord, "analysisDigest")),
      currentDigest: digest(dataField(predecessorRecord, "currentDigest")),
    },
    policyDigest: digest(dataField(record, "policyDigest")),
    reason: boundedText(dataField(record, "reason"), 20),
    analysis: captureAnalysis(dataField(record, "analysis"), Date.now()),
    evidenceItemIds,
  });
}

function hexadecimal(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function prototypeIndependentJsonGraph(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1)
      result[index] = prototypeIndependentJsonGraph(value[index]);
    Object.setPrototypeOf(result, null);
    return result;
  }
  if (value !== null && typeof value === "object") {
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value))
      result[key] = prototypeIndependentJsonGraph(
        (value as Record<string, unknown>)[key],
      );
    return result;
  }
  return value;
}

/**
 * Prepares an immutable request and fingerprint only. It performs no RPC,
 * persistence, authorization, reconciliation, retry or operational decision.
 */
export async function prepareRiskUncertaintyReplacementRequest(
  input: RiskUncertaintyReplacementRequestInput,
): Promise<PreparedRiskUncertaintyReplacementRequest> {
  let captured: ReturnType<typeof capture>;
  let requestText: string;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    captured = capture(input);
    const payload = {
      contractVersion: 1,
      action: "replace",
      ...captured,
    };
    requestText = JSON.stringify(prototypeIndependentJsonGraph(payload));
    bytes = new TextEncoder().encode(requestText);
    if (bytes.byteLength > RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES)
      refuse();
  } catch {
    refuse();
  }

  let requestFingerprint: string;
  try {
    const fingerprintBytes = await globalThis.crypto.subtle.digest(
      "SHA-256",
      bytes,
    );
    if (fingerprintBytes.byteLength !== 32) refuse();
    requestFingerprint = hexadecimal(fingerprintBytes);
  } catch {
    refuse();
  }

  return deepFreeze({ requestText, requestFingerprint, ...captured });
}

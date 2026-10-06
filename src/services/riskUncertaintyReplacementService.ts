import { evaluateValueOfInformation } from "../lib/risk-operating-system";
import { supabase } from "../lib/supabase";
import {
  RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES,
  type PreparedRiskUncertaintyReplacementRequest,
} from "./riskUncertaintyReplacementRequest";

export interface RiskUncertaintyReplacementReceipt {
  commitStatus: "committed";
  submittedStatus: "pending_review";
  organizationId: string;
  actorId: string;
  riskId: string;
  intentId: string;
  requestFingerprint: string;
  predecessorAnalysisId: string;
  compareAndSwap: {
    analysisId: string;
    version: number;
    digestVersion: 1 | 2;
    analysisDigest: string;
    currentDigest: string;
    policyDigest: string;
  };
  analysisId: string;
  version: number;
  analysisDigest: string;
  digestVersion: 2;
  digestCoverage: "evidence_content_and_current_criteria";
  valueOfInformation: {
    informationCost: number;
    decisionCostIfWrong: number;
    uncertaintyReduction: number;
    probabilityDecisionChanges: number;
    expectedValue: number;
    netValue: number;
    recommendation: "GATHER_INFORMATION" | "DECIDE_WITH_CURRENT_INFORMATION";
  };
  operationalAuthorization: false;
}

export class RiskUncertaintyReplacementRefusedError extends Error {
  readonly refused = true;

  constructor() {
    super("Risk uncertainty replacement was refused before commit.");
    this.name = "RiskUncertaintyReplacementRefusedError";
  }
}

export class RiskUncertaintyReplacementOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true;

  constructor() {
    super(
      "Risk uncertainty replacement outcome is unknown. Reconcile the historical receipt before taking another action.",
    );
    this.name = "RiskUncertaintyReplacementOutcomeUnknownError";
  }
}

export class RiskUncertaintyReplacementUnresolvedError extends Error {
  readonly unresolved = true;
  readonly safeToResend = false;

  constructor() {
    super(
      "Risk uncertainty replacement remains unresolved. This does not make the request safe to resend.",
    );
    this.name = "RiskUncertaintyReplacementUnresolvedError";
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digestPattern = /^[0-9a-f]{64}$/;

const rootKeys = [
  "contractVersion",
  "action",
  "intentId",
  "organizationId",
  "actorId",
  "riskId",
  "predecessor",
  "policyDigest",
  "reason",
  "analysis",
  "evidenceItemIds",
] as const;
const preparedKeys = [
  "requestText",
  "requestFingerprint",
  "intentId",
  "organizationId",
  "actorId",
  "riskId",
  "predecessor",
  "policyDigest",
  "reason",
  "analysis",
  "evidenceItemIds",
] as const;
const predecessorKeys = [
  "analysisId",
  "version",
  "digestVersion",
  "analysisDigest",
  "currentDigest",
] as const;
const analysisKeys = [
  "method",
  "basis",
  "probability_lower",
  "probability_central",
  "probability_upper",
  "confidence_level",
  "confidence_interval_lower",
  "confidence_interval_upper",
  "best_case_loss",
  "expected_case_loss",
  "worst_case_loss",
  "currency",
  "sensitivity",
  "reassessment_triggers",
  "review_due_at",
  "voi_action",
  "voi_information_cost",
  "voi_decision_cost_if_wrong",
  "voi_uncertainty_reduction",
  "voi_probability_decision_changes",
] as const;
const sensitivityKeys = [
  "name",
  "basis",
  "low_input",
  "base_input",
  "high_input",
  "low_output",
  "base_output",
  "high_output",
] as const;
const receiptKeys = [
  "commitStatus",
  "submittedStatus",
  "organizationId",
  "actorId",
  "riskId",
  "intentId",
  "requestFingerprint",
  "predecessorAnalysisId",
  "compareAndSwap",
  "analysisId",
  "version",
  "analysisDigest",
  "digestVersion",
  "digestCoverage",
  "valueOfInformation",
  "operationalAuthorization",
] as const;
const receiptCompareAndSwapKeys = [
  "analysisId",
  "version",
  "digestVersion",
  "analysisDigest",
  "currentDigest",
  "policyDigest",
] as const;
const receiptVoiKeys = [
  "informationCost",
  "decisionCostIfWrong",
  "uncertaintyReduction",
  "probabilityDecisionChanges",
  "expectedValue",
  "netValue",
  "recommendation",
] as const;

function refuse(): never {
  throw new RiskUncertaintyReplacementRefusedError();
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    refuse();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) refuse();
  return value as Record<string, unknown>;
}

function dataField(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) refuse();
  return descriptor.value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key))
  )
    refuse();
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

function uuid(value: unknown): string {
  const text = safeString(value);
  if (!uuidPattern.test(text)) refuse();
  return text;
}

function digest(value: unknown): string {
  const text = safeString(value);
  if (!digestPattern.test(text)) refuse();
  return text;
}

function pgInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 2147483647
  )
    refuse();
  return value;
}

function finite(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Object.is(value, -0)
  )
    refuse();
  return value;
}

function array(value: unknown, minimum: number, maximum: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < minimum ||
    value.length > maximum
  )
    refuse();
  const captured: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) refuse();
    captured.push(descriptor.value);
  }
  return captured;
}

function historicalTimestamp(value: unknown): string {
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
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    !Number.isFinite(Date.parse(text))
  )
    refuse();
  return text;
}

function capturePredecessor(value: unknown) {
  const input = record(value);
  exactKeys(input, predecessorKeys);
  const digestVersion = dataField(input, "digestVersion");
  if (digestVersion !== 1 && digestVersion !== 2) refuse();
  return {
    analysisId: uuid(dataField(input, "analysisId")),
    version: pgInteger(dataField(input, "version")),
    digestVersion,
    analysisDigest: digest(dataField(input, "analysisDigest")),
    currentDigest: digest(dataField(input, "currentDigest")),
  };
}

function captureAnalysis(value: unknown) {
  const input = record(value);
  exactKeys(input, analysisKeys);
  const probabilityLower = finite(dataField(input, "probability_lower"));
  const probabilityCentral = finite(dataField(input, "probability_central"));
  const probabilityUpper = finite(dataField(input, "probability_upper"));
  const confidenceLevel = finite(dataField(input, "confidence_level"));
  const confidenceLower = finite(dataField(input, "confidence_interval_lower"));
  const confidenceUpper = finite(dataField(input, "confidence_interval_upper"));
  const bestLoss = finite(dataField(input, "best_case_loss"));
  const expectedLoss = finite(dataField(input, "expected_case_loss"));
  const worstLoss = finite(dataField(input, "worst_case_loss"));
  const informationCost = finite(dataField(input, "voi_information_cost"));
  const decisionCostIfWrong = finite(
    dataField(input, "voi_decision_cost_if_wrong"),
  );
  const uncertaintyReduction = finite(
    dataField(input, "voi_uncertainty_reduction"),
  );
  const probabilityDecisionChanges = finite(
    dataField(input, "voi_probability_decision_changes"),
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
    decisionCostIfWrong < 0 ||
    uncertaintyReduction < 0 ||
    uncertaintyReduction > 1 ||
    probabilityDecisionChanges < 0 ||
    probabilityDecisionChanges > 1
  )
    refuse();

  const currency = safeString(dataField(input, "currency"));
  if (!/^[A-Z]{3}$/.test(currency)) refuse();
  const sensitivity = array(dataField(input, "sensitivity"), 1, 20).map(
    (item) => {
      const factor = record(item);
      exactKeys(factor, sensitivityKeys);
      const lowInput = finite(dataField(factor, "low_input"));
      const baseInput = finite(dataField(factor, "base_input"));
      const highInput = finite(dataField(factor, "high_input"));
      const lowOutput = finite(dataField(factor, "low_output"));
      const baseOutput = finite(dataField(factor, "base_output"));
      const highOutput = finite(dataField(factor, "high_output"));
      if (
        lowInput > baseInput ||
        baseInput > highInput ||
        lowOutput < 0 ||
        baseOutput < 0 ||
        highOutput < 0
      )
        refuse();
      return {
        name: boundedText(dataField(factor, "name"), 2),
        basis: boundedText(dataField(factor, "basis"), 20),
        low_input: lowInput,
        base_input: baseInput,
        high_input: highInput,
        low_output: lowOutput,
        base_output: baseOutput,
        high_output: highOutput,
      };
    },
  );
  const reassessmentTriggers = array(
    dataField(input, "reassessment_triggers"),
    1,
    20,
  ).map((item) => boundedText(item, 10, 500));

  return {
    method: boundedText(dataField(input, "method"), 3),
    basis: boundedText(dataField(input, "basis"), 20),
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
    sensitivity,
    reassessment_triggers: reassessmentTriggers,
    review_due_at: historicalTimestamp(dataField(input, "review_due_at")),
    voi_action: boundedText(dataField(input, "voi_action"), 10),
    voi_information_cost: informationCost,
    voi_decision_cost_if_wrong: decisionCostIfWrong,
    voi_uncertainty_reduction: uncertaintyReduction,
    voi_probability_decision_changes: probabilityDecisionChanges,
  };
}

function captureEvidence(value: unknown): string[] {
  const ids = array(value, 1, 20).map(uuid);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id, index) => index > 0 && ids[index - 1] >= id)
  )
    refuse();
  return ids;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object")
    return Object.is(left, right);
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  if (Array.isArray(right) || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        sameJson(leftRecord[key], rightRecord[key]),
    )
  );
}

function capturePrepared(value: unknown) {
  const prepared = record(value);
  exactKeys(prepared, preparedKeys);
  const requestText = safeString(dataField(prepared, "requestText"));
  const requestFingerprint = digest(dataField(prepared, "requestFingerprint"));
  const bindings = {
    intentId: uuid(dataField(prepared, "intentId")),
    organizationId: uuid(dataField(prepared, "organizationId")),
    actorId: uuid(dataField(prepared, "actorId")),
    riskId: uuid(dataField(prepared, "riskId")),
    predecessor: capturePredecessor(dataField(prepared, "predecessor")),
    policyDigest: digest(dataField(prepared, "policyDigest")),
    reason: boundedText(dataField(prepared, "reason"), 20),
    analysis: captureAnalysis(dataField(prepared, "analysis")),
    evidenceItemIds: captureEvidence(dataField(prepared, "evidenceItemIds")),
  };
  const bytes = new TextEncoder().encode(requestText);
  if (bytes.byteLength > RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES)
    refuse();

  let payload: Record<string, unknown>;
  try {
    payload = record(JSON.parse(requestText));
  } catch {
    refuse();
  }
  exactKeys(payload, rootKeys);
  if (
    dataField(payload, "contractVersion") !== 1 ||
    dataField(payload, "action") !== "replace"
  )
    refuse();
  const payloadBindings = {
    intentId: uuid(dataField(payload, "intentId")),
    organizationId: uuid(dataField(payload, "organizationId")),
    actorId: uuid(dataField(payload, "actorId")),
    riskId: uuid(dataField(payload, "riskId")),
    predecessor: capturePredecessor(dataField(payload, "predecessor")),
    policyDigest: digest(dataField(payload, "policyDigest")),
    reason: boundedText(dataField(payload, "reason"), 20),
    analysis: captureAnalysis(dataField(payload, "analysis")),
    evidenceItemIds: captureEvidence(dataField(payload, "evidenceItemIds")),
  };
  if (!sameJson(bindings, payloadBindings)) refuse();
  const expectedValueOfInformation = evaluateValueOfInformation({
    informationCost: bindings.analysis.voi_information_cost,
    decisionCostIfWrong: bindings.analysis.voi_decision_cost_if_wrong,
    uncertaintyReduction: bindings.analysis.voi_uncertainty_reduction,
    probabilityDecisionChanges:
      bindings.analysis.voi_probability_decision_changes,
  });
  if (
    !Number.isFinite(expectedValueOfInformation.expectedValue) ||
    !Number.isFinite(expectedValueOfInformation.netValue)
  )
    refuse();
  return {
    requestText,
    requestFingerprint,
    bytes,
    ...payloadBindings,
    expectedValueOfInformation,
  };
}

function hexadecimal(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function qualifyPrepared(value: unknown) {
  let captured: ReturnType<typeof capturePrepared>;
  try {
    captured = capturePrepared(value);
  } catch {
    refuse();
  }
  try {
    const hash = await globalThis.crypto.subtle.digest(
      "SHA-256",
      captured.bytes,
    );
    if (
      hash.byteLength !== 32 ||
      hexadecimal(hash) !== captured.requestFingerprint
    )
      refuse();
  } catch {
    refuse();
  }
  return captured;
}

function exactReceipt(
  value: unknown,
  expected: Awaited<ReturnType<typeof qualifyPrepared>>,
): value is RiskUncertaintyReplacementReceipt {
  try {
    const receipt = record(value);
    exactKeys(receipt, receiptKeys);
    const compareAndSwap = record(dataField(receipt, "compareAndSwap"));
    exactKeys(compareAndSwap, receiptCompareAndSwapKeys);
    const voi = record(dataField(receipt, "valueOfInformation"));
    exactKeys(voi, receiptVoiKeys);
    const analysisId = uuid(dataField(receipt, "analysisId"));
    const version = pgInteger(dataField(receipt, "version"));
    const expectedVoi = expected.expectedValueOfInformation;
    return (
      dataField(receipt, "commitStatus") === "committed" &&
      dataField(receipt, "submittedStatus") === "pending_review" &&
      dataField(receipt, "organizationId") === expected.organizationId &&
      dataField(receipt, "actorId") === expected.actorId &&
      dataField(receipt, "riskId") === expected.riskId &&
      dataField(receipt, "intentId") === expected.intentId &&
      dataField(receipt, "requestFingerprint") ===
        expected.requestFingerprint &&
      dataField(receipt, "predecessorAnalysisId") ===
        expected.predecessor.analysisId &&
      dataField(compareAndSwap, "analysisId") ===
        expected.predecessor.analysisId &&
      dataField(compareAndSwap, "version") === expected.predecessor.version &&
      dataField(compareAndSwap, "digestVersion") ===
        expected.predecessor.digestVersion &&
      dataField(compareAndSwap, "analysisDigest") ===
        expected.predecessor.analysisDigest &&
      dataField(compareAndSwap, "currentDigest") ===
        expected.predecessor.currentDigest &&
      dataField(compareAndSwap, "policyDigest") === expected.policyDigest &&
      analysisId !== expected.predecessor.analysisId &&
      version === expected.predecessor.version + 1 &&
      digest(dataField(receipt, "analysisDigest")) ===
        dataField(receipt, "analysisDigest") &&
      dataField(receipt, "digestVersion") === 2 &&
      dataField(receipt, "digestCoverage") ===
        "evidence_content_and_current_criteria" &&
      finite(dataField(voi, "informationCost")) ===
        expected.analysis.voi_information_cost &&
      finite(dataField(voi, "decisionCostIfWrong")) ===
        expected.analysis.voi_decision_cost_if_wrong &&
      finite(dataField(voi, "uncertaintyReduction")) ===
        expected.analysis.voi_uncertainty_reduction &&
      finite(dataField(voi, "probabilityDecisionChanges")) ===
        expected.analysis.voi_probability_decision_changes &&
      finite(dataField(voi, "expectedValue")) === expectedVoi.expectedValue &&
      finite(dataField(voi, "netValue")) === expectedVoi.netValue &&
      dataField(voi, "recommendation") === expectedVoi.recommendation &&
      dataField(receipt, "operationalAuthorization") === false
    );
  } catch {
    return false;
  }
}

function successfulResponseData(value: unknown): { data: unknown } | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return null;
    const response = value as Record<string, unknown>;
    const status = Object.getOwnPropertyDescriptor(response, "status");
    const error = Object.getOwnPropertyDescriptor(response, "error");
    const data = Object.getOwnPropertyDescriptor(response, "data");
    if (
      !status ||
      !("value" in status) ||
      !Number.isInteger(status.value) ||
      (status.value as number) < 200 ||
      (status.value as number) >= 300 ||
      !error ||
      !("value" in error) ||
      error.value !== null ||
      !data ||
      !("value" in data)
    )
      return null;
    return { data: data.value };
  } catch {
    return null;
  }
}

function exactSafeRefusal(value: unknown): boolean {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return false;
    const data = value as Record<string, unknown>;
    const error = Object.getOwnPropertyDescriptor(data, "error");
    return (
      Object.keys(data).length === 1 &&
      !!error &&
      "value" in error &&
      typeof error.value === "string" &&
      error.value.trim().length > 0
    );
  } catch {
    return false;
  }
}

export async function replaceRiskUncertaintyAnalysis(
  prepared: PreparedRiskUncertaintyReplacementRequest,
): Promise<RiskUncertaintyReplacementReceipt> {
  const expected = await qualifyPrepared(prepared);
  let response: unknown;
  try {
    response = await supabase.rpc("replace_risk_uncertainty_analysis", {
      p_risk_id: expected.riskId,
      p_request_text: expected.requestText,
    });
  } catch {
    throw new RiskUncertaintyReplacementOutcomeUnknownError();
  }
  const acknowledged = successfulResponseData(response);
  if (!acknowledged) throw new RiskUncertaintyReplacementOutcomeUnknownError();
  if (exactSafeRefusal(acknowledged.data))
    throw new RiskUncertaintyReplacementRefusedError();
  if (!exactReceipt(acknowledged.data, expected))
    throw new RiskUncertaintyReplacementOutcomeUnknownError();
  return acknowledged.data;
}

export async function reconcileRiskUncertaintyReplacement(
  prepared: PreparedRiskUncertaintyReplacementRequest,
): Promise<RiskUncertaintyReplacementReceipt> {
  let expected: Awaited<ReturnType<typeof qualifyPrepared>>;
  try {
    expected = await qualifyPrepared(prepared);
  } catch {
    throw new RiskUncertaintyReplacementUnresolvedError();
  }
  let response: unknown;
  try {
    response = await supabase.rpc("get_risk_uncertainty_replacement_receipt", {
      p_risk_id: expected.riskId,
      p_intent_id: expected.intentId,
      p_request_fingerprint: expected.requestFingerprint,
    });
  } catch {
    throw new RiskUncertaintyReplacementUnresolvedError();
  }
  const acknowledged = successfulResponseData(response);
  if (!acknowledged || !exactReceipt(acknowledged.data, expected))
    throw new RiskUncertaintyReplacementUnresolvedError();
  return acknowledged.data;
}

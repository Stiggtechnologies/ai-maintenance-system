import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareRiskUncertaintyReplacementRequest,
  type PreparedRiskUncertaintyReplacementRequest,
  type RiskUncertaintyReplacementRequestInput,
} from "./riskUncertaintyReplacementRequest";
import {
  RiskUncertaintyReplacementOutcomeUnknownError,
  RiskUncertaintyReplacementRefusedError,
  RiskUncertaintyReplacementUnresolvedError,
  reconcileRiskUncertaintyReplacement,
  replaceRiskUncertaintyAnalysis,
} from "./riskUncertaintyReplacementService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const organizationId = "a1820000-0000-4000-8000-000000000020";
const actorId = "a1820000-0000-4000-8000-000000000021";
const riskId = "a1820000-0000-4000-8000-000000000002";
const predecessorId = "a1820000-0000-4000-8000-000000000010";
const successorId = "a1820000-0000-4000-8000-000000000011";
const intentId = "a1820000-0000-4000-8000-000000000030";
const evidenceId = "a1820000-0000-4000-8000-000000000001";

function requestInput(): RiskUncertaintyReplacementRequestInput {
  return {
    intentId,
    organizationId,
    actorId,
    riskId,
    predecessor: {
      analysisId: predecessorId,
      version: 7,
      digestVersion: 2,
      analysisDigest: "a".repeat(64),
      currentDigest: "b".repeat(64),
    },
    policyDigest: "c".repeat(64),
    reason: "New verified evidence requires a replacement packet.",
    analysis: {
      method: "Monte Carlo estimate",
      basis: "Measured evidence and documented engineering assumptions.",
      probability_lower: 0.1,
      probability_central: 0.2,
      probability_upper: 0.4,
      confidence_level: 0.9,
      confidence_interval_lower: 0.05,
      confidence_interval_upper: 0.5,
      best_case_loss: 1,
      expected_case_loss: 2,
      worst_case_loss: 3,
      currency: "CAD",
      sensitivity: [
        {
          name: "Seal life",
          basis: "Verified inspection history and operating context.",
          low_input: -1,
          base_input: 0,
          high_input: 1,
          low_output: 3,
          base_output: 1,
          high_output: 2,
        },
      ],
      reassessment_triggers: ["New verified seal inspection measurement"],
      review_due_at: "2099-10-01T00:00:00.000Z",
      voi_action: "Acquire one additional vibration survey",
      voi_information_cost: 1,
      voi_decision_cost_if_wrong: 2,
      voi_uncertainty_reduction: 0.5,
      voi_probability_decision_changes: 0.25,
    },
    evidenceItemIds: [evidenceId],
  };
}

async function prepared() {
  return prepareRiskUncertaintyReplacementRequest(requestInput());
}

function receipt(request: PreparedRiskUncertaintyReplacementRequest) {
  return {
    commitStatus: "committed",
    submittedStatus: "pending_review",
    organizationId: request.organizationId,
    actorId: request.actorId,
    riskId: request.riskId,
    intentId: request.intentId,
    requestFingerprint: request.requestFingerprint,
    predecessorAnalysisId: request.predecessor.analysisId,
    compareAndSwap: {
      analysisId: request.predecessor.analysisId,
      version: request.predecessor.version,
      digestVersion: request.predecessor.digestVersion,
      analysisDigest: request.predecessor.analysisDigest,
      currentDigest: request.predecessor.currentDigest,
      policyDigest: request.policyDigest,
    },
    analysisId: successorId,
    version: 8,
    analysisDigest: "d".repeat(64),
    digestVersion: 2,
    digestCoverage: "evidence_content_and_current_criteria",
    valueOfInformation: {
      informationCost: 1,
      decisionCostIfWrong: 2,
      uncertaintyReduction: 0.5,
      probabilityDecisionChanges: 0.25,
      expectedValue: 0.25,
      netValue: -0.75,
      recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
    },
    operationalAuthorization: false,
  };
}

function ok(data: unknown) {
  rpc.mockResolvedValue({ data, error: null, status: 200 });
}

function clonePrepared(
  request: PreparedRiskUncertaintyReplacementRequest,
): PreparedRiskUncertaintyReplacementRequest {
  return structuredClone(request);
}

function set(target: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
}

beforeEach(() => {
  rpc.mockReset();
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => vi.unstubAllGlobals());

describe("risk uncertainty atomic replacement transport", () => {
  it("submits the exact captured request once and returns a qualified historical commit receipt", async () => {
    const request = await prepared();
    const expected = receipt(request);
    ok(expected);

    await expect(replaceRiskUncertaintyAnalysis(request)).resolves.toEqual(
      expected,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_risk_uncertainty_analysis", {
      p_risk_id: riskId,
      p_request_text: request.requestText,
    });
  });

  it("normalizes uppercase UUID input through the preparer before capture", async () => {
    const input = requestInput();
    input.intentId = input.intentId.toUpperCase();
    input.organizationId = input.organizationId.toUpperCase();
    input.actorId = input.actorId.toUpperCase();
    input.riskId = input.riskId.toUpperCase();
    input.predecessor.analysisId = input.predecessor.analysisId.toUpperCase();
    input.evidenceItemIds = input.evidenceItemIds.map((id) => id.toUpperCase());
    const request = await prepareRiskUncertaintyReplacementRequest(input);
    ok(receipt(request));

    await replaceRiskUncertaintyAnalysis(request);
    expect(rpc).toHaveBeenCalledWith("replace_risk_uncertainty_analysis", {
      p_risk_id: riskId,
      p_request_text: request.requestText,
    });
  });

  it("accepts a legacy v1 predecessor CAS while requiring a v2 successor receipt", async () => {
    const input = requestInput();
    input.predecessor.digestVersion = 1;
    const request = await prepareRiskUncertaintyReplacementRequest(input);
    const expected = receipt(request);
    ok(expected);

    await expect(replaceRiskUncertaintyAnalysis(request)).resolves.toEqual(
      expected,
    );
    expect(expected.compareAndSwap.digestVersion).toBe(1);
    expect(expected.digestVersion).toBe(2);
    expect(expected.digestCoverage).toBe(
      "evidence_content_and_current_criteria",
    );
  });

  it("captures request, bindings, CAS and proposal before deferred hashing", async () => {
    const original = clonePrepared(await prepared());
    const request = clonePrepared(original);
    let release!: () => void;
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn((_algorithm: string, bytes: Uint8Array) => {
          const captured = new Uint8Array(bytes);
          return new Promise<ArrayBuffer>((resolve) => {
            release = () => {
              const hash = createHash("sha256").update(captured).digest();
              resolve(
                hash.buffer.slice(
                  hash.byteOffset,
                  hash.byteOffset + hash.byteLength,
                ) as ArrayBuffer,
              );
            };
          });
        }),
      },
    });
    ok(receipt(original));

    const pending = replaceRiskUncertaintyAnalysis(request);
    set(request, "riskId", successorId);
    set(request, "predecessor.version", 99);
    set(request, "analysis.voi_information_cost", 999);
    set(request, "evidenceItemIds.0", successorId);
    set(request, "requestText", "forged after dispatch");
    release();

    await expect(pending).resolves.toEqual(receipt(original));
    expect(rpc).toHaveBeenCalledWith("replace_risk_uncertainty_analysis", {
      p_risk_id: original.riskId,
      p_request_text: original.requestText,
    });
  });

  it("accepts a historically prepared request after its review due time passes", async () => {
    const request = clonePrepared(await prepared());
    const payload = JSON.parse(request.requestText);
    payload.analysis.review_due_at = "2020-01-01T00:00:00.000Z";
    const historicalRequestText = JSON.stringify(payload);
    set(request, "analysis.review_due_at", payload.analysis.review_due_at);
    set(request, "requestText", historicalRequestText);
    set(
      request,
      "requestFingerprint",
      createHash("sha256")
        .update(Buffer.from(historicalRequestText, "utf8"))
        .digest("hex"),
    );
    ok(receipt(request));

    await expect(replaceRiskUncertaintyAnalysis(request)).resolves.toEqual(
      receipt(request),
    );
  });

  it.each(["2099-10-01T00:00:00+15:59", "2099-10-01T00:00:00-15:59"])(
    "accepts the PostgreSQL offset bound through exact transport %s",
    async (timestamp) => {
      const input = requestInput();
      input.analysis.review_due_at = timestamp;
      const request = await prepareRiskUncertaintyReplacementRequest(input);
      ok(receipt(request));
      await expect(replaceRiskUncertaintyAnalysis(request)).resolves.toEqual(
        receipt(request),
      );
      expect(request.requestFingerprint).toBe(
        createHash("sha256")
          .update(Buffer.from(request.requestText, "utf8"))
          .digest("hex"),
      );
    },
  );

  it.each(["+16:00", "-16:00", "+23:59", "-23:59"])(
    "refuses a PostgreSQL-incompatible prepared timestamp offset %s before crypto or RPC",
    async (offset) => {
      const request = clonePrepared(await prepared());
      const payload = JSON.parse(request.requestText);
      payload.analysis.review_due_at = `2099-10-01T00:00:00${offset}`;
      const requestText = JSON.stringify(payload);
      set(request, "analysis.review_due_at", payload.analysis.review_due_at);
      set(request, "requestText", requestText);
      set(
        request,
        "requestFingerprint",
        createHash("sha256")
          .update(Buffer.from(requestText, "utf8"))
          .digest("hex"),
      );
      const digest = vi.fn();
      vi.stubGlobal("crypto", { subtle: { digest } });

      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementRefusedError);
      expect(digest).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "fingerprint mismatch",
      (request: PreparedRiskUncertaintyReplacementRequest) =>
        set(request, "requestFingerprint", "f".repeat(64)),
    ],
    [
      "binding mismatch",
      (request: PreparedRiskUncertaintyReplacementRequest) =>
        set(request, "riskId", successorId),
    ],
    [
      "proposal mismatch",
      (request: PreparedRiskUncertaintyReplacementRequest) =>
        set(request, "analysis.voi_information_cost", 99),
    ],
    [
      "malformed request text",
      (request: PreparedRiskUncertaintyReplacementRequest) =>
        set(request, "requestText", "not-json"),
    ],
  ])("refuses local %s before RPC", async (_label, mutate) => {
    const request = clonePrepared(await prepared());
    mutate(request);
    await expect(
      replaceRiskUncertaintyAnalysis(request),
    ).rejects.toBeInstanceOf(RiskUncertaintyReplacementRefusedError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses accessor-backed caller arrays without invoking their values", async () => {
    for (const path of ["evidenceItemIds", "analysis.sensitivity"] as const) {
      const request = clonePrepared(await prepared());
      const getter = vi.fn(() => evidenceId);
      const target =
        path === "evidenceItemIds"
          ? request.evidenceItemIds
          : request.analysis.sensitivity;
      Object.defineProperty(target, "0", { configurable: true, get: getter });

      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementRefusedError);
      expect(getter).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["rejected thenable", () => rpc.mockRejectedValue(new Error("offline"))],
    [
      "HTTP 503",
      () => rpc.mockResolvedValue({ data: null, error: null, status: 503 }),
    ],
    [
      "string status",
      () => rpc.mockResolvedValue({ data: null, error: null, status: "200" }),
    ],
    [
      "transport error",
      () =>
        rpc.mockResolvedValue({
          data: null,
          error: { message: "private" },
          status: 200,
        }),
    ],
  ])(
    "classifies %s as outcome unknown without retry",
    async (_label, arrange) => {
      const request = await prepared();
      arrange();
      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementOutcomeUnknownError);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("uses only an exact error-only successful response as a safe refusal", async () => {
    const request = await prepared();
    ok({ error: "canonical refusal detail must not escape" });
    await expect(replaceRiskUncertaintyAnalysis(request)).rejects.toEqual(
      expect.objectContaining({
        name: "RiskUncertaintyReplacementRefusedError",
        message: "Risk uncertainty replacement was refused before commit.",
      }),
    );

    ok({ error: "canonical refusal", extra: true });
    await expect(
      replaceRiskUncertaintyAnalysis(request),
    ).rejects.toBeInstanceOf(RiskUncertaintyReplacementOutcomeUnknownError);
  });

  it("classifies accessor-backed transport output as unknown without exposing it", async () => {
    const request = await prepared();
    const response = { error: null, status: 200 } as Record<string, unknown>;
    Object.defineProperty(response, "data", {
      enumerable: true,
      get: () => {
        throw new Error("private transport detail");
      },
    });
    rpc.mockResolvedValue(response);

    await expect(replaceRiskUncertaintyAnalysis(request)).rejects.toEqual(
      expect.objectContaining({
        name: "RiskUncertaintyReplacementOutcomeUnknownError",
      }),
    );
  });

  it.each([
    ["commitStatus", "unknown"],
    ["submittedStatus", "validated"],
    ["organizationId", successorId],
    ["actorId", successorId],
    ["riskId", successorId],
    ["intentId", successorId],
    ["requestFingerprint", "e".repeat(64)],
    ["predecessorAnalysisId", successorId],
    ["compareAndSwap.analysisId", successorId],
    ["compareAndSwap.version", 8],
    ["compareAndSwap.digestVersion", 1],
    ["compareAndSwap.analysisDigest", "e".repeat(64)],
    ["compareAndSwap.currentDigest", "e".repeat(64)],
    ["compareAndSwap.policyDigest", "e".repeat(64)],
    ["analysisId", "not-a-uuid"],
    ["version", 7],
    ["version", 9],
    ["analysisDigest", "D".repeat(64)],
    ["digestVersion", 1],
    ["digestCoverage", "legacy_metadata"],
    ["operationalAuthorization", true],
    ["valueOfInformation.informationCost", 2],
    ["valueOfInformation.decisionCostIfWrong", 3],
    ["valueOfInformation.uncertaintyReduction", 0.6],
    ["valueOfInformation.probabilityDecisionChanges", 0.3],
    ["valueOfInformation.expectedValue", 0.26],
    ["valueOfInformation.netValue", -0.74],
    ["valueOfInformation.recommendation", "GATHER_INFORMATION"],
  ])(
    "treats mismatched or malformed receipt %s as outcome unknown",
    async (path, value) => {
      const request = await prepared();
      const response = receipt(request);
      set(response, path, value);
      ok(response);
      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementOutcomeUnknownError);
    },
  );

  it("treats mixed error/receipt and extra receipt fields as outcome unknown", async () => {
    const request = await prepared();
    for (const response of [
      { ...receipt(request), error: "ambiguous" },
      { ...receipt(request), extra: true },
    ]) {
      ok(response);
      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementOutcomeUnknownError);
    }
  });

  it.each(["digestVersion", "digestCoverage"])(
    "treats a receipt missing %s as outcome unknown",
    async (field) => {
      const request = await prepared();
      const response = receipt(request);
      delete (response as Record<string, unknown>)[field];
      ok(response);
      await expect(
        replaceRiskUncertaintyAnalysis(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementOutcomeUnknownError);
    },
  );
});

describe("risk uncertainty replacement reconciliation", () => {
  it("reads one exact historical receipt without dispatching a replacement", async () => {
    const request = await prepared();
    const expected = receipt(request);
    ok(expected);

    await expect(reconcileRiskUncertaintyReplacement(request)).resolves.toEqual(
      expected,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "get_risk_uncertainty_replacement_receipt",
      {
        p_risk_id: riskId,
        p_intent_id: intentId,
        p_request_fingerprint: request.requestFingerprint,
      },
    );
  });

  it.each([
    ["absent", { data: { error: "no receipt" }, error: null, status: 200 }],
    ["unreadable", { data: null, error: { message: "private" }, status: 200 }],
    ["non-2xx", { data: null, error: null, status: 503 }],
    [
      "malformed",
      { data: { commitStatus: "committed" }, error: null, status: 200 },
    ],
  ])(
    "keeps %s reconciliation unresolved without a resend claim",
    async (_label, response) => {
      const request = await prepared();
      rpc.mockResolvedValue(response);
      await expect(
        reconcileRiskUncertaintyReplacement(request),
      ).rejects.toEqual(
        expect.objectContaining({
          name: "RiskUncertaintyReplacementUnresolvedError",
          unresolved: true,
          safeToResend: false,
        }),
      );
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("classifies a correlated receipt mismatch as unresolved", async () => {
    const request = await prepared();
    ok({ ...receipt(request), organizationId: successorId });
    await expect(
      reconcileRiskUncertaintyReplacement(request),
    ).rejects.toBeInstanceOf(RiskUncertaintyReplacementUnresolvedError);
  });

  it("keeps accessor-backed reconciliation output unresolved", async () => {
    const request = await prepared();
    const response = { error: null, status: 200 } as Record<string, unknown>;
    Object.defineProperty(response, "data", {
      enumerable: true,
      get: () => {
        throw new Error("private reconciliation detail");
      },
    });
    rpc.mockResolvedValue(response);

    await expect(
      reconcileRiskUncertaintyReplacement(request),
    ).rejects.toBeInstanceOf(RiskUncertaintyReplacementUnresolvedError);
  });

  it.each(["digestVersion", "digestCoverage"])(
    "keeps missing or contradictory %s unresolved",
    async (field) => {
      const request = await prepared();
      const response = receipt(request);
      if (field === "digestVersion")
        delete (response as Record<string, unknown>).digestVersion;
      else response.digestCoverage = "legacy_metadata";
      ok(response);
      await expect(
        reconcileRiskUncertaintyReplacement(request),
      ).rejects.toBeInstanceOf(RiskUncertaintyReplacementUnresolvedError);
    },
  );

  it("keeps a locally mismatched prepared request unresolved without RPC", async () => {
    const request = clonePrepared(await prepared());
    set(request, "requestFingerprint", "f".repeat(64));
    await expect(
      reconcileRiskUncertaintyReplacement(request),
    ).rejects.toBeInstanceOf(RiskUncertaintyReplacementUnresolvedError);
    expect(rpc).not.toHaveBeenCalled();
  });
});

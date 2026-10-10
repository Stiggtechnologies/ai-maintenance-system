import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RISK_UNCERTAINTY_REPLACEMENT_PREPARATION_ERROR,
  RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES,
  prepareRiskUncertaintyReplacementRequest,
  type RiskUncertaintyReplacementRequestInput,
} from "./riskUncertaintyReplacementRequest";

const organizationId = "a1820000-0000-4000-8000-000000000020";
const actorId = "a1820000-0000-4000-8000-000000000021";
const riskId = "a1820000-0000-4000-8000-000000000002";
const analysisId = "a1820000-0000-4000-8000-000000000010";
const intentId = "a1820000-0000-4000-8000-000000000030";
const evidenceA = "a1820000-0000-4000-8000-000000000001";
const evidenceB = "a1820000-0000-4000-8000-000000000009";
const fixedError = RISK_UNCERTAINTY_REPLACEMENT_PREPARATION_ERROR;

function input(): RiskUncertaintyReplacementRequestInput {
  return {
    intentId,
    organizationId,
    actorId,
    riskId,
    predecessor: {
      analysisId,
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
    evidenceItemIds: [evidenceB, evidenceA, evidenceB],
  };
}

function set(target: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
}

async function expectPreflightRefusal(value: unknown) {
  const digest = vi.fn();
  vi.stubGlobal("crypto", { subtle: { digest } });
  await expect(
    prepareRiskUncertaintyReplacementRequest(
      value as RiskUncertaintyReplacementRequestInput,
    ),
  ).rejects.toThrow(fixedError);
  expect(digest).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("risk uncertainty replacement request preparation", () => {
  it("builds one allowlisted v1 replacement payload, normalized evidence and a UTF-8 SHA-256 fingerprint", async () => {
    const source = input();
    source.intentId = source.intentId.toUpperCase();
    source.organizationId = source.organizationId.toUpperCase();
    source.actorId = source.actorId.toUpperCase();
    source.riskId = source.riskId.toUpperCase();
    source.predecessor.analysisId = source.predecessor.analysisId.toUpperCase();
    source.evidenceItemIds = source.evidenceItemIds.map((id) =>
      id.toUpperCase(),
    );
    source.analysis.basis += " Unicode witness: Δ😀.";

    const prepared = await prepareRiskUncertaintyReplacementRequest(source);
    const payload = JSON.parse(prepared.requestText);
    const expectedFingerprint = createHash("sha256")
      .update(Buffer.from(prepared.requestText, "utf8"))
      .digest("hex");

    expect(Object.keys(payload)).toEqual([
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
    ]);
    expect(payload.contractVersion).toBe(1);
    expect(payload.action).toBe("replace");
    expect(prepared.requestFingerprint).toBe(expectedFingerprint);
    expect(prepared.intentId).toBe(intentId);
    expect(prepared.organizationId).toBe(organizationId);
    expect(prepared.predecessor.analysisId).toBe(analysisId);
    expect(prepared.evidenceItemIds).toEqual([evidenceA, evidenceB]);
    expect(prepared.analysis.basis).toContain("Δ😀");
  });

  it("captures every allowlisted value before deferred hashing and returns no mutable caller references", async () => {
    const source = input();
    const original = structuredClone(source);
    let release!: () => void;
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn((_algorithm: string, value: Uint8Array) => {
          const captured = new Uint8Array(value);
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

    const pending = prepareRiskUncertaintyReplacementRequest(source);
    source.intentId = "a1820000-0000-4000-8000-000000000098";
    source.organizationId = "a1820000-0000-4000-8000-000000000099";
    source.actorId = "a1820000-0000-4000-8000-000000000097";
    source.riskId = "a1820000-0000-4000-8000-000000000096";
    source.predecessor.analysisId = "a1820000-0000-4000-8000-000000000095";
    source.predecessor.version = 8;
    source.predecessor.digestVersion = 1;
    source.predecessor.analysisDigest = "d".repeat(64);
    source.predecessor.currentDigest = "e".repeat(64);
    source.policyDigest = "f".repeat(64);
    source.reason = "Mutated replacement reason after dispatch capture.";
    source.analysis.method = "Mutated method";
    source.analysis.sensitivity[0].basis = "Mutated nested basis";
    source.analysis.reassessment_triggers[0] = "Mutated trigger";
    source.evidenceItemIds.splice(0, source.evidenceItemIds.length, analysisId);
    release();

    const prepared = await pending;
    const payload = JSON.parse(prepared.requestText);
    expect(payload).toEqual({
      contractVersion: 1,
      action: "replace",
      ...original,
      evidenceItemIds: [evidenceA, evidenceB],
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.predecessor)).toBe(true);
    expect(Object.isFrozen(prepared.analysis)).toBe(true);
    expect(Object.isFrozen(prepared.analysis.sensitivity)).toBe(true);
    expect(Object.isFrozen(prepared.analysis.sensitivity[0])).toBe(true);
    expect(Object.isFrozen(prepared.analysis.reassessment_triggers)).toBe(true);
    expect(Object.isFrozen(prepared.evidenceItemIds)).toBe(true);
  });

  it("serializes only explicit fields without invoking extra getters or toJSON hooks", async () => {
    const source = input() as RiskUncertaintyReplacementRequestInput &
      Record<string, unknown>;
    const extra = { secret: "must not serialize" };
    extra["cycle" as keyof typeof extra] = extra as never;
    source.extra = extra;
    Object.defineProperty(source, "ignoredGetter", {
      enumerable: true,
      get: () => {
        throw new Error("extra getter invoked");
      },
    });
    Object.assign(source.analysis, {
      extra: "must not serialize",
      toJSON: () => ({ forged: true }),
    });

    const prepared = await prepareRiskUncertaintyReplacementRequest(source);
    expect(prepared.requestText).not.toContain("secret");
    expect(prepared.requestText).not.toContain("ignoredGetter");
    expect(prepared.requestText).not.toContain("forged");
    expect(prepared.requestText).not.toContain("toJSON");
    expect(JSON.parse(prepared.requestText).analysis.method).toBe(
      source.analysis.method,
    );
  });

  it("is immune to inherited Object.prototype.toJSON payload substitution", async () => {
    let prepared!: Awaited<
      ReturnType<typeof prepareRiskUncertaintyReplacementRequest>
    >;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value: () => ({ forged: true }),
    });
    try {
      prepared = await prepareRiskUncertaintyReplacementRequest(input());
    } finally {
      delete (Object.prototype as Record<string, unknown>).toJSON;
    }

    expect(JSON.parse(prepared.requestText)).toMatchObject({
      contractVersion: 1,
      action: "replace",
      intentId,
      organizationId,
    });
    expect(prepared.requestText).not.toContain("forged");
  });

  it.each([
    "intentId",
    "organizationId",
    "actorId",
    "riskId",
    "predecessor.analysisId",
  ])(
    "refuses malformed scope or intent UUID %s before hashing",
    async (path) => {
      const source = input();
      set(source, path, "not-a-uuid");
      await expectPreflightRefusal(source);
    },
  );

  it.each([
    "predecessor.analysisDigest",
    "predecessor.currentDigest",
    "policyDigest",
  ])("refuses malformed or non-lowercase CAS digest %s", async (path) => {
    for (const value of ["a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
      const source = input();
      set(source, path, value);
      await expectPreflightRefusal(source);
    }
  });

  it.each([
    ["predecessor.version", 0],
    ["predecessor.version", 1.5],
    ["predecessor.version", 2147483648],
    ["predecessor.digestVersion", 0],
    ["predecessor.digestVersion", 3],
    ["reason", "too short"],
  ])("refuses invalid predecessor or reason %s=%j", async (path, value) => {
    const source = input();
    set(source, path as string, value);
    await expectPreflightRefusal(source);
  });

  it.each([
    "probability_lower",
    "probability_central",
    "probability_upper",
    "confidence_level",
    "confidence_interval_lower",
    "confidence_interval_upper",
    "best_case_loss",
    "expected_case_loss",
    "worst_case_loss",
    "voi_information_cost",
    "voi_decision_cost_if_wrong",
    "voi_uncertainty_reduction",
    "voi_probability_decision_changes",
  ])("refuses non-finite proposal number %s", async (field) => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const source = input();
      set(source, `analysis.${field}`, value);
      await expectPreflightRefusal(source);
    }
  });

  it.each([
    ["probability_lower", -0.1],
    ["probability_central", 0.05],
    ["probability_upper", 1.1],
    ["confidence_level", 0],
    ["confidence_interval_lower", -0.1],
    ["confidence_interval_upper", 1.1],
    ["best_case_loss", -1],
    ["expected_case_loss", 0.5],
    ["worst_case_loss", 1.5],
    ["voi_information_cost", -1],
    ["voi_decision_cost_if_wrong", -1],
    ["voi_uncertainty_reduction", 1.1],
    ["voi_probability_decision_changes", -0.1],
  ])(
    "refuses out-of-range or out-of-order proposal %s=%j",
    async (field, value) => {
      const source = input();
      set(source, `analysis.${field}`, value);
      await expectPreflightRefusal(source);
    },
  );

  it.each([
    ["method", "  x  "],
    ["basis", "short basis"],
    ["currency", "cad"],
    ["currency", "CADX"],
    ["voi_action", "short"],
    ["review_due_at", "not-a-date"],
    ["review_due_at", "2020-01-01T00:00:00Z"],
    ["review_due_at", "2099-02-30T00:00:00Z"],
    ["review_due_at", "09/31/2099"],
    ["review_due_at", "2099-10-01T00:00:00"],
    ["review_due_at", "2099-10-01T24:00:00Z"],
    ["review_due_at", "2099-10-01T00:00:00+16:00"],
    ["review_due_at", "2099-10-01T00:00:00-16:00"],
    ["review_due_at", "2099-10-01T00:00:00+23:59"],
    ["review_due_at", "2099-10-01T00:00:00-23:59"],
  ])("refuses invalid proposal text/date %s=%j", async (field, value) => {
    const source = input();
    set(source, `analysis.${field}`, value);
    await expectPreflightRefusal(source);
  });

  it.each(["2099-10-01T00:00:00+15:59", "2099-10-01T00:00:00-15:59"])(
    "accepts PostgreSQL's exact minute-resolution offset bound %s",
    async (timestamp) => {
      const source = input();
      source.analysis.review_due_at = timestamp;
      const prepared = await prepareRiskUncertaintyReplacementRequest(source);
      expect(JSON.parse(prepared.requestText).analysis.review_due_at).toBe(
        timestamp,
      );
      expect(prepared.requestFingerprint).toBe(
        createHash("sha256")
          .update(Buffer.from(prepared.requestText, "utf8"))
          .digest("hex"),
      );
    },
  );

  it.each([
    ["low_output", -1],
    ["base_output", -1],
    ["high_output", -1],
    ["low_input", 1],
    ["base_input", 2],
  ])("refuses invalid sensitivity %s=%j", async (field, value) => {
    const source = input();
    set(source, `analysis.sensitivity.0.${field}`, value);
    if (field === "low_input" && value === 1)
      set(source, "analysis.sensitivity.0.base_input", 0);
    if (field === "base_input" && value === 2)
      set(source, "analysis.sensitivity.0.high_input", 1);
    await expectPreflightRefusal(source);
  });

  it.each([
    "low_input",
    "base_input",
    "high_input",
    "low_output",
    "base_output",
    "high_output",
  ])("refuses non-finite sensitivity number %s", async (field) => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const source = input();
      set(source, `analysis.sensitivity.0.${field}`, value);
      await expectPreflightRefusal(source);
    }
  });

  it.each([
    ["analysis.sensitivity", []],
    ["analysis.sensitivity.0.name", "x"],
    ["analysis.sensitivity.0.basis", "short"],
    ["analysis.reassessment_triggers", []],
    ["analysis.reassessment_triggers.0", "short"],
    ["analysis.reassessment_triggers.0", "x".repeat(501)],
  ])(
    "refuses incomplete bounded proposal collection %s",
    async (path, value) => {
      const source = input();
      set(source, path as string, value);
      await expectPreflightRefusal(source);
    },
  );

  it.each([
    null,
    [],
    [null],
    [],
    ["not-a-uuid"],
    Array.from(
      { length: 21 },
      (_, index) =>
        `a1820000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
  ])("refuses malformed evidence input %j", async (evidenceItemIds) => {
    const source = input();
    set(source, "evidenceItemIds", evidenceItemIds);
    await expectPreflightRefusal(source);
  });

  it("refuses accessors and custom prototypes for allowlisted records before hashing", async () => {
    const source = input();
    let reads = 0;
    Object.defineProperty(source.predecessor, "analysisDigest", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "a".repeat(64);
      },
    });
    await expectPreflightRefusal(source);
    expect(reads).toBe(0);

    const custom = Object.assign(Object.create({ inherited: true }), input());
    await expectPreflightRefusal(custom);
  });

  it.each(["reason", "analysis.method", "analysis.sensitivity.0.basis"])(
    "refuses PostgreSQL-incompatible NUL and unpaired UTF-16 in %s",
    async (path) => {
      for (const value of [
        "valid text with\u0000nul",
        "valid text with\ud800",
      ]) {
        const source = input();
        set(source, path, value.padEnd(30, "x"));
        await expectPreflightRefusal(source);
      }
    },
  );

  it("normalizes accepted negative zero across proposal numeric families before serialization", async () => {
    const source = input();
    Object.assign(source.analysis, {
      probability_lower: -0,
      probability_central: -0,
      probability_upper: -0,
      confidence_interval_lower: -0,
      confidence_interval_upper: -0,
      best_case_loss: -0,
      expected_case_loss: -0,
      worst_case_loss: -0,
      voi_information_cost: -0,
      voi_decision_cost_if_wrong: -0,
      voi_uncertainty_reduction: -0,
      voi_probability_decision_changes: -0,
    });
    Object.assign(source.analysis.sensitivity[0], {
      low_input: -0,
      base_input: -0,
      high_input: -0,
      low_output: -0,
      base_output: -0,
      high_output: -0,
    });

    const prepared = await prepareRiskUncertaintyReplacementRequest(source);
    const numbers = [
      prepared.analysis.probability_lower,
      prepared.analysis.probability_central,
      prepared.analysis.probability_upper,
      prepared.analysis.confidence_interval_lower,
      prepared.analysis.confidence_interval_upper,
      prepared.analysis.best_case_loss,
      prepared.analysis.expected_case_loss,
      prepared.analysis.worst_case_loss,
      prepared.analysis.voi_information_cost,
      prepared.analysis.voi_decision_cost_if_wrong,
      prepared.analysis.voi_uncertainty_reduction,
      prepared.analysis.voi_probability_decision_changes,
      ...Object.values(prepared.analysis.sensitivity[0]).filter(
        (value): value is number => typeof value === "number",
      ),
    ];
    expect(numbers.every((value) => value === 0 && !Object.is(value, -0))).toBe(
      true,
    );
    expect(JSON.parse(prepared.requestText).analysis).toEqual(
      prepared.analysis,
    );

    source.analysis.confidence_level = -0;
    await expectPreflightRefusal(source);
  });

  it("refuses a WebCrypto digest result that is not exactly 32 bytes", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array([1]).buffer),
      },
    });
    await expect(
      prepareRiskUncertaintyReplacementRequest(input()),
    ).rejects.toThrow(fixedError);
  });

  it("counts reason length with ASCII-space btrim and Unicode codepoints without rewriting it", async () => {
    const source = input();
    source.reason = "😀".repeat(20);
    await expect(
      prepareRiskUncertaintyReplacementRequest(source),
    ).resolves.toMatchObject({ reason: source.reason });

    source.reason = `   ${"😀".repeat(19)}   `;
    await expectPreflightRefusal(source);
  });

  it("accepts the exact one-MiB UTF-8 boundary and refuses one byte more before hashing", async () => {
    expect(RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES).toBe(
      1024 * 1024,
    );
    const baseline = input();
    const baselinePrepared =
      await prepareRiskUncertaintyReplacementRequest(baseline);
    const baselineBytes = new TextEncoder().encode(
      baselinePrepared.requestText,
    ).byteLength;
    const exact = input();
    exact.analysis.method += "x".repeat(
      RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES - baselineBytes,
    );
    const exactPrepared = await prepareRiskUncertaintyReplacementRequest(exact);
    expect(new TextEncoder().encode(exactPrepared.requestText)).toHaveLength(
      RISK_UNCERTAINTY_REPLACEMENT_REQUEST_MAX_UTF8_BYTES,
    );

    exact.analysis.method += "x";
    await expectPreflightRefusal(exact);
  });
});

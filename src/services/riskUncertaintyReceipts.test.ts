import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reviewRiskUncertaintyAnalysis,
  submitRiskUncertaintyAnalysis,
  type RiskUncertaintySubmission,
} from "./riskOperatingService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const riskId = "a1820000-0000-4000-8000-000000000002";
const analysisId = "a1820000-0000-4000-8000-000000000010";
const otherId = "a1820000-0000-4000-8000-000000000011";
const analysisDigest = "a".repeat(64);
const context = { riskId, analysisDigest };
const submission = {} as RiskUncertaintySubmission;
const submitted = {
  riskId,
  analysisId,
  version: 1,
  analysisDigest,
  validationStatus: "pending_review",
  valueOfInformation: {
    expectedValue: 37500,
    netValue: 27500,
    recommendation: "GATHER_INFORMATION",
  },
  operationalAuthorization: false,
};
const reviewed = {
  riskId,
  analysisId,
  analysisDigest,
  decision: "validated",
  approvalId: "a1820000-0000-4000-8000-000000000012",
  derivedEvidenceItemId: "a1820000-0000-4000-8000-000000000013",
  operationalAuthorization: false,
};

beforeEach(() => {
  rpc.mockReset();
});

describe("uncertainty acknowledgement qualification", () => {
  it("retains the complete canonical submission receipt", async () => {
    rpc.mockResolvedValue({ data: submitted, error: null });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).resolves.toEqual(submitted);
  });

  it.each([0, -2])(
    "retains a coherent non-positive VOI receipt (%s)",
    async (netValue) => {
      const receipt = {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue,
          recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
        },
      };
      rpc.mockResolvedValue({ data: receipt, error: null });
      await expect(
        submitRiskUncertaintyAnalysis(riskId, submission, []),
      ).resolves.toEqual(receipt);
    },
  );

  it.each(
    [
      null,
      {},
      [],
      { error: "" },
      { ...submitted, riskId: otherId },
      { ...submitted, analysisId: "not-an-id" },
      { ...submitted, analysisDigest: "" },
      { ...submitted, version: 0 },
      { ...submitted, version: Number.MAX_SAFE_INTEGER + 1 },
      { ...submitted, validationStatus: "validated" },
      { ...submitted, operationalAuthorization: true },
      { ...submitted, valueOfInformation: null },
      {
        ...submitted,
        valueOfInformation: { ...submitted.valueOfInformation, netValue: NaN },
      },
      {
        ...submitted,
        valueOfInformation: {
          ...submitted.valueOfInformation,
          recommendation: "APPROVE_SPEND",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: -2,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 2,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 0,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 1,
          recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
        },
      },
    ].map((data) => [data]),
  )(
    "does not report a partial or mismatched submission as success: %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        submitRiskUncertaintyAnalysis(riskId, submission, []),
      ).rejects.toThrow();
    },
  );

  it("retains the complete review receipt bound to the selected packet", async () => {
    rpc.mockResolvedValue({ data: reviewed, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "validated",
        "Independent frozen packet review.",
        context,
      ),
    ).resolves.toEqual(reviewed);
  });

  it.each(
    [
      {},
      [],
      { error: "" },
      { ...reviewed, riskId: otherId },
      { ...reviewed, analysisId: otherId },
      { ...reviewed, analysisDigest: "b".repeat(64) },
      { ...reviewed, decision: "rejected" },
      { ...reviewed, approvalId: null },
      { ...reviewed, derivedEvidenceItemId: null },
      { ...reviewed, operationalAuthorization: "false" },
    ].map((data) => [data]),
  )("does not record an incomplete or different review: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "validated",
        "Independent frozen packet review.",
        context,
      ),
    ).rejects.toThrow();
  });

  it("permits a complete rejected review only without derived validated evidence", async () => {
    const rejected = {
      ...reviewed,
      decision: "rejected",
      derivedEvidenceItemId: null,
    };
    rpc.mockResolvedValue({ data: rejected, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "rejected",
        "Independent frozen packet rejection.",
        context,
      ),
    ).resolves.toEqual(rejected);
  });

  it("classifies a lost acknowledgement as unknown rather than a safe retry", async () => {
    rpc.mockRejectedValue(new Error("connection lost after dispatch"));
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toMatchObject({ outcomeUnknown: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not treat identity-bearing error data as a qualified refusal", async () => {
    rpc.mockResolvedValue({
      data: { error: "Denied", analysisId },
      error: null,
    });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toMatchObject({ outcomeUnknown: true });
  });

  it("retains a plain explicit server refusal without a success identity", async () => {
    rpc.mockResolvedValue({
      data: { error: "Archived risks cannot receive a packet" },
      error: null,
    });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toThrow("Archived risks");
  });
});

import { describe, expect, it } from "vitest";
import type { OpenVerification } from "../../services/operatingLoopService";
import {
  findOpenVerification,
  optionalRecommendationId,
  recommendationScopedOpen,
} from "./conversation-learn";

const rec: OpenVerification = {
  obligationId: "obl-rec",
  recommendationTitle: "Replace seal",
  assetName: "P-101",
  method: "Leak rate after 48h",
  dueDate: "2026-09-15",
  dueDateAssumed: true,
  daysOverdue: 0,
  intendedOutcome: "Leak stopped",
  subjectKind: "recommendation",
};

const req: OpenVerification = {
  ...rec,
  obligationId: "obl-req",
  recommendationTitle: "Seal leakage criterion",
  subjectKind: "requirement",
  requirementRef: "REQ-1",
};

describe("conversation LEARN targeting", () => {
  it("keeps recommendation-scoped obligations and drops requirement ones", () => {
    expect(
      recommendationScopedOpen([rec, req]).map((row) => row.obligationId),
    ).toEqual(["obl-rec"]);
  });

  it("treats a missing subjectKind as recommendation-scoped (pre-5A rows)", () => {
    const legacy = { ...rec, subjectKind: undefined };
    expect(recommendationScopedOpen([legacy])).toEqual([legacy]);
  });

  it("finds the bound obligation by id", () => {
    expect(findOpenVerification([rec, req], "obl-rec")).toBe(rec);
    expect(findOpenVerification([rec], "missing")).toBeUndefined();
  });

  it("reads a bound recommendation id without requiring DecisionCase to declare it", () => {
    expect(optionalRecommendationId({})).toBeNull();
    expect(optionalRecommendationId({ recommendationId: "  rec-1  " })).toBe(
      "rec-1",
    );
    expect(optionalRecommendationId({ recommendationId: "   " })).toBeNull();
  });
});

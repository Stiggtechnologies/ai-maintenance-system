import { describe, expect, it } from "vitest";
import {
  assessContract,
  assessPosture,
  CONTRACT,
  type RecommendationRecord,
} from "./index";

const complete = (
  o: Partial<RecommendationRecord> = {},
): RecommendationRecord => ({
  id: "r1",
  title: "Replace undercarriage rollers",
  assetId: "a1",
  issue: "Roller tread diameter below limit on three positions",
  rationale:
    "Measured at 2026-07 inspection; wear rate trending above fleet median",
  failureMode: "Roller seizure",
  consequenceSummary:
    "Track derailment risk; 18h unplanned outage if it fails in service",
  action: "Replace rollers 3, 4 and 7 at next planned shutdown",
  alternativesConsidered:
    "Run to failure rejected — consequence exceeds tolerance. Rotation deferred: no spare positions.",
  confidence: 0.8,
  requiredApproverRole: "maintenance_manager",
  requiredCompletionDate: "2026-09-14",
  verificationMethod:
    "Re-measure tread diameter at 500h; confirm no repeat within 2000h",
  ...o,
});

describe("assessContract", () => {
  it("releases a complete recommendation", () => {
    const r = assessContract(complete());
    expect(r.releasable).toBe(true);
    expect(r.completeness).toBe(1);
    expect(r.missingBlocking).toHaveLength(0);
  });

  it("blocks on each of the four fields that were never populated in production", () => {
    // These are the real C8 gaps: 0, 0, 0 and 1 populated across 70 rows.
    for (const [field, register] of [
      ["consequenceSummary", "C8.15"],
      ["alternativesConsidered", "C8.17"],
      ["requiredCompletionDate", "C8.18"],
      ["verificationMethod", "C8.21"],
    ] as const) {
      const r = assessContract(complete({ [field]: null }));
      expect(r.releasable, `${field} should block release`).toBe(false);
      expect(r.missingBlocking.map((f) => f.register)).toContain(register);
    }
  });

  it("does not block on a failure mode, because not every recommendation has one", () => {
    const r = assessContract(complete({ failureMode: null }));
    expect(r.releasable).toBe(true);
    expect(r.missingAdvisory.map((f) => f.register)).toEqual(["C8.14"]);
    expect(r.reason).toMatch(/does not block release/);
  });

  it("treats whitespace as absent", () => {
    // A field filled with a space passes a NOT NULL constraint and answers
    // nothing, which is the commonest way a contract field gets defeated.
    const r = assessContract(complete({ verificationMethod: "   " }));
    expect(r.releasable).toBe(false);
  });

  it("accepts a confidence of zero as stated rather than missing", () => {
    // 0 is falsy and is a real, meaningful confidence — "we are not confident"
    // is information, and a naive truthiness check would delete it.
    const r = assessContract(complete({ confidence: 0 }));
    expect(r.releasable).toBe(true);
    expect(r.presentFields).toContain("confidence");
  });

  it("refuses to let completeness stand in for the gate", () => {
    const r = assessContract(
      complete({
        consequenceSummary: null,
        alternativesConsidered: null,
        requiredCompletionDate: null,
        verificationMethod: null,
      }),
    );
    // Seven of eleven present reads as 64% — comfortably a pass on any score,
    // and missing exactly the four things an approver cannot supply themselves.
    expect(r.completeness).toBeCloseTo(7 / 11, 6);
    expect(r.releasable).toBe(false);
    expect(r.reason).toMatch(/do not become acceptable by being outnumbered/);
  });

  it("explains why each missing field matters, not just that it is missing", () => {
    const r = assessContract(complete({ requiredCompletionDate: null }));
    expect(r.reason).toMatch(/never be overdue/);
  });
});

describe("assessPosture", () => {
  it("names fields populated on nothing as schema rather than capability", () => {
    // The real production shape: the four fields exist and nobody fills them.
    const population = Array.from({ length: 70 }, (_, i) =>
      complete({
        id: `r${i}`,
        consequenceSummary: null,
        alternativesConsidered: null,
        requiredCompletionDate: null,
        verificationMethod: null,
        requiredApproverRole: null,
      }),
    );
    const p = assessPosture(population);
    expect(p.releasable).toBe(0);
    expect(p.neverPopulated.map((f) => f.register).sort()).toEqual([
      "C8.15",
      "C8.17",
      "C8.18",
      "C8.20",
      "C8.21",
    ]);
    expect(p.reason).toMatch(/schema, not capability/);
  });

  it("sorts the coverage table worst-first so the gaps lead", () => {
    const p = assessPosture([
      complete({ id: "a" }),
      complete({ id: "b", verificationMethod: null }),
      complete({ id: "c", verificationMethod: null }),
    ]);
    expect(p.fieldCoverage[0].key).toBe("verification");
    expect(p.fieldCoverage[0].share).toBeCloseTo(1 / 3, 6);
  });

  it("does not read an empty population as a clean contract", () => {
    const p = assessPosture([]);
    expect(p.reason).toMatch(/absence of evidence, not a clean contract/);
  });

  it("keeps the contract and the register in step", () => {
    // Every field carries the register item it satisfies, so a change here is
    // visible against the register rather than drifting from it.
    expect(CONTRACT).toHaveLength(11);
    expect(new Set(CONTRACT.map((f) => f.register)).size).toBe(11);
  });
});

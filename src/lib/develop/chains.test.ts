/**
 * Slice 3C — the pure side of the chains.
 *
 * The §46 calculation is a DELIBERATE MIRROR of compute_evidence_confidence
 * (20261122090600); these tests pin the behaviour that matters most about
 * it — that it REFUSES rather than inventing a factor — plus the arithmetic
 * and the decay. The live SQL side is proven by
 * scripts/ci-develop-slice3c-smoke.sh against a real database, and
 * developSlice3cChainsMigration.test.ts pins the two to the same factor set.
 */
import { describe, expect, it } from "vitest";
import {
  APPLICABILITY_GRADES,
  CONTROL_EFFECTIVENESS_VALUES,
  OBLIGATION_DESTINATION,
  OBLIGATION_DOMAINS,
  QUALITY_GRADES,
  TREATMENT_STRATEGIES,
  blockingCommitments,
  coverageHeadline,
  evidenceConfidence,
  type CommitmentCoverage,
  type EvidenceConfidenceWeights,
} from "./chains";

const weights: EvidenceConfidenceWeights = {
  quality: { high: 1, moderate: 0.7, low: 0.4 },
  applicability: { direct: 1, analogous: 0.7, indirect: 0.4 },
  verification: { verified: 1, unverified: 0.6, rejected: 0 },
  freshness: {
    MEASURED: { halfLifeDays: 90, floor: 0.2 },
    DOCUMENTED: { halfLifeDays: 1095, floor: 0.4 },
  },
};

const NOW = new Date("2026-08-28T00:00:00Z");

describe("evidence confidence (§46) — EC = Q × A × F × V", () => {
  it("multiplies the four factors from the adopted weight set", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        // Exactly one half-life old: F = 0.5.
        observedAt: "2026-05-30T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factors.quality).toBe(1);
    expect(result.factors.applicability).toBe(1);
    expect(result.factors.freshness).toBeCloseTo(0.5, 2);
    expect(result.factors.verification).toBe(1);
    expect(result.evidenceConfidence).toBeCloseTo(0.5, 2);
  });

  it("decays freshness on the class's own half-life and never below its floor", () => {
    const ancient = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        observedAt: "2016-01-01T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(ancient.ok).toBe(true);
    if (!ancient.ok) return;
    // 0.5^(≈3800/90) is astronomically small; the floor holds it at 0.2.
    expect(ancient.factors.freshness).toBe(0.2);

    // The same age against a slower-ageing class scores higher — the point
    // of a per-class policy.
    const documented = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "DOCUMENTED",
        observedAt: "2024-08-28T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(documented.ok).toBe(true);
    if (!documented.ok) return;
    expect(documented.factors.freshness).toBeGreaterThan(0.2);
  });

  it("REFUSES and names the factor when quality is ungraded — never a midpoint", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: null,
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        observedAt: "2026-08-01T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFactors).toHaveLength(1);
    expect(result.missingFactors[0]).toContain("quality (Q)");
    // The refusal must not smuggle a number out anyway.
    expect(result).not.toHaveProperty("evidenceConfidence");
  });

  it("names EVERY missing factor, not just the first", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: null,
        applicabilityGrade: null,
        evidenceClass: null,
        observedAt: null,
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFactors).toHaveLength(3);
    expect(result.missingFactors.join(" ")).toContain("quality (Q)");
    expect(result.missingFactors.join(" ")).toContain("applicability (A)");
    expect(result.missingFactors.join(" ")).toContain("freshness (F)");
  });

  it("refuses when the adopted weight set has no policy for the evidence class", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "AI_INFERENCE",
        observedAt: "2026-08-01T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFactors[0]).toContain("AI_INFERENCE");
  });

  it("refuses an unscored verification status rather than treating it as zero", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        observedAt: "2026-08-01T00:00:00Z",
        verificationStatus: "quarantined",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingFactors[0]).toContain("verification (V)");
  });

  it("scores a rejected item at zero — a stated position, NOT a refusal", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        observedAt: "2026-08-27T00:00:00Z",
        verificationStatus: "rejected",
        now: NOW,
      },
      weights,
    );
    // The distinction this test exists to hold: EC = 0 ("examined and
    // rejected") and "EC cannot be computed" are DIFFERENT facts, and the
    // adopted profile scores rejected at 0 deliberately. A guard that
    // treated 0 as unscored would make this lib refuse exactly where
    // compute_evidence_confidence returns zero — the same inputs answered
    // two ways, which is the drift the mirror exists to prevent.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.factors.verification).toBe(0);
    expect(result.evidenceConfidence).toBe(0);
  });

  it("floors age at zero for evidence stamped in the future rather than inflating F above 1", () => {
    const result = evidenceConfidence(
      {
        qualityGrade: "high",
        applicabilityGrade: "direct",
        evidenceClass: "MEASURED",
        observedAt: "2027-01-01T00:00:00Z",
        verificationStatus: "verified",
        now: NOW,
      },
      weights,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ageDays).toBe(0);
    expect(result.factors.freshness).toBe(1);
  });
});

describe("commitment coverage (D3.09)", () => {
  const base: CommitmentCoverage = {
    caseId: "c",
    commitmentsTotal: 0,
    uncoveredCount: 0,
    coveragePct: null,
    uncoveredCommitments: [],
    coveredCommitments: [],
    requirementsWithoutCommitment: [],
  };

  it("says nothing to report over an empty set rather than claiming 100%", () => {
    expect(coverageHeadline(base)).toContain("No stakeholder commitments");
  });

  it("names the gap in the spec's own terms", () => {
    const coverage: CommitmentCoverage = {
      ...base,
      commitmentsTotal: 3,
      uncoveredCount: 1,
      coveragePct: 66.7,
    };
    expect(coverageHeadline(coverage)).toBe(
      "1 of 3 commitments have no corresponding project requirement.",
    );
  });

  it("blocks only on the OVERDUE uncovered subset — the same set the gate refuses over", () => {
    const coverage: CommitmentCoverage = {
      ...base,
      commitmentsTotal: 2,
      uncoveredCount: 2,
      coveragePct: 0,
      uncoveredCommitments: [
        {
          commitmentId: 1,
          commitmentRef: "C-1",
          stakeholder: "Community",
          kind: "community",
          concern: "dust",
          commitment: "quarterly monitoring",
          owner: null,
          dueDate: "2026-01-01",
          status: "breached",
          overdue: true,
        },
        {
          commitmentId: 2,
          commitmentRef: "C-2",
          stakeholder: "Community",
          kind: "community",
          concern: "noise",
          commitment: "berm",
          owner: null,
          dueDate: "2027-01-01",
          status: "open",
          overdue: false,
        },
      ],
    };
    const blocking = blockingCommitments(coverage);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].commitmentRef).toBe("C-1");
  });
});

describe("vocabularies shared with the database", () => {
  it("carries spec I.19's five obligation domains and a destination for each", () => {
    expect(OBLIGATION_DOMAINS.map((d) => d.value)).toEqual([
      "engineering",
      "construction",
      "operating_procedure",
      "monitoring",
      "reporting",
    ]);
    for (const d of OBLIGATION_DOMAINS) {
      expect(OBLIGATION_DESTINATION[d.value]).toBeTruthy();
    }
    // Engineering and construction land on the project requirement; the
    // three operational domains land in operations. D3.11's whole routing.
    expect(OBLIGATION_DESTINATION.engineering).toBe("project requirement");
    expect(OBLIGATION_DESTINATION.construction).toBe("project requirement");
    expect(OBLIGATION_DESTINATION.monitoring).toBe("operations work order");
  });

  it("carries spec §14's two-dimension vocabulary and §15's seven strategies", () => {
    expect(CONTROL_EFFECTIVENESS_VALUES).toEqual([
      "effective",
      "partially_effective",
      "ineffective",
      "not_assessed",
    ]);
    expect(TREATMENT_STRATEGIES).toHaveLength(7);
    expect(TREATMENT_STRATEGIES).toContain("pursue_opportunity");
  });

  it("carries §46's factor grades", () => {
    expect(QUALITY_GRADES).toEqual(["high", "moderate", "low"]);
    expect(APPLICABILITY_GRADES).toEqual(["direct", "analogous", "indirect"]);
  });
});

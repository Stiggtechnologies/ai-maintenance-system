/**
 * Sync Develop pure-lib tests: the rollup is assessGate's verdict, never a
 * second evaluator. The cases mirror assessGate's own discipline — silence
 * blocks, not-assessed blocks, advisory does not.
 */
import { describe, expect, it } from "vitest";
import {
  GATE_OUTCOMES,
  LIFECYCLE_TYPES,
  SOURCE_AUTHORITY_TIERS,
  gateRollup,
  isPassingOutcome,
  isTerminalOutcome,
  type WorkspaceGate,
} from "./index";

function gate(overrides: Partial<WorkspaceGate> = {}): WorkspaceGate {
  return {
    id: 1,
    name: "G3 — Sanction readiness",
    sequence: 1,
    decisionType: "gate",
    independentAssuranceRequired: true,
    readinessThreshold: 80,
    criteria: [
      {
        id: 11,
        criterion: "Scope definition is complete enough to estimate against",
        isMandatory: true,
        guidance: null,
        category: "technical",
        evidenceType: "DOCUMENTED",
        minimumConfidence: null,
        weight: 1.0,
        sourceAuthority: "INDUSTRY_GUIDANCE",
      },
      {
        id: 12,
        criterion: "Long-lead procurement risk has been considered",
        isMandatory: false,
        guidance: null,
        category: "supply",
        evidenceType: "DOCUMENTED",
        minimumConfidence: null,
        weight: 1.0,
        sourceAuthority: "AI_SUGGESTION",
      },
    ],
    latestReview: null,
    ...overrides,
  };
}

describe("gateRollup", () => {
  it("a gate with no review is NOT partially ready — silence blocks", () => {
    const r = gateRollup(gate());
    expect(r.hasReview).toBe(false);
    expect(r.assessment.ready).toBe(false);
    expect(r.assessment.missingFindings).toContain(
      "Scope definition is complete enough to estimate against",
    );
  });

  it("an explicit met finding on every mandatory criterion is ready", () => {
    const r = gateRollup(
      gate({
        latestReview: {
          id: 5,
          outcome: "proceed",
          reviewedAt: "2026-08-27T00:00:00Z",
          note: "basis",
          findings: [
            {
              criterion:
                "Scope definition is complete enough to estimate against",
              status: "met",
              evidence: "Scope book rev C",
            },
          ],
          conditions: [],
        },
      }),
    );
    expect(r.assessment.ready).toBe(true);
    expect(r.assessment.advisoryOutstanding).toHaveLength(1);
    expect(r.latestOutcome).toBe("proceed");
  });

  it("not_assessed blocks exactly like not_met", () => {
    const r = gateRollup(
      gate({
        latestReview: {
          id: 6,
          outcome: "hold",
          reviewedAt: "2026-08-27T00:00:00Z",
          note: "basis",
          findings: [
            {
              criterion:
                "Scope definition is complete enough to estimate against",
              status: "not_assessed",
              evidence: null,
            },
          ],
          conditions: [],
        },
      }),
    );
    expect(r.assessment.ready).toBe(false);
    expect(r.assessment.notAssessed).toHaveLength(1);
  });

  it("a gate with zero criteria is unready by assessGate's own rule", () => {
    const r = gateRollup(gate({ criteria: [] }));
    expect(r.assessment.ready).toBe(false);
    expect(r.assessment.reason).toContain("No gate criteria are defined");
  });

  it("counts mandatory separately from total", () => {
    const r = gateRollup(gate());
    expect(r.criteriaTotal).toBe(2);
    expect(r.mandatoryTotal).toBe(1);
  });
});

describe("vocabularies", () => {
  it("carries the reconciled eight-outcome union (I.5 ∪ §6)", () => {
    expect(GATE_OUTCOMES.map((o) => o.value)).toEqual([
      "proceed",
      "proceed_with_conditions",
      "hold",
      "recycle",
      "pivot",
      "redesign",
      "pause",
      "terminate",
    ]);
  });

  it("carries the nine §3 lifecycle types", () => {
    expect(LIFECYCLE_TYPES).toHaveLength(9);
    expect(LIFECYCLE_TYPES.map((t) => t.value)).toContain("decommissioning");
  });

  it("carries the eight-tier provenance ladder in descending authority", () => {
    expect(SOURCE_AUTHORITY_TIERS).toEqual([
      "LAW",
      "REGULATION",
      "CORPORATE_STANDARD",
      "PROJECT_FRAMEWORK",
      "CONTRACT",
      "INDUSTRY_GUIDANCE",
      "BEST_PRACTICE",
      "AI_SUGGESTION",
    ]);
  });

  it("passing and terminal outcome predicates", () => {
    expect(isPassingOutcome("proceed")).toBe(true);
    expect(isPassingOutcome("proceed_with_conditions")).toBe(true);
    expect(isPassingOutcome("hold")).toBe(false);
    expect(isTerminalOutcome("terminate")).toBe(true);
    expect(isTerminalOutcome("pause")).toBe(false);
  });
});

describe("gateRollup carries the D3.35 readiness beside the verdict", () => {
  it("readiness is gateReadiness over the same criteria+findings — same block, now with the number", () => {
    const r = gateRollup(
      gate({
        latestReview: {
          id: 9,
          outcome: "hold",
          reviewedAt: "2026-08-27T00:00:00Z",
          note: "basis",
          findings: [
            {
              criterion:
                "Scope definition is complete enough to estimate against",
              status: "met",
              evidence: "Scope book rev C",
            },
          ],
          conditions: [],
        },
      }),
    );
    // Mandatory met, advisory not: 1 of 2 equal-weight criteria → 50%.
    expect(r.readiness.readinessPct).toBe(50);
    expect(r.readiness.blocked).toBe(!r.assessment.ready);
    expect(r.readiness.categories.map((c) => c.category)).toEqual([
      "technical",
      "supply",
    ]);
  });

  it("an empty gate rolls up with NULL readiness — no invented number", () => {
    const r = gateRollup(gate({ criteria: [] }));
    expect(r.readiness.readinessPct).toBeNull();
    expect(r.readiness.blocked).toBe(true);
  });
});

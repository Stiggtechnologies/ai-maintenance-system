import { describe, expect, it } from "vitest";
import {
  buildContractStrategyPrompts,
  CONTRACT_STRATEGIES,
  CONTRACT_STRATEGY_DIMENSIONS,
  parseContractStrategyAdvice,
  validateContractStrategyAssessment,
} from "../../../supabase/functions/_shared/develop-contract-strategy-core";

const assessment = Object.fromEntries(
  CONTRACT_STRATEGY_DIMENSIONS.map((dimension) => [
    dimension,
    {
      level: "medium",
      basis: `A substantive recorded basis for ${dimension}.`,
      evidenceItemId: `evidence-${dimension}`,
    },
  ]),
);

describe("contract strategy agent core", () => {
  it("requires every I.17 factor with basis and evidence", () => {
    expect(validateContractStrategyAssessment(assessment).ok).toBe(true);
    const incomplete = { ...assessment };
    delete incomplete.risk_allocation;
    expect(validateContractStrategyAssessment(incomplete)).toEqual({
      ok: false,
      refusal: "risk_allocation is not assessed",
    });
  });

  it("grounds the prompt in all seven strategies and six factors", () => {
    const valid = validateContractStrategyAssessment(assessment);
    if (!valid.ok) throw new Error(valid.refusal);
    const prompts = buildContractStrategyPrompts({
      caseTitle: "Expansion",
      assessment: valid.assessment,
      evidence: [
        {
          id: "evidence-definition_maturity",
          description: "Issued scope maturity review",
          evidenceClass: "DOCUMENTARY",
          dataQuality: "good",
          verificationStatus: "verified",
          sourceSystem: "document_control",
          sourceReference: "DC-42",
        },
      ],
    });
    for (const strategy of CONTRACT_STRATEGIES)
      expect(prompts.userContent).toContain(strategy);
    for (const dimension of CONTRACT_STRATEGY_DIMENSIONS)
      expect(prompts.userContent).toContain(dimension);
    expect(prompts.userContent).toContain("Issued scope maturity review");
    expect(prompts.systemPrompt).toContain("Do not award a contract");
  });

  it("refuses a response that silently omits an alternative", () => {
    const evaluations = CONTRACT_STRATEGIES.slice(0, -1).map((strategy) => ({
      strategy,
      fit: "conditional",
      reason: "The recorded factors make this a conditional alternative.",
    }));
    expect(
      parseContractStrategyAdvice(
        JSON.stringify({
          recommendedStrategy: "epcm",
          rationale:
            "The recorded maturity, uncertainty, capability and interfaces support this recommendation for human review.",
          limitations: "Market evidence must be refreshed before tender.",
          evaluations,
        }),
      ),
    ).toEqual({
      ok: false,
      refusal:
        "the model did not evaluate each of the seven strategies exactly once",
    });
  });

  it("accepts only a complete controlled recommendation", () => {
    const evaluations = CONTRACT_STRATEGIES.map((strategy) => ({
      strategy,
      fit: strategy === "epcm" ? "strong" : "conditional",
      reason:
        "The supplied six-factor evidence supports this stated comparative position.",
    }));
    const result = parseContractStrategyAdvice(
      JSON.stringify({
        recommendedStrategy: "epcm",
        rationale:
          "The recorded maturity, uncertainty, capability and interfaces support this recommendation for human review.",
        limitations: "Market evidence must be refreshed before tender.",
        evaluations,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.advice.evaluations).toHaveLength(7);
  });
});

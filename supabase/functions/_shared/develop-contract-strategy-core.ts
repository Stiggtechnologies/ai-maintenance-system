export const CONTRACT_STRATEGIES = [
  "lump_sum",
  "unit_rate",
  "epc",
  "epcm",
  "alliance",
  "owner_executed",
  "performance_contract",
] as const;

export type ContractStrategy = (typeof CONTRACT_STRATEGIES)[number];

export const CONTRACT_STRATEGY_DIMENSIONS = [
  "definition_maturity",
  "uncertainty",
  "market_conditions",
  "owner_capability",
  "interface_complexity",
  "risk_allocation",
] as const;

export type ContractStrategyDimension =
  (typeof CONTRACT_STRATEGY_DIMENSIONS)[number];
export type AssessmentLevel = "low" | "medium" | "high";

export interface ContractStrategyFactor {
  level: AssessmentLevel;
  basis: string;
  evidenceItemId: string;
}

export type ContractStrategyAssessment = Record<
  ContractStrategyDimension,
  ContractStrategyFactor
>;

export interface ContractStrategyEvaluation {
  strategy: ContractStrategy;
  fit: "strong" | "conditional" | "weak";
  reason: string;
}

export interface ContractStrategyAdvice {
  recommendedStrategy: ContractStrategy;
  rationale: string;
  limitations: string;
  evaluations: ContractStrategyEvaluation[];
}

export type AssessmentValidation =
  | { ok: true; assessment: ContractStrategyAssessment }
  | { ok: false; refusal: string };

export function validateContractStrategyAssessment(
  input: unknown,
): AssessmentValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, refusal: "the six-factor assessment is required" };
  }
  const record = input as Record<string, unknown>;
  const unexpected = Object.keys(record).filter(
    (key) =>
      !CONTRACT_STRATEGY_DIMENSIONS.includes(key as ContractStrategyDimension),
  );
  if (unexpected.length > 0) {
    return {
      ok: false,
      refusal: `unknown assessment dimension(s): ${unexpected.join(", ")}`,
    };
  }
  const result = {} as ContractStrategyAssessment;
  for (const dimension of CONTRACT_STRATEGY_DIMENSIONS) {
    const raw = record[dimension];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, refusal: `${dimension} is not assessed` };
    }
    const factor = raw as Record<string, unknown>;
    const level = String(factor.level ?? "") as AssessmentLevel;
    const basis = String(factor.basis ?? "").trim();
    const evidenceItemId = String(factor.evidenceItemId ?? "").trim();
    if (!(["low", "medium", "high"] as string[]).includes(level)) {
      return { ok: false, refusal: `${dimension} must be low, medium or high` };
    }
    if (basis.length < 20) {
      return {
        ok: false,
        refusal: `${dimension} requires a stated basis of at least 20 characters`,
      };
    }
    if (!evidenceItemId) {
      return {
        ok: false,
        refusal: `${dimension} requires a canonical evidence item`,
      };
    }
    result[dimension] = { level, basis, evidenceItemId };
  }
  return { ok: true, assessment: result };
}

export function buildContractStrategyPrompts(input: {
  caseTitle: string;
  assessment: ContractStrategyAssessment;
  evidence: {
    id: string;
    description: string | null;
    evidenceClass: string | null;
    dataQuality: string | null;
    verificationStatus: string | null;
    sourceSystem: string | null;
    sourceReference: string | null;
  }[];
}): { systemPrompt: string; userContent: string } {
  return {
    systemPrompt:
      "You are SyncAI's contract-strategy advisory agent. Evaluate exactly the seven allowed strategies against exactly the six supplied factors. Use only supplied levels, bases and evidence identifiers. Do not award a contract, select a bidder, accept risk, commit spend or claim legal compliance. Return JSON only: recommendedStrategy, rationale, limitations, evaluations. evaluations must contain each allowed strategy exactly once with strategy, fit (strong|conditional|weak), and reason.",
    userContent: JSON.stringify({
      caseTitle: input.caseTitle,
      allowedStrategies: CONTRACT_STRATEGIES,
      factors: input.assessment,
      evidence: input.evidence,
      requiredDecisionBoundary:
        "Advisory recommendation only; a named human decides and any award remains in the governed procurement workflow.",
    }),
  };
}

export type AdviceParseResult =
  { ok: true; advice: ContractStrategyAdvice } | { ok: false; refusal: string };

export function parseContractStrategyAdvice(
  content: string,
): AdviceParseResult {
  let raw: Record<string, unknown>;
  try {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    raw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { ok: false, refusal: "the model response was not valid JSON" };
  }
  const recommendedStrategy = String(
    raw.recommendedStrategy ?? "",
  ) as ContractStrategy;
  if (!CONTRACT_STRATEGIES.includes(recommendedStrategy)) {
    return {
      ok: false,
      refusal: "the model recommended an unknown contract strategy",
    };
  }
  const rationale = String(raw.rationale ?? "").trim();
  const limitations = String(raw.limitations ?? "").trim();
  if (rationale.length < 50 || limitations.length < 20) {
    return {
      ok: false,
      refusal:
        "the recommendation did not state a substantive rationale and limitations",
    };
  }
  if (!Array.isArray(raw.evaluations)) {
    return {
      ok: false,
      refusal: "the model did not evaluate all seven strategies",
    };
  }
  const evaluations: ContractStrategyEvaluation[] = [];
  for (const entry of raw.evaluations) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, refusal: "a strategy evaluation was malformed" };
    }
    const row = entry as Record<string, unknown>;
    const strategy = String(row.strategy ?? "") as ContractStrategy;
    const fit = String(row.fit ?? "") as ContractStrategyEvaluation["fit"];
    const reason = String(row.reason ?? "").trim();
    if (
      !CONTRACT_STRATEGIES.includes(strategy) ||
      !["strong", "conditional", "weak"].includes(fit) ||
      reason.length < 20
    ) {
      return {
        ok: false,
        refusal:
          "a strategy evaluation was outside the controlled vocabulary or lacked a basis",
      };
    }
    evaluations.push({ strategy, fit, reason });
  }
  const seen = new Set(evaluations.map((entry) => entry.strategy));
  if (
    evaluations.length !== CONTRACT_STRATEGIES.length ||
    seen.size !== CONTRACT_STRATEGIES.length ||
    CONTRACT_STRATEGIES.some((strategy) => !seen.has(strategy))
  ) {
    return {
      ok: false,
      refusal:
        "the model did not evaluate each of the seven strategies exactly once",
    };
  }
  return {
    ok: true,
    advice: { recommendedStrategy, rationale, limitations, evaluations },
  };
}

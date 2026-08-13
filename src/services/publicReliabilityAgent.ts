import { supabase } from "../lib/supabase";
import type { DecisionCase } from "../lib/decision-case";
import type { PublicReliabilityScenarioId } from "../lib/public-reliability";

export interface PublicExpertHypothesis {
  hypothesis: string;
  evidenceFor: string;
  verification: string;
  confidence: "low" | "medium" | "high";
}

export interface PublicExpertAction {
  action: string;
  owner: string;
  timeWindow: string;
  verification: string;
  approvalRequired: boolean;
}

export interface PublicExpertCitation {
  title: string;
  pageRange: string;
}

export interface PublicExpertAnalysis {
  executiveSummary: string;
  observedPattern: string;
  ramInterpretation: string;
  riskExposure: string;
  financialImpact: string;
  confidence: "low" | "medium" | "high";
  hypotheses: PublicExpertHypothesis[];
  actions: PublicExpertAction[];
  evidenceGaps: string[];
  bottomLine: string;
  citations: PublicExpertCitation[];
}

export type PublicExpertResult =
  | { status: "success"; analysis: PublicExpertAnalysis; modelUsed?: string }
  | { status: "rate_limited"; error: string; resetsAt?: string }
  | { status: "fallback"; error: string };

export interface PublicDecisionCitation {
  title: string;
  pageRange: string;
  documentClass: string;
  label: string;
}

export type PublicDecisionCaseAgentResult =
  | {
      status: "success";
      response: string;
      citations: PublicDecisionCitation[];
      knowledgeBaseUsed: boolean;
      modelUsed?: string;
    }
  | { status: "rate_limited"; error: string; resetsAt?: string }
  | { status: "fallback"; error: string };

const BROWSER_ID_KEY = "syncai-public-browser-id-v1";

function getBrowserId(): string {
  try {
    const existing = window.localStorage.getItem(BROWSER_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(BROWSER_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export async function runPublicReliabilityAgent(input: {
  scenarioId: PublicReliabilityScenarioId;
  question: string;
}): Promise<PublicExpertResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "public-reliability-agent",
      {
        body: {
          scenarioId: input.scenarioId,
          question: input.question.trim().slice(0, 1600),
          browserId: getBrowserId(),
        },
      },
    );

    if (data?.error === "public_reliability_limit_reached") {
      return {
        status: "rate_limited",
        error:
          "The included live assessment has already been used for this access window.",
        resetsAt: data.resetsAt,
      };
    }
    if (error || !data?.success || !data?.analysis) {
      return {
        status: "fallback",
        error:
          error?.message ||
          data?.message ||
          "Live expert review was unavailable.",
      };
    }
    return {
      status: "success",
      analysis: data.analysis as PublicExpertAnalysis,
      modelUsed: data.modelUsed,
    };
  } catch (error) {
    return {
      status: "fallback",
      error:
        error instanceof Error
          ? error.message
          : "Live expert review was unavailable.",
    };
  }
}

export async function runPublicDecisionCaseAgent(
  decisionCase: DecisionCase,
  question: string,
): Promise<PublicDecisionCaseAgentResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "public-reliability-agent",
      {
        body: {
          mode: "decision_case_chat",
          question: question.trim().slice(0, 1600),
          browserId: getBrowserId(),
          caseContext: {
            caseNumber: decisionCase.caseNumber,
            version: decisionCase.version,
            asset: decisionCase.asset,
            objective: decisionCase.objective,
            recommendation: decisionCase.recommendation,
            recommendationDetail: decisionCase.recommendationDetail,
            authorityRole: decisionCase.authorityRole,
            decisionMetrics: decisionCase.decisionMetrics,
            evidence: decisionCase.evidence.map((item) => ({
              title: item.title,
              state: item.state,
              finding: item.finding,
              record: item.record,
            })),
            calculations: decisionCase.calculations.map((item) => ({
              label: item.label,
              formula: item.formula,
              result: item.result,
              assumption: item.assumption,
            })),
            recentMessages: decisionCase.messages.slice(-8).map((item) => ({
              role: item.role,
              text: item.text,
            })),
          },
        },
      },
    );

    if (data?.error === "public_decision_case_limit_reached") {
      return {
        status: "rate_limited",
        error:
          "The included live RAG analysis capacity has been used for this access window.",
        resetsAt: data.resetsAt,
      };
    }
    if (error || !data?.success || typeof data?.response !== "string") {
      return {
        status: "fallback",
        error:
          error?.message ||
          data?.message ||
          "Live RAG analysis was unavailable.",
      };
    }
    return {
      status: "success",
      response: data.response,
      citations: Array.isArray(data.citations)
        ? (data.citations as PublicDecisionCitation[])
        : [],
      knowledgeBaseUsed: data.knowledgeBaseUsed === true,
      modelUsed: data.modelUsed,
    };
  } catch (error) {
    return {
      status: "fallback",
      error:
        error instanceof Error
          ? error.message
          : "Live RAG analysis was unavailable.",
    };
  }
}

import { supabase } from "../lib/supabase";
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

export interface PublicRetrievedSource extends PublicExpertCitation {
  label: string;
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
  | {
    status: "success";
    analysis: PublicExpertAnalysis;
    modelUsed?: string;
    promptVersion?: string;
    knowledgeBaseUsed: boolean;
    retrievedSources: PublicRetrievedSource[];
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
        error: "The included live assessment has already been used for this access window.",
        resetsAt: data.resetsAt,
      };
    }
    if (error || !data?.success || !data?.analysis) {
      return {
        status: "fallback",
        error: error?.message || data?.message || "Live expert review was unavailable.",
      };
    }
    return {
      status: "success",
      analysis: data.analysis as PublicExpertAnalysis,
      modelUsed: data.modelUsed,
      promptVersion: data.promptVersion,
      knowledgeBaseUsed: Boolean(data.knowledgeBaseUsed),
      retrievedSources: Array.isArray(data.retrievedSources)
        ? data.retrievedSources as PublicRetrievedSource[]
        : [],
    };
  } catch (error) {
    return {
      status: "fallback",
      error: error instanceof Error ? error.message : "Live expert review was unavailable.",
    };
  }
}

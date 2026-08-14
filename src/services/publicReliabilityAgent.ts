import type { DecisionCase } from "../lib/decision-case";
import type { PublicReliabilityScenarioId } from "../lib/public-reliability";
import { classifyDecisionQuestionScope } from "../lib/reliability-agent-contract";
import { supabasePublicKey, supabaseUrl } from "../lib/supabase-config";

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
      provider?: string;
      agentType?: string;
      specialists?: string[];
    }
  | { status: "rate_limited"; error: string; resetsAt?: string }
  | { status: "fallback"; error: string };

const BROWSER_ID_KEY = "syncai-public-browser-id-v1";
const PUBLIC_AGENT_TIMEOUT_MS = 85_000;

async function invokePublicReliabilityAgent(body: Record<string, unknown>) {
  if (!supabaseUrl || !supabasePublicKey) {
    return {
      data: null,
      error: new Error("Public reliability agent is not configured."),
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/public-reliability-agent`,
      {
        method: "POST",
        headers: {
          apikey: supabasePublicKey,
          authorization: `Bearer ${supabasePublicKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PUBLIC_AGENT_TIMEOUT_MS),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data && typeof data.message === "string"
          ? data.message
          : `Public reliability agent returned HTTP ${response.status}.`;
      return { data, error: new Error(message) };
    }
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Public reliability agent request failed."),
    };
  }
}

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
    const { data, error } = await invokePublicReliabilityAgent({
      scenarioId: input.scenarioId,
      question: input.question.trim().slice(0, 1600),
      browserId: getBrowserId(),
    });

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
  const questionScope = classifyDecisionQuestionScope(decisionCase, question);
  try {
    const { data, error } = await invokePublicReliabilityAgent({
      mode: "decision_case_chat",
      question: question.trim().slice(0, 2400),
      browserId: getBrowserId(),
      caseContext: {
        caseNumber: decisionCase.caseNumber,
        version: decisionCase.version,
        questionScope,
        industry: decisionCase.industry || "oil-gas",
        organization: decisionCase.organization,
        site: decisionCase.site,
        asset: decisionCase.asset,
        assetContext: decisionCase.assetContext,
        objective: decisionCase.objective,
        risk: decisionCase.risk,
        valueExposure: decisionCase.valueExposure,
        evidenceScore: decisionCase.evidenceScore,
        recommendation: decisionCase.recommendation,
        recommendationDetail: decisionCase.recommendationDetail,
        priorityReason: decisionCase.priorityReason,
        authorityRole: decisionCase.authorityRole,
        decisionMetrics: decisionCase.decisionMetrics,
        evidence: decisionCase.evidence.map((item) => ({
          title: item.title,
          summary: item.summary,
          quality: item.quality,
          state: item.state,
          finding: item.finding,
          record: item.record,
          lineage: item.lineage,
          sourceSystem: item.sourceSystem,
        })),
        calculations: decisionCase.calculations.map((item) => ({
          label: item.label,
          formula: item.formula,
          result: item.result,
          assumption: item.assumption,
        })),
        approvals: decisionCase.approvals.map((item) => ({
          name: item.name,
          role: item.role,
          responsibility: item.responsibility,
          status: item.status,
        })),
        workPackage: {
          number: decisionCase.workPackage.number,
          title: decisionCase.workPackage.title,
          targetSystem: decisionCase.workPackage.targetSystem,
          status: decisionCase.workPackage.status,
          controls: decisionCase.workPackage.controls.map((item) => ({
            text: item.text,
            owner: item.owner,
            status: item.status,
          })),
        },
        valueMetrics: decisionCase.valueMetrics.map((item) => ({
          label: item.label,
          detail: item.detail,
          baseline: item.baseline,
          target: item.target,
          actual: item.actual || "",
        })),
        financeStatus: decisionCase.financeStatus,
        recentMessages: decisionCase.messages.slice(-12).map((item) => ({
          role: item.role,
          text: item.text,
        })),
      },
    });

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
      provider: data.provider,
      agentType: data.agentType,
      specialists: Array.isArray(data.specialists)
        ? data.specialists.filter(
            (item: unknown): item is string => typeof item === "string",
          )
        : [],
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

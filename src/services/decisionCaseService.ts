import { supabase } from "../lib/supabase";
import {
  generatePublicReliabilityAnalysis,
  getPublicReliabilityScenario,
} from "../lib/public-reliability";
import type {
  DecisionCase,
  DecisionJourneyContext,
  DecisionMessage,
} from "../lib/decision-case";
import {
  createCoworkWorkspaceFromObjective,
  getCoworkMessages,
  sendCoworkMessage,
} from "./operatingLoopService";
import { runLiveReliabilityAgent } from "./reliabilityCopilotAgent";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedDecisionCase(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export async function createPersistedDecisionCase(
  seed: DecisionCase,
  context: DecisionJourneyContext,
): Promise<DecisionCase> {
  const result = await createCoworkWorkspaceFromObjective(seed.objective);
  const persisted = {
    ...seed,
    id: result.workspaceId,
    createdFromIntake: true,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("cowork_workspaces")
    .update({
      case_number: persisted.caseNumber,
      case_state: persisted,
      source_intake_id: context.intakeId || null,
      usage_tokens: persisted.tokensUsed,
      next_action: "Complete the technical authority review",
    })
    .eq("id", result.workspaceId);
  if (error) throw new Error(`Could not initialize case: ${error.message}`);
  return persisted;
}

export async function loadPersistedDecisionCase(
  id: string,
): Promise<DecisionCase | null> {
  if (!isPersistedDecisionCase(id)) return null;
  const { data, error } = await supabase
    .from("cowork_workspaces")
    .select("case_state")
    .eq("id", id)
    .maybeSingle()
    .returns<{ case_state: DecisionCase | null }>();
  if (error) throw new Error(`Could not load case: ${error.message}`);
  return data?.case_state ?? null;
}

export async function savePersistedDecisionCase(
  decisionCase: DecisionCase,
): Promise<void> {
  if (!isPersistedDecisionCase(decisionCase.id)) return;
  const progress: Record<DecisionCase["stage"], number> = {
    intent: 10,
    asset_truth: 20,
    evidence: 35,
    analysis: 50,
    authority: 65,
    execution: 78,
    outcomes: 90,
    learning: 100,
  };
  const { error } = await supabase
    .from("cowork_workspaces")
    .update({
      case_state: decisionCase,
      usage_tokens: decisionCase.tokensUsed,
      progress: progress[decisionCase.stage],
      status: decisionCase.stage === "learning" ? "complete" : "active",
      next_action: decisionCase.statusLabel,
      updated_at: decisionCase.updatedAt,
    })
    .eq("id", decisionCase.id);
  if (error) throw new Error(`Could not save case: ${error.message}`);
}

export interface DecisionCaseReply {
  message: DecisionMessage;
  estimatedTokens: number;
  source: "live" | "deterministic";
}

export async function askDecisionCase(
  decisionCase: DecisionCase,
  text: string,
): Promise<DecisionCaseReply> {
  const prompt = text.trim().slice(0, 2400);
  if (isPersistedDecisionCase(decisionCase.id)) {
    await sendCoworkMessage(decisionCase.id, decisionCase.objective, prompt);
    const messages = await getCoworkMessages(decisionCase.id);
    const reply = [...messages].reverse().find((item) => item.role !== "user");
    if (reply?.message) {
      return {
        message: {
          id: reply.id,
          role: "assistant",
          author: reply.agent || "SyncAI",
          text: reply.message,
          createdAt: reply.created_at,
          meta: reply.confidence
            ? `${reply.confidence}% confidence`
            : "Governed response",
        },
        estimatedTokens: estimateTokens(prompt + reply.message),
        source: "live",
      };
    }
  }

  const scenario = getPublicReliabilityScenario("pump-seal");
  const analysis = generatePublicReliabilityAnalysis(
    "pump-seal",
    new Date(),
    prompt,
  );
  const live = await runLiveReliabilityAgent({
    mode: "RCA",
    prompt,
    csvText: scenario.csvText,
    report: analysis.report,
  });
  const response =
    live.status === "success"
      ? live.response
      : deterministicReply(decisionCase, prompt, analysis);
  return {
    message: {
      id: `msg-${Date.now()}`,
      role: "assistant",
      author: "SyncAI",
      text: response,
      createdAt: new Date().toISOString(),
      meta:
        live.status === "success"
          ? `Live governed analysis · ${live.modelUsed || "reliability agent"}`
          : "Deterministic reliability analysis · human authority required",
    },
    estimatedTokens: estimateTokens(prompt + response),
    source: live.status === "success" ? "live" : "deterministic",
  };
}

function estimateTokens(text: string): number {
  return Math.max(120, Math.ceil(text.length / 3.7));
}

function deterministicReply(
  decisionCase: DecisionCase,
  prompt: string,
  analysis: ReturnType<typeof generatePublicReliabilityAnalysis>,
): string {
  const lower = prompt.toLowerCase();
  if (lower.includes("evidence") || lower.includes("missing")) {
    return [
      "The decision is not evidence-complete.",
      "",
      `Known: ${analysis.patternSummary}`,
      "Missing: a governed startup solids sample and complete vibration coverage.",
      "Conflict: the approved seal-flush drawing does not match the field note.",
      "",
      "Next action: close the configuration conflict, collect the startup sample, and preserve the monthly interval until Reliability Engineering accepts the mechanism evidence.",
    ].join("\n");
  }
  if (lower.includes("value") || lower.includes("dollar")) {
    return [
      `The highest-value next dollar is the controlled evidence plan for ${decisionCase.asset}.`,
      "",
      `It resolves a ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(decisionCase.valueExposure)} exposure with the smallest governed intervention.`,
      "Value must be verified against recurrence, downtime, and avoided emergency-work baselines. Finance signs the baseline before release.",
    ].join("\n");
  }
  return [
    decisionCase.recommendation,
    "",
    analysis.patternSummary,
    decisionCase.recommendationDetail,
    "",
    `Approval boundary: ${analysis.report.approvalBoundary[0] || "Reliability Engineering must authorize the technical change."}`,
    `Verification: ${analysis.recurrenceCheck}`,
  ].join("\n");
}

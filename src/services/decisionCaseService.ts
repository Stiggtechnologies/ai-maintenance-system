import { supabase } from "../lib/supabase";
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
import { runPublicDecisionCaseAgent } from "./publicReliabilityAgent";

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
    createdFromIntake: seed.createdFromIntake || Boolean(context.intakeId),
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

interface DeterministicResponse {
  text: string;
  meta: string;
}

export async function askDecisionCase(
  decisionCase: DecisionCase,
  text: string,
  options: { publicMode?: boolean } = {},
): Promise<DecisionCaseReply> {
  const prompt = text.trim().slice(0, 2400);
  const conversationReply = conversationalBoundaryReply(decisionCase, prompt);
  if (conversationReply) {
    return buildDeterministicReply(prompt, conversationReply);
  }
  if (isDeterministicCalculationRequest(prompt)) {
    return buildDeterministicReply(
      prompt,
      deterministicReply(decisionCase, prompt),
    );
  }
  if (options.publicMode) {
    const result = await runPublicDecisionCaseAgent(decisionCase, prompt);
    if (result.status === "success") {
      const sourceLabel = result.knowledgeBaseUsed
        ? `RAG-grounded reliability analysis · ${result.citations.length} approved source${result.citations.length === 1 ? "" : "s"}`
        : "Governed model analysis · no public reference match";
      return {
        message: {
          id: `msg-${Date.now()}`,
          role: "assistant",
          author: "SyncAI",
          text: result.response,
          createdAt: new Date().toISOString(),
          meta: sourceLabel,
        },
        estimatedTokens: estimateTokens(prompt + result.response),
        source: "live",
      };
    }
    if (result.status === "rate_limited") {
      return buildDeterministicReply(prompt, {
        text: "Your included live RAG analysis capacity for this access window has been used. The Decision Case and deterministic packet remain available. Sign in to continue in a governed workspace.",
        meta: "Live RAG capacity reached · case retained",
      });
    }
  }
  if (isPersistedDecisionCase(decisionCase.id)) {
    await sendCoworkMessage(
      decisionCase.id,
      buildGroundedCaseContext(decisionCase),
      prompt,
    );
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
  const response = deterministicReply(decisionCase, prompt);
  if (options.publicMode) {
    response.meta = "Deterministic fallback · live RAG unavailable";
  }
  return buildDeterministicReply(prompt, response);
}

function buildDeterministicReply(
  prompt: string,
  response: DeterministicResponse,
): DecisionCaseReply {
  return {
    message: {
      id: `msg-${Date.now()}`,
      role: "assistant",
      author: "SyncAI",
      text: response.text,
      createdAt: new Date().toISOString(),
      meta: response.meta,
    },
    estimatedTokens: estimateTokens(prompt + response.text),
    source: "deterministic",
  };
}

function estimateTokens(text: string): number {
  return Math.max(120, Math.ceil(text.length / 3.7));
}

function conversationalBoundaryReply(
  decisionCase: DecisionCase,
  prompt: string,
): DeterministicResponse | null {
  const lower = prompt.toLowerCase().trim();
  if (/^(hi|hello|hey|good morning|good afternoon)[.?!\s]*$/.test(lower)) {
    return {
      text: `Hi. What would you like to work on? We can continue ${decisionCase.caseNumber} for ${decisionCase.asset}, or you can give me something else to examine.`,
      meta: `Conversation · ${decisionCase.caseNumber} retained`,
    };
  }

  const words = lower.split(/\s+/).filter(Boolean);
  const signalsTopicChange =
    /\b(someth\w* else|something different|another thing|different topic|new topic)\b/.test(
      lower,
    ) ||
    (/\b(look|review|check|examine|analy[sz]e)\b/.test(lower) &&
      /\b(other|else|different|another)\b/.test(lower));
  const includesConcreteSubject =
    /\b[A-Z]{1,5}-?\d{2,}\b/.test(prompt) ||
    /[:\n]/.test(prompt) ||
    words.length > 14;

  if (signalsTopicChange && !includesConcreteSubject) {
    return {
      text: `Absolutely. What would you like me to examine? Paste the text or data, or name the asset, document, case, or decision. I will keep ${decisionCase.caseNumber} unchanged unless you explicitly add the new material to it.`,
      meta: `Conversation · ${decisionCase.caseNumber} preserved`,
    };
  }

  return null;
}

function deterministicReply(
  decisionCase: DecisionCase,
  prompt: string,
): DeterministicResponse {
  const lower = prompt.toLowerCase();
  if (
    lower.includes("calculation") ||
    lower.includes("formula") ||
    lower.includes("source record") ||
    lower.includes("exact source")
  ) {
    const calculations = decisionCase.calculations
      .map((item) => {
        const sources = item.sourceEvidenceIds
          .map((id) =>
            decisionCase.evidence.find((evidence) => evidence.id === id),
          )
          .filter(Boolean)
          .map((evidence) => `${evidence!.title} (${evidence!.record})`)
          .join("; ");
        return `${item.label}: ${item.formula} = ${item.result}. Sources: ${sources}. Assumption: ${item.assumption}`;
      })
      .join("\n\n");
    return {
      text:
        calculations ||
        "No deterministic calculation has been approved for this draft case yet.",
      meta: `Case-scoped deterministic analysis · ${decisionCase.version}`,
    };
  }
  if (lower.includes("evidence") || lower.includes("missing")) {
    const known = decisionCase.evidence
      .filter((item) => item.quality === "high" || item.quality === "medium")
      .map((item) => `${item.title}: ${item.finding}`)
      .join("\n");
    const blockers = decisionCase.evidence
      .filter(
        (item) => item.quality === "missing" || item.quality === "conflict",
      )
      .map((item) => `${item.title}: ${item.state}. ${item.finding}`)
      .join("\n");
    return {
      text: [
        "The decision is not evidence-complete.",
        "",
        "Known evidence:",
        known || "No governed evidence has been attached.",
        "",
        "Blocking gaps and conflicts:",
        blockers || "No blocking evidence gaps are recorded.",
        "",
        `Next action: ${decisionCase.recommendationDetail}`,
      ].join("\n"),
      meta: `Case-scoped deterministic analysis · ${decisionCase.version}`,
    };
  }
  if (lower.includes("value") || lower.includes("dollar")) {
    return {
      text: [
        `The highest-value next dollar is the controlled evidence plan for ${decisionCase.asset}.`,
        "",
        `It resolves a ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(decisionCase.valueExposure)} exposure with the smallest governed intervention.`,
        decisionCase.priorityReason,
        "Value must be verified against recurrence, downtime, and avoided emergency-work baselines. Finance signs the baseline before release.",
      ].join("\n"),
      meta: `Case-scoped deterministic analysis · ${decisionCase.version}`,
    };
  }
  if (lower.includes("authority") || lower.includes("approv")) {
    const reviewer = decisionCase.approvals.find(
      (item) => item.status === "reviewing",
    );
    return {
      text: [
        `Required authority: ${decisionCase.authorityRole}.`,
        reviewer
          ? `${reviewer.name}, ${reviewer.role}, is the current named reviewer for ${reviewer.responsibility.toLowerCase()}.`
          : "No named reviewer is currently awaiting a decision.",
        "The working perspective does not grant approval authority. Identity, role assignment, rationale, and timestamp must be verified at the gate.",
      ].join("\n\n"),
      meta: `Case-scoped deterministic analysis · ${decisionCase.version}`,
    };
  }
  if (
    lower.includes("work") ||
    lower.includes("maximo") ||
    lower.includes("execution")
  ) {
    const receipt = decisionCase.workPackage.receipt;
    return {
      text: [
        `${decisionCase.workPackage.number}: ${decisionCase.workPackage.title}.`,
        `State: ${decisionCase.workPackage.status}. Target: ${decisionCase.workPackage.targetSystem}.`,
        receipt
          ? `Connector receipt ${receipt.externalId}; ${receipt.status}; last synchronized ${receipt.lastSync}.`
          : "No release receipt exists. The work package remains controlled by the authority gate.",
      ].join("\n"),
      meta: `Case-scoped deterministic analysis · ${decisionCase.version}`,
    };
  }
  return {
    text: `I am not yet sure which outcome you want. Should I examine evidence in ${decisionCase.caseNumber}, challenge its recommendation, prepare the authority review, or look at a different asset or document? Give me the item or decision you want to focus on.`,
    meta: `Clarification needed · ${decisionCase.caseNumber} unchanged`,
  };
}

function isDeterministicCalculationRequest(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return (
    lower.includes("calculation") ||
    lower.includes("formula") ||
    lower.includes("source record") ||
    lower.includes("exact source")
  );
}

function buildGroundedCaseContext(decisionCase: DecisionCase): string {
  return [
    `Decision Case ${decisionCase.caseNumber} ${decisionCase.version}`,
    `Asset: ${decisionCase.asset}`,
    `Objective: ${decisionCase.objective}`,
    `Recommendation: ${decisionCase.recommendation} ${decisionCase.recommendationDetail}`,
    `Canonical metrics: ${decisionCase.decisionMetrics.map((item) => `${item.label}=${item.value} ${item.detail}`).join("; ")}`,
    `Evidence: ${decisionCase.evidence.map((item) => `${item.title} [${item.state}] ${item.finding}`).join(" | ")}`,
    `Authority: ${decisionCase.authorityRole}`,
    `Value exposure: ${decisionCase.valueExposure}`,
    "Conversation contract: respond naturally to greetings and ordinary conversation. If the user signals a topic change without supplying the new subject, ask one focused clarifying question and keep this case unchanged. Do not repeat the case recommendation unless it answers the user's explicit request.",
    "Analysis contract: use only this case context for case claims. Never substitute records, metrics, or failure modes from another asset. State when the context cannot answer the question. Distinguish known evidence, inference, and missing evidence. Keep the response proportional to the request.",
  ].join("\n");
}

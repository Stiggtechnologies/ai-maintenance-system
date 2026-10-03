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
import {
  classifyDecisionQuestionScope,
  isActiveCaseTraceRequest,
  type DecisionQuestionScope,
} from "../lib/reliability-agent-contract";
import {
  buildDecisionAskContextPack,
  formatUnboundLiveQuestion,
  isCapabilityPrompt,
  isGreetingPrompt,
  promptNamesConcreteSubject,
  resolveDecisionAskBinding,
  sanitizeUnboundAskCase,
  signalsTopicChange,
} from "../lib/decision-case-honesty";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedDecisionCase(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export type DecisionCaseCommand =
  | "record_conversation"
  | "add_evidence"
  | "record_disposition"
  | "define_verification"
  | "record_required_person"
  | "record_source_check"
  | "record_approval";

export type DecisionCaseApprovalDecision =
  "approved" | "rejected" | "changes_requested" | "delegated";

export class DecisionCaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionCaseConflictError";
  }
}

type DecisionCaseCommandResult = {
  caseState: DecisionCase;
  version: number;
};

export interface DecisionCaseAuthorityDirectoryEntry {
  userId: string;
  name: string;
  email: string;
  role: string;
}

function commandPayload(
  decisionCase: DecisionCase,
  command: DecisionCaseCommand | "initialize",
): Record<string, unknown> {
  if (command === "initialize") return { ...decisionCase };
  if (command === "record_conversation") {
    return {
      messages: decisionCase.messages,
      tokensUsed: decisionCase.tokensUsed,
    };
  }
  if (command === "add_evidence") {
    return {
      evidence: decisionCase.evidence,
      evidenceScore: decisionCase.evidenceScore,
      stage: decisionCase.stage,
      recommendation: decisionCase.recommendation,
      recommendationDetail: decisionCase.recommendationDetail,
      decisionMetrics: decisionCase.decisionMetrics,
    };
  }
  if (command === "record_disposition") {
    const person = (author: string) =>
      [...decisionCase.comments]
        .reverse()
        .find((item) => item.author === author)
        ?.text.trim() ?? "";
    return {
      humanDecision: decisionCase.humanDecision,
      people: {
        decisionOwner: person("Decision Owner"),
        recommendationAuthor: person("Recommendation Author"),
        verificationOwner: person("Verification Owner"),
      },
    };
  }
  if (command === "define_verification") {
    const expected = decisionCase.valueMetrics.find(
      (item) => item.id === "verify-expected",
    );
    const evidence = decisionCase.valueMetrics.find(
      (item) => item.id === "verify-evidence",
    );
    return {
      verification: {
        question: evidence?.target ?? "",
        expected: expected?.baseline ?? "",
        actual: expected?.actual ?? "",
        evidence:
          evidence?.detail === "Not yet attached"
            ? ""
            : (evidence?.detail ?? ""),
        scheduledFor: evidence?.baseline ?? "",
        effectiveness: evidence?.actual ?? "",
      },
    };
  }
  if (command === "record_required_person") {
    return { requiredPerson: { userId: decisionCase.requiredPerson?.userId } };
  }
  if (command === "record_source_check") {
    const detail = [...decisionCase.messages]
      .reverse()
      .find((item) => item.meta === "Source connection check")
      ?.text.replace(
        / This check is not a data pull and supplies no case evidence\.$/,
        "",
      );
    return { sourceCheck: { detail } };
  }
  throw new Error(`Unsupported client Decision Case command: ${command}`);
}

async function applyDecisionCaseCommand(
  decisionCase: DecisionCase,
  command: DecisionCaseCommand | "initialize",
  expectedVersion: number,
  payload = commandPayload(decisionCase, command),
): Promise<DecisionCase> {
  const { data, error } = await supabase.rpc("apply_decision_case_command", {
    p_workspace_id: decisionCase.id,
    p_expected_version: expectedVersion,
    p_command: command,
    p_case_state: payload,
  });
  if (error) {
    if (
      error.code === "40001" ||
      /Decision Case conflict/i.test(error.message)
    ) {
      throw new DecisionCaseConflictError(error.message);
    }
    throw new Error(`Could not save case: ${error.message}`);
  }
  const result = data as DecisionCaseCommandResult | null;
  if (!result?.caseState || result.version <= expectedVersion) {
    throw new Error(
      "Could not save case: command did not return a newer canonical version.",
    );
  }
  return { ...result.caseState, revision: result.version };
}

export async function createPersistedDecisionCase(
  seed: DecisionCase,
  context: DecisionJourneyContext,
): Promise<DecisionCase> {
  const result = await createCoworkWorkspaceFromObjective(seed.objective);
  const persisted = {
    ...seed,
    id: result.workspaceId,
    revision: 0,
    createdFromIntake: seed.createdFromIntake || Boolean(context.intakeId),
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("cowork_workspaces")
    .update({
      case_number: persisted.caseNumber,
      source_intake_id: context.intakeId || null,
      usage_tokens: persisted.tokensUsed,
      next_action: "Complete the technical authority review",
    })
    .eq("id", result.workspaceId)
    .select("id, case_version")
    .maybeSingle();
  if (error) throw new Error(`Could not initialize case: ${error.message}`);
  if (!data) {
    throw new Error(
      "Could not initialize case: no tenant-visible workspace row was updated.",
    );
  }
  return applyDecisionCaseCommand(persisted, "initialize", 0);
}

export async function loadPersistedDecisionCase(
  id: string,
): Promise<DecisionCase | null> {
  if (!isPersistedDecisionCase(id)) return null;
  const { data, error } = await supabase
    .from("cowork_workspaces")
    .select("case_state, case_version")
    .eq("id", id)
    .maybeSingle()
    .returns<{ case_state: DecisionCase | null; case_version: number }>();
  if (error) throw new Error(`Could not load case: ${error.message}`);
  return data?.case_state
    ? { ...data.case_state, revision: data.case_version }
    : null;
}

export async function savePersistedDecisionCase(
  decisionCase: DecisionCase,
  command: DecisionCaseCommand = "record_conversation",
): Promise<DecisionCase> {
  if (!isPersistedDecisionCase(decisionCase.id)) return decisionCase;
  if (!Number.isInteger(decisionCase.revision) || decisionCase.revision! < 1) {
    throw new Error(
      "Could not save case: canonical revision is missing; reload the case.",
    );
  }
  return applyDecisionCaseCommand(
    decisionCase,
    command,
    decisionCase.revision!,
  );
}

/**
 * Separate required-person approval command. The server refuses this unless
 * auth.uid() is the tenant-bound requiredPerson.userId and stamps the actor.
 */
export async function recordDecisionCaseApproval(
  decisionCase: DecisionCase,
  decision: DecisionCaseApprovalDecision,
  reason: string,
  delegatedTo?: string,
): Promise<DecisionCase> {
  if (!Number.isInteger(decisionCase.revision) || decisionCase.revision! < 1) {
    throw new Error(
      "Could not save case: canonical revision is missing; reload the case.",
    );
  }
  return applyDecisionCaseCommand(
    decisionCase,
    "record_approval",
    decisionCase.revision!,
    { decision, reason, delegatedTo },
  );
}

export async function listDecisionCaseAuthorityDirectory(): Promise<
  DecisionCaseAuthorityDirectoryEntry[]
> {
  const { data, error } = await supabase.rpc(
    "get_decision_case_authority_directory",
  );
  if (error)
    throw new Error(`Could not load authority directory: ${error.message}`);
  return Array.isArray(data)
    ? (data as DecisionCaseAuthorityDirectoryEntry[])
    : [];
}

export interface DecisionCaseReply {
  message: DecisionMessage;
  estimatedTokens: number;
  source: "live" | "deterministic";
  scope: DecisionQuestionScope;
}

interface DeterministicResponse {
  text: string;
  meta: string;
}

const specialistLabels: Record<string, string> = {
  "asset-onboarding": "Asset onboarding / commissioning",
  "rca-fracas": "RCA / FRACAS",
  ram: "RAM quantitative",
  "fmea-rcm-pm": "FMEA / RCM / PM strategy",
  "condition-monitoring": "Condition monitoring",
  "authority-risk": "Technical authority / risk",
  "lifecycle-value": "Lifecycle / value",
  "mro-inventory": "Inventory Management",
  "planning-scheduling": "Maintenance Planning & Scheduling",
  "general-reliability": "Senior Reliability Engineering",
};

export async function askDecisionCase(
  decisionCase: DecisionCase,
  text: string,
  options: { publicMode?: boolean } = {},
): Promise<DecisionCaseReply> {
  const prompt = text.trim().slice(0, 2400);
  const binding = resolveDecisionAskBinding(decisionCase);
  if (!binding.bound) {
    const local = unboundCaseReply(prompt);
    if (local) return local;
    return respondToDecisionQuestion(
      decisionCase,
      prompt,
      options,
      "provisional_new_subject",
      { bound: false },
    );
  }
  const conversationReply = conversationalBoundaryReply(decisionCase, prompt);
  if (conversationReply) {
    return buildDeterministicReply(prompt, conversationReply, "active_case");
  }
  const questionScope = classifyDecisionQuestionScope(decisionCase, prompt);
  return respondToDecisionQuestion(
    decisionCase,
    prompt,
    options,
    questionScope,
    {
      bound: true,
    },
  );
}

async function respondToDecisionQuestion(
  decisionCase: DecisionCase,
  prompt: string,
  options: { publicMode?: boolean },
  questionScope: DecisionQuestionScope,
  binding: { bound: boolean },
): Promise<DecisionCaseReply> {
  if (binding.bound && isActiveCaseTraceRequest(decisionCase, prompt)) {
    return buildDeterministicReply(
      prompt,
      deterministicReply(decisionCase, prompt),
      "active_case",
    );
  }
  if (options.publicMode) {
    const result = await runPublicDecisionCaseAgent(
      binding.bound ? decisionCase : sanitizeUnboundAskCase(decisionCase),
      binding.bound ? prompt : formatUnboundLiveQuestion(prompt),
    );
    if (result.status === "success") {
      const groundingLabel = result.knowledgeBaseUsed
        ? `RAG-grounded reliability analysis · ${result.citations.length} approved source${result.citations.length === 1 ? "" : "s"}`
        : "Governed model analysis · no public reference match";
      const specialistLabel = result.specialists
        ?.slice(0, 3)
        .map((specialist) => specialistLabels[specialist] || specialist)
        .join(" + ");
      const sourceLabel = specialistLabel
        ? `Reliability Engineer · ${specialistLabel} lens · ${groundingLabel}`
        : `Reliability Engineer · ${groundingLabel}`;
      const scopeLabel = !binding.bound
        ? `Provisional new subject · no case selected · ${sourceLabel}`
        : questionScope === "provisional_new_subject"
          ? `Provisional new subject · ${sourceLabel} · ${decisionCase.caseNumber} unchanged`
          : sourceLabel;
      return {
        message: {
          id: `msg-${Date.now()}`,
          role: "assistant",
          author: "SyncAI",
          text: result.response,
          createdAt: new Date().toISOString(),
          meta: scopeLabel,
        },
        estimatedTokens: estimateTokens(prompt + result.response),
        source: "live",
        scope: questionScope,
      };
    }
    if (result.status === "rate_limited") {
      return buildDeterministicReply(
        prompt,
        {
          text: binding.bound
            ? "Your included live RAG analysis capacity for this access window has been used. The Decision Case and deterministic packet remain available. Sign in to continue in a governed workspace."
            : "Your included live RAG analysis capacity for this access window has been used. No demo or reference case was substituted. Sign in to continue in a governed workspace.",
          meta: binding.bound
            ? "Live RAG capacity reached · case retained"
            : "Live RAG capacity reached · no case selected",
        },
        questionScope,
      );
    }
  }
  if (binding.bound && isPersistedDecisionCase(decisionCase.id)) {
    await sendCoworkMessage(
      decisionCase.id,
      buildGroundedCaseContext(decisionCase, questionScope),
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
        scope: questionScope,
      };
    }
  }
  if (questionScope === "provisional_new_subject") {
    return buildDeterministicReply(
      prompt,
      binding.bound
        ? {
            text: `I kept ${decisionCase.caseNumber} unchanged, but live expert analysis is temporarily unavailable, so I will not substitute facts from ${decisionCase.asset} into this new subject. Your question is preserved for retry.`,
            meta: `Provisional new subject · ${decisionCase.caseNumber} unchanged`,
          }
        : {
            text: "Live expert analysis is temporarily unavailable. Your question is preserved for retry. I did not bind a demo or reference case, and I will not invent plant facts.",
            meta: "Provisional new subject · no case selected",
          },
      questionScope,
    );
  }
  const response = deterministicReply(decisionCase, prompt);
  if (options.publicMode) {
    response.meta = "Deterministic fallback · live RAG unavailable";
  }
  return buildDeterministicReply(prompt, response, questionScope);
}

function buildDeterministicReply(
  prompt: string,
  response: DeterministicResponse,
  scope: DecisionQuestionScope,
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
    scope,
  };
}

function estimateTokens(text: string): number {
  return Math.max(120, Math.ceil(text.length / 3.7));
}

function unboundCaseReply(prompt: string): DecisionCaseReply | null {
  const pack = buildDecisionAskContextPack(null);
  if (isGreetingPrompt(prompt)) {
    return buildDeterministicReply(
      prompt,
      {
        text: "Hi. What would you like to work on? No decision case is selected — name the asset, site, or decision. I will not assume a demo or reference case.",
        meta: "Conversation · no case selected",
      },
      "provisional_new_subject",
    );
  }
  if (isCapabilityPrompt(prompt)) {
    return buildDeterministicReply(
      prompt,
      {
        text: [
          "I am a Reliability Engineering collaborator for turning asset questions and operating evidence into defensible decisions, controlled action, and measured value.",
          "",
          "No decision case is selected. Ask a general question, or name the asset, site, or decision. I will not substitute a demo or reference case.",
          "",
          pack.contextLines.join("\n"),
        ].join("\n"),
        meta: "Reliability Engineering capability map · no case selected",
      },
      "provisional_new_subject",
    );
  }
  if (promptNamesConcreteSubject(prompt)) {
    return null;
  }
  return buildDeterministicReply(
    prompt,
    {
      text: "What asset, site, or decision should I examine? Name the subject or paste the data. I will work from what you provide, label the result provisional, and will not bind a demo or reference case.",
      meta: "Clarification needed · no case selected",
    },
    "provisional_new_subject",
  );
}

function conversationalBoundaryReply(
  decisionCase: DecisionCase,
  prompt: string,
): DeterministicResponse | null {
  if (isGreetingPrompt(prompt)) {
    return {
      text: `Hi. What would you like to work on? We can continue ${decisionCase.caseNumber} for ${decisionCase.asset}, or you can give me something else to examine.`,
      meta: `Conversation · ${decisionCase.caseNumber} retained`,
    };
  }

  if (isCapabilityPrompt(prompt)) {
    return {
      text: [
        "I am a Reliability Engineering collaborator for turning asset questions and operating evidence into defensible decisions, controlled action, and measured value.",
        "",
        "## Core engineering capabilities",
        "",
        "- **RAM analysis:** MTBF, MTTF, MTTR, inherent/achieved/operational availability, mission reliability, reliability allocation, RAM requirements, and trade studies.",
        "- **Reliability statistics and life data:** Exponential, Weibull, lognormal, normal, gamma, Poisson, and binomial models; hazard behavior; confidence bounds; censored data; goodness-of-fit; and reliability demonstration planning.",
        "- **System reliability modeling:** Series, parallel, and k-out-of-n systems; reliability block diagrams; Markov and Monte Carlo approaches; prediction models; and allocation across system levels.",
        "- **Failure analysis and recurrence control:** RCA, FRACAS, fault trees, falsifiable hypotheses, evidence plans, corrective actions, and effectiveness checks.",
        "- **FMEA, FMECA, and RCM:** Functions, functional failures, failure modes, effects, criticality, consequence-based task selection, hidden failures, proof tests, P-F intervals, and maintenance strategy decisions.",
        "- **Maintenance and condition strategy:** Preventive, predictive, and condition-based maintenance; PM optimization; bad-actor analysis; inspection intervals; repair strategy; maintainability improvement; and spares implications.",
        "- **Specialist agent routing:** Inventory Management is a separate specialist for MRO segmentation, intermittent demand, stocking policy, insurance spares, repairables, stockout risk, obsolescence, shutdown readiness, material-master quality, supplier exposure, and working-capital decisions.",
        "- **Planning and scheduling specialist:** Builds job plans, tests work readiness, prioritizes backlog, develops weekly and 6-week schedules, resource-loads craft capacity, controls shutdown/turnaround readiness, and measures schedule compliance and planning quality.",
        "- **Mechanical and industrial reliability:** Bearings, gears, shafts, pumps, compressors, conveyors, mobile equipment, production lines, lubrication, vibration, contamination, and measurement-chain integrity.",
        "- **Risk, authority, and controlled change:** Safety, environmental, regulatory, OEM, MOC, approval, operating-envelope, and technical-authority boundaries.",
        "- **Risk-to-value decisions:** Rank where the next dollar should go, compare repair/replace/monitor options, quantify downtime and production exposure, and separate estimated, authorized, and verified realized value.",
        "- **Engineering outputs:** RAM plans, RCA and FRACAS packs, FMEA/FMECA worksheets, RCM and PM strategies, test plans, decision packets, executive briefs, calculations, tables, and review-ready work packages. Inventory Management produces inventory health checks and stocking-policy recommendations; Planning & Scheduling produces job plans, backlog reviews, lookaheads, resource forecasts, and shutdown-readiness plans.",
        "",
        "## Evidence and governance",
        "",
        "I can work from the facts you provide, the active Decision Case, approved public reliability references, and tenant-approved documents in a secure workspace. I separate observations, assertions, hypotheses, engineering judgement, missing evidence, and approval requirements rather than presenting all of them as equally certain.",
        "",
        `You can ask a general question, give me a new asset or dataset, or continue ${decisionCase.caseNumber}. I will switch scope without transferring facts from ${decisionCase.asset} into an unrelated analysis.`,
      ].join("\n"),
      meta: `Reliability Engineering capability map · ${decisionCase.caseNumber} retained`,
    };
  }

  if (signalsTopicChange(prompt) && !promptNamesConcreteSubject(prompt)) {
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

function buildGroundedCaseContext(
  decisionCase: DecisionCase,
  questionScope: DecisionQuestionScope,
): string {
  const pack = buildDecisionAskContextPack(decisionCase);
  if (!pack.injectCase) {
    return pack.contextLines.join("\n");
  }
  if (questionScope === "provisional_new_subject") {
    return [
      "Question scope: provisional new subject outside the active Decision Case.",
      `Retain ${decisionCase.caseNumber} for ${decisionCase.asset}, but do not transfer any of its evidence, calculations, metrics, hypotheses, or recommendation into the new analysis.`,
      "Use only facts supplied in the new request and clearly label the result provisional until a separate Decision Case is created.",
      "Apply the full reliability engineering method: decision, defensible calculations, facts versus hypotheses, evidence gaps and blockers, lowest-regret action, approval gates, and value verification as relevant.",
    ].join("\n");
  }
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
    "Analysis contract: use only this case context for case claims. Never substitute records, metrics, or failure modes from another asset. State when the context cannot answer the question. Distinguish known evidence, inference, and missing evidence. For substantive questions, show the decision, defensible calculations, burden of proof, evidence blockers, lowest-regret action, approval gates, and value verification as relevant.",
  ].join("\n");
}

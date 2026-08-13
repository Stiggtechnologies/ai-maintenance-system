export interface PublicDecisionCaseContext {
  caseNumber: string;
  version: string;
  asset: string;
  objective: string;
  recommendation: string;
  recommendationDetail: string;
  authorityRole: string;
  decisionMetrics: Array<{ label: string; value: string; detail: string }>;
  evidence: Array<{
    title: string;
    state: string;
    finding: string;
    record: string;
  }>;
  calculations: Array<{
    label: string;
    formula: string;
    result: string;
    assumption: string;
  }>;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    text: string;
  }>;
}

export function parsePublicDecisionCaseContext(
  input: unknown,
): PublicDecisionCaseContext | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const caseNumber = clean(value.caseNumber, 40);
  const asset = clean(value.asset, 180);
  if (!caseNumber || !asset) return null;

  return {
    caseNumber,
    version: clean(value.version, 24),
    asset,
    objective: clean(value.objective, 800),
    recommendation: clean(value.recommendation, 800),
    recommendationDetail: clean(value.recommendationDetail, 1200),
    authorityRole: clean(value.authorityRole, 160),
    decisionMetrics: objectArray(value.decisionMetrics, 8).map((item) => ({
      label: clean(item.label, 100),
      value: clean(item.value, 100),
      detail: clean(item.detail, 180),
    })),
    evidence: objectArray(value.evidence, 10).map((item) => ({
      title: clean(item.title, 180),
      state: clean(item.state, 180),
      finding: clean(item.finding, 700),
      record: clean(item.record, 300),
    })),
    calculations: objectArray(value.calculations, 8).map((item) => ({
      label: clean(item.label, 140),
      formula: clean(item.formula, 500),
      result: clean(item.result, 200),
      assumption: clean(item.assumption, 500),
    })),
    recentMessages: objectArray(value.recentMessages, 8)
      .map((item) => {
        const role = clean(item.role, 16);
        if (role !== "user" && role !== "assistant" && role !== "system") {
          return null;
        }
        return { role, text: clean(item.text, 1200) };
      })
      .filter(
        (item): item is PublicDecisionCaseContext["recentMessages"][number] =>
          Boolean(item?.text),
      ),
  };
}

export function buildDecisionCaseRetrievalQuery(
  context: PublicDecisionCaseContext,
  question: string,
): string {
  return [context.asset, context.objective, question]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

export function buildDecisionCaseChatPrompts(
  context: PublicDecisionCaseContext,
  question: string,
  referenceContext: string,
): { systemPrompt: string; userContent: string } {
  const systemPrompt = [
    "You are SyncAI's senior Reliability Engineering collaborator inside a governed Decision Case.",
    "Respond to the user's actual request. Be conversational for ordinary conversation, and analytical only when analysis is requested. If the user signals a topic change without providing the new subject, ask one focused clarifying question. Never replay the full recommendation merely because the request is ambiguous.",
    "The Decision Case below is the canonical record for this asset. Preserve its deterministic calculations, evidence states, approval boundary, and named uncertainty. Do not replace case facts with general reference knowledge.",
    "Retrieved passages may support reliability methods and general failure behaviour only. They are not observations about this customer's asset. Cite a retrieved passage only with its exact supplied bracket label. Never invent a citation, standard, OEM limit, asset fact, failure mechanism, cost, or measurement.",
    "Separate known case evidence, user-provided context, engineering inference, missing evidence, and approval requirements. Recommend reversible verification before permanent change. Qualified human authority remains responsible for material decisions.",
    "Keep an interactive answer concise and proportional, normally under 450 words. Lead with the direct answer. Do not produce a full RCA, FMEA, FRACAS, or executive report unless explicitly requested.",
    "This is public free access. Treat all supplied context as sanitized demonstration data and never imply access to tenant-private documents or production systems.",
  ].join("\n");

  const userContent = [
    `Decision Case: ${context.caseNumber} ${context.version}`,
    `Asset: ${context.asset}`,
    `Objective: ${context.objective || "Not defined"}`,
    `Current recommendation: ${context.recommendation || "Not established"}`,
    `Recommendation detail: ${context.recommendationDetail || "Not established"}`,
    `Approval boundary: ${context.authorityRole || "Not assigned"}`,
    "",
    "Canonical decision metrics:",
    listOrNone(
      context.decisionMetrics.map((item) =>
        `${item.label}: ${item.value} ${item.detail}`.trim(),
      ),
    ),
    "",
    "Governed case evidence:",
    listOrNone(
      context.evidence.map(
        (item) =>
          `${item.title} [${item.state}] ${item.finding} Record: ${item.record}`,
      ),
    ),
    "",
    "Deterministic calculations:",
    listOrNone(
      context.calculations.map(
        (item) =>
          `${item.label}: ${item.formula} = ${item.result}. Assumption: ${item.assumption}`,
      ),
    ),
    "",
    "Recent Decision Thread:",
    listOrNone(
      context.recentMessages.map(
        (message) => `${message.role.toUpperCase()}: ${message.text}`,
      ),
    ),
    "",
    "Approved public reliability reference passages:",
    referenceContext ||
      "No approved public reference passage matched this request.",
    "",
    `Current user request: ${question}`,
  ].join("\n");

  return { systemPrompt, userContent };
}

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function objectArray(value: unknown, limit: number): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .slice(0, limit)
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
    : [];
}

function listOrNone(items: string[]): string {
  const usable = items.filter(Boolean);
  return usable.length
    ? usable.map((item) => `- ${item}`).join("\n")
    : "- None recorded";
}

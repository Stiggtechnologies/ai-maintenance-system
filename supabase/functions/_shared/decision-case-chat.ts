import {
  buildSpecialistBrief,
  selectReliabilitySpecialists,
} from "./reliability-specialists.ts";

export interface PublicDecisionCaseContext {
  caseNumber: string;
  version: string;
  questionScope: "active_case" | "provisional_new_subject";
  industry: string;
  organization: string;
  site: string;
  asset: string;
  assetContext: string;
  objective: string;
  risk: string;
  valueExposure: number;
  evidenceScore: number;
  recommendation: string;
  recommendationDetail: string;
  priorityReason: string;
  authorityRole: string;
  decisionMetrics: Array<{ label: string; value: string; detail: string }>;
  evidence: Array<{
    title: string;
    summary: string;
    quality: string;
    state: string;
    finding: string;
    record: string;
    lineage: string;
    sourceSystem: string;
  }>;
  calculations: Array<{
    label: string;
    formula: string;
    result: string;
    assumption: string;
  }>;
  approvals: Array<{
    name: string;
    role: string;
    responsibility: string;
    status: string;
  }>;
  workPackage: {
    number: string;
    title: string;
    targetSystem: string;
    status: string;
    controls: Array<{ text: string; owner: string; status: string }>;
  };
  valueMetrics: Array<{
    label: string;
    detail: string;
    baseline: string;
    target: string;
    actual: string;
  }>;
  financeStatus: string;
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    text: string;
  }>;
}

// The database allowance RPC rejects limits above 10.
export const PUBLIC_DECISION_CASE_DAILY_LIMIT = 10;

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
    questionScope:
      value.questionScope === "provisional_new_subject"
        ? "provisional_new_subject"
        : "active_case",
    industry: clean(value.industry, 80),
    organization: clean(value.organization, 180),
    site: clean(value.site, 180),
    asset,
    assetContext: clean(value.assetContext, 400),
    objective: clean(value.objective, 800),
    risk: clean(value.risk, 40),
    valueExposure: finiteNumber(value.valueExposure),
    evidenceScore: finiteNumber(value.evidenceScore),
    recommendation: clean(value.recommendation, 800),
    recommendationDetail: clean(value.recommendationDetail, 1200),
    priorityReason: clean(value.priorityReason, 1000),
    authorityRole: clean(value.authorityRole, 160),
    decisionMetrics: objectArray(value.decisionMetrics, 8).map((item) => ({
      label: clean(item.label, 100),
      value: clean(item.value, 100),
      detail: clean(item.detail, 180),
    })),
    evidence: objectArray(value.evidence, 10).map((item) => ({
      title: clean(item.title, 180),
      summary: clean(item.summary, 400),
      quality: clean(item.quality, 40),
      state: clean(item.state, 180),
      finding: clean(item.finding, 700),
      record: clean(item.record, 300),
      lineage: clean(item.lineage, 500),
      sourceSystem: clean(item.sourceSystem, 180),
    })),
    calculations: objectArray(value.calculations, 8).map((item) => ({
      label: clean(item.label, 140),
      formula: clean(item.formula, 500),
      result: clean(item.result, 200),
      assumption: clean(item.assumption, 500),
    })),
    approvals: objectArray(value.approvals, 10).map((item) => ({
      name: clean(item.name, 120),
      role: clean(item.role, 160),
      responsibility: clean(item.responsibility, 500),
      status: clean(item.status, 40),
    })),
    workPackage: parseWorkPackage(value.workPackage),
    valueMetrics: objectArray(value.valueMetrics, 10).map((item) => ({
      label: clean(item.label, 140),
      detail: clean(item.detail, 240),
      baseline: clean(item.baseline, 100),
      target: clean(item.target, 100),
      actual: clean(item.actual, 100),
    })),
    financeStatus: clean(value.financeStatus, 40),
    recentMessages: objectArray(value.recentMessages, 12)
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
  if (context.questionScope === "provisional_new_subject") {
    return [context.industry, question]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1200);
  }
  const evidenceSignals = context.evidence
    .map((item) => `${item.title} ${item.finding}`)
    .join(" ");
  return [
    context.industry,
    context.asset,
    context.assetContext,
    context.objective,
    context.recommendation,
    evidenceSignals,
    question,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);
}

export function buildDecisionCaseChatPrompts(
  context: PublicDecisionCaseContext,
  question: string,
  referenceContext: string,
): { systemPrompt: string; userContent: string } {
  const specialists = selectReliabilitySpecialists(
    `${question} ${context.questionScope === "active_case" ? context.objective : ""}`,
  );
  const systemPrompt = [
    "You are SyncAI's senior Reliability Engineering collaborator inside a governed Decision Case. Work at the level expected in a failure review board, maintenance strategy review, or technical authority decision.",
    "Respond to the user's actual request. Be conversational for ordinary conversation, and analytical only when analysis is requested. If the user signals a topic change without providing the new subject, ask one focused clarifying question. Never replay the full recommendation merely because the request is ambiguous.",
    "The supplied question scope is authoritative. For a provisional new subject, use only facts in the current user request and general approved references. Do not transfer evidence, calculations, metrics, failure modes, hypotheses, recommendation, or approval assignments from the active Decision Case. Say that the analysis is provisional and that a separate Decision Case is required to govern and retain it.",
    "The Decision Case below is the canonical record for this asset. Preserve its deterministic calculations, evidence states, approval boundary, and named uncertainty. Do not replace case facts with general reference knowledge.",
    "Retrieved passages may support reliability methods and general failure behaviour only. They are not observations about this customer's asset. Cite a retrieved passage only with its exact supplied bracket label. Never invent a citation, standard, OEM limit, asset fact, failure mechanism, cost, or measurement.",
    "Separate known case evidence, user-provided assertions, hypotheses, engineering judgement, missing evidence, and approval requirements. Never call a hypothesis a root cause. Recommend reversible verification before permanent change. Qualified human authority remains responsible for material decisions.",
    "For a substantive engineering decision across RCA, FRACAS, FMEA, RCM, RAM, PM optimization, condition monitoring, spares, lifecycle, or value analysis, lead with the decision and explain why competing actions are or are not supportable. Then cover, when relevant: known facts; ranked hypotheses with support, contradiction, confidence and verification; missing evidence and exactly what each gap blocks; the lowest-regret action plan with owner, time window, stop condition and effectiveness check; approval boundaries and decision gates; and how value will be verified without creating hidden or transferred risk.",
    "Use professional Markdown headings and compact bullets. Use a table only when it materially improves comparison. Make the answer proportional to the request, but do not collapse a real engineering decision into a generic summary. A deep decision analysis will commonly require 900 to 1,500 words. A narrow follow-up should remain concise.",
    "Do not merely restate the current recommendation or dump the case metrics. Show the reasoning chain, the burden of proof for each decision option, the consequence of being wrong, and the evidence that would change the decision.",
    "Do not calculate MTBF without operating exposure or MTTR without valid repair-event data. Do not treat calendar recurrence as operating-time reliability. Do not treat the absence of an alarm as proof of asset health.",
    "The orchestration layer selected these specialist lenses. Apply all that are relevant, reconcile any tension between them, and return one coherent SyncAI answer:",
    buildSpecialistBrief(specialists),
    "Before finalizing, silently quality-check the answer: it answers the actual request; does not leak another asset; labels facts, assertions, hypotheses and judgement; limits calculations to valid inputs; maps evidence gaps to blocked decisions; names owners and decision gates; preserves safety and technical authority; and defines how effectiveness and realized value will be verified. Repair the answer before returning it if any applicable check fails.",
    "This is public free access. Treat all supplied context as sanitized demonstration data and never imply access to tenant-private documents or production systems.",
  ].join("\n");

  const provisionalUserContent = [
    "Question scope: PROVISIONAL NEW SUBJECT",
    `Active Decision Case retained but excluded from this analysis: ${context.caseNumber} for ${context.asset}`,
    `Selected industry context: ${context.industry || "Not defined"}`,
    "Use no facts from the excluded case. Treat only the current request as user-supplied assertions until evidence is governed.",
    "",
    "Approved public reliability reference passages:",
    referenceContext ||
      "No approved public reference passage matched this request.",
    "",
    `Current user request: ${question}`,
  ].join("\n");

  const activeCaseUserContent = [
    "Question scope: ACTIVE DECISION CASE",
    `Decision Case: ${context.caseNumber} ${context.version}`,
    `Industry: ${context.industry || "Not defined"}`,
    `Organization / site: ${context.organization || "Not defined"} / ${context.site || "Not defined"}`,
    `Asset: ${context.asset}`,
    `Asset context: ${context.assetContext || "Not defined"}`,
    `Objective: ${context.objective || "Not defined"}`,
    `Risk / exposure: ${context.risk || "Not classified"} / ${context.valueExposure || "Not quantified"}`,
    `Evidence score: ${context.evidenceScore || "Not scored"}`,
    `Current recommendation: ${context.recommendation || "Not established"}`,
    `Recommendation detail: ${context.recommendationDetail || "Not established"}`,
    `Priority reason: ${context.priorityReason || "Not established"}`,
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
          `${item.title} [quality=${item.quality || "unrated"}; state=${item.state}] ${item.finding} Record: ${item.record}. Summary: ${item.summary}. Lineage: ${item.lineage}. Source system: ${item.sourceSystem}.`,
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
    "Authority map:",
    listOrNone(
      context.approvals.map(
        (item) =>
          `${item.name}, ${item.role} [${item.status}]: ${item.responsibility}`,
      ),
    ),
    "",
    "Controlled work package:",
    `${context.workPackage.number || "Not created"}: ${context.workPackage.title || "Not defined"} [${context.workPackage.status || "unknown"}] → ${context.workPackage.targetSystem || "No target system"}`,
    listOrNone(
      context.workPackage.controls.map(
        (item) => `${item.owner} [${item.status}]: ${item.text}`,
      ),
    ),
    "",
    "Value verification contract:",
    listOrNone(
      context.valueMetrics.map(
        (item) =>
          `${item.label}: baseline ${item.baseline}; target ${item.target}; actual ${item.actual || "not verified"}; boundary ${item.detail}`,
      ),
    ),
    `Finance status: ${context.financeStatus || "not assigned"}`,
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

  return {
    systemPrompt,
    userContent:
      context.questionScope === "provisional_new_subject"
        ? provisionalUserContent
        : activeCaseUserContent,
  };
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

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseWorkPackage(
  input: unknown,
): PublicDecisionCaseContext["workPackage"] {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  return {
    number: clean(value.number, 80),
    title: clean(value.title, 240),
    targetSystem: clean(value.targetSystem, 160),
    status: clean(value.status, 40),
    controls: objectArray(value.controls, 12).map((item) => ({
      text: clean(item.text, 500),
      owner: clean(item.owner, 160),
      status: clean(item.status, 40),
    })),
  };
}

function listOrNone(items: string[]): string {
  const usable = items.filter(Boolean);
  return usable.length
    ? usable.map((item) => `- ${item}`).join("\n")
    : "- None recorded";
}

import type { PublicAskIntentId } from "./public-ask-intents";

export type ProductEntryId =
  | "failure-investigation"
  | "recovery-coordination"
  | "maintenance-cost-reduction"
  | "maintenance-readiness"
  | "shift-handover-continuity"
  | "backlog-schedule-stability"
  | "production-risk-response"
  | "downtime-evidence-audit"
  | "reliability-spend-prioritization"
  | "asset-criticality-foundation";

export type ProductEntryPath = {
  id: ProductEntryId;
  intentId: PublicAskIntentId;
  priority: "primary" | "secondary" | "portfolio";
  name: string;
  agentProduct: string;
  platformSurface: string;
  buyerQuestion: string;
  input: string;
  outcome: string;
  successMetric: string;
  boundary: string;
};

/**
 * Research-derived first-customer walkthrough contract.
 *
 * This is a hypothesis for how every acquisition wedge should enter the
 * canonical Decision Case. It is not proof that a buyer pain, message, or
 * conversion path works, and it does not create parallel workflow state.
 */
export const CUSTOMER_FIRST_WALKTHROUGH = [
  {
    id: "real-question",
    label: "Real question",
    detail:
      "Begin with the operational question the customer is already trying to answer, not a seeded demo or setup form.",
  },
  {
    id: "evidence-path",
    label: "Evidence path",
    detail:
      "Choose the evidence type first, then upload, paste, connect, record manually, or ask an administrator. Missing evidence stays visible.",
  },
  {
    id: "bounded-recommendation",
    label: "Bounded recommendation",
    detail:
      "Cite only supplied evidence and state uncertainty, conflicts, and what the record cannot yet support.",
  },
  {
    id: "human-disposition",
    label: "Human disposition",
    detail:
      "A named person accepts, rejects, requests more evidence, parks, or escalates—with rationale and the condition that would change the recommendation.",
  },
  {
    id: "controlled-action",
    label: "Controlled action",
    detail:
      "Keep operating and engineering authority outside the AI; approved work follows the customer's existing controls.",
  },
  {
    id: "verification",
    label: "Verification",
    detail:
      "Name the verification owner, expected result, due date, actual result, and supporting evidence before claiming an outcome.",
  },
  {
    id: "learning",
    label: "Learning candidate",
    detail:
      "Retain the question-to-result record for review without automatically promoting it to verified knowledge.",
  },
] as const;

export const PRODUCT_CUSTOMER_FLOW = [
  {
    id: "first-decision",
    label: "First Decision",
    detail:
      "Enter through one urgent pain and produce one governed decision record.",
    optional: false,
  },
  {
    id: "assess-if-needed",
    label: "Assess if needed",
    detail:
      "Use the bounded Reliability Intelligence Assessment only when the evidence and readiness baseline is not already proven.",
    optional: true,
  },
  {
    id: "bounded-proof",
    label: "Bounded proof",
    detail:
      "Prove the workflow on agreed decisions, data, acceptance criteria, and stop criteria.",
    optional: false,
  },
  {
    id: "production",
    label: "Production fleet or site",
    detail:
      "Operationalize the approved sources, controls, owners, handoff, and verification cadence.",
    optional: false,
  },
  {
    id: "expand",
    label: "Multi-site to enterprise",
    detail:
      "Expand only when a named customer authority records go, change, hold, or stop with unresolved risks and verification obligations.",
    optional: false,
  },
] as const;

/**
 * Commercial entry paths into the canonical Decision Case.
 *
 * These are acquisition wedges, not separate products or persistence models.
 * Each route reuses the public capability seed, evidence record, human approval
 * boundary, controlled work package, and value-verification loop.
 */
export const PRODUCT_ENTRY_PATHS: readonly ProductEntryPath[] = [
  {
    id: "failure-investigation",
    intentId: "troubleshoot",
    priority: "primary",
    name: "Unplanned Downtime Reduction",
    agentProduct: "SyncAI Failure Investigation Agent",
    platformSurface: "SyncAI copilot, FRACAS, and Decision Cases",
    buyerQuestion:
      "Why does this asset keep stopping, and what should we do next?",
    input: "Failure history, work orders, observations, and available evidence",
    outcome:
      "A governed downtime-reduction case with failure hypotheses, evidence gaps, actions, owners, and approval gates",
    successMetric:
      "Unplanned downtime hours, repeat-event rate, and verified avoided downtime",
    boundary:
      "SyncAI does not guarantee downtime elimination or claim a root cause that the supplied evidence cannot establish.",
  },
  {
    id: "recovery-coordination",
    intentId: "compare",
    priority: "primary",
    name: "Downtime Recovery Coordination",
    agentProduct: "SyncAI Downtime Recovery Agent",
    platformSurface: "Sync Recovery, Work, Materials, Handover, and Value",
    buyerQuestion:
      "How do we return this asset to stable service without hidden blockers or unsafe shortcuts?",
    input:
      "Event scope, open work, labour, materials, constraints, permits, custody state, and the approved baseline",
    outcome:
      "A governed restoration event with integrated scope and timeline, blocker control, independent approval, execution evidence, return-to-service gates, and a value report",
    successMetric:
      "Time to return to service, blocker delay, first-time-right, recovered hours, and separately verified value",
    boundary:
      "SyncAI cannot self-release work, clear isolations, accept return to service, or invent missing duration and readiness evidence.",
  },
  {
    id: "maintenance-cost-reduction",
    intentId: "learn",
    priority: "secondary",
    name: "Maintenance Cost Reduction",
    agentProduct: "SyncAI Preventive Maintenance Decision Agent",
    platformSurface:
      "PM Programme, Interval Decisions, Job Plans, and Learning",
    buyerQuestion:
      "Which maintenance work is avoidable, mistimed, or failing to prevent downtime?",
    input:
      "PM tasks, intervals, failure history, execution records, and operating context",
    outcome:
      "A reviewable cost-reduction case with task and interval candidates, evidence gaps, approval requirements, and verification plan",
    successMetric:
      "Maintenance labour and material cost, emergency-work ratio, task yield, and failure recurrence",
    boundary:
      "No interval is adopted automatically; accountable engineering authority retains the decision.",
  },
  {
    id: "maintenance-readiness",
    intentId: "health",
    priority: "portfolio",
    name: "Maintenance Readiness Assurance",
    agentProduct: "SyncAI Maintenance Readiness Agent",
    platformSurface: "Execution Readiness, Materials, Scheduling, and Work",
    buyerQuestion:
      "What will stop this work from starting safely and finishing when promised?",
    input:
      "Work scope, job plans, labour, materials, permits, isolations, access, dependencies, and due dates",
    outcome:
      "A constraint-visible readiness position with owners, missing evidence, release conditions, and escalation needs",
    successMetric:
      "Ready-to-execute work, waiting time, start reliability, schedule compliance, and blocker age",
    boundary:
      "Missing labour, material, permit, isolation, or quality evidence stays unknown or blocked; it is never defaulted to ready.",
  },
  {
    id: "shift-handover-continuity",
    intentId: "fact-check",
    priority: "portfolio",
    name: "Shift Handover Continuity",
    agentProduct: "SyncAI Reliability Briefing Agent",
    platformSurface:
      "Handover, Operational Briefing, Notifications, and Recovery",
    buyerQuestion:
      "What will the next shift miss, misunderstand, or rediscover?",
    input:
      "Active work, blockers, decisions, evidence, equipment state, risks, and unresolved commitments",
    outcome:
      "A decision-ready handover record with open issues, custody, owners, escalation, and evidence links",
    successMetric:
      "Unresolved handover items, blocker age, duplicate investigation, restart delay, and commitment closure",
    boundary:
      "The handover summarizes recorded state; it cannot invent field truth or transfer operating authority implicitly.",
  },
  {
    id: "backlog-schedule-stability",
    intentId: "compare",
    priority: "portfolio",
    name: "Backlog and Schedule Stability",
    agentProduct: "SyncAI Maintenance Readiness Agent",
    platformSurface:
      "Work Action Board, Weekly Scheduling, Materials, and Execution Readiness",
    buyerQuestion:
      "Which work should enter the schedule, and what risk are we deferring?",
    input:
      "Backlog, priority, due dates, risk, labour capacity, material readiness, dependencies, and active recovery commitments",
    outcome:
      "A feasible planning position with explicit trade-offs, readiness warnings, and accountable release decisions",
    successMetric:
      "Schedule compliance, frozen-schedule changes, emergency-work ratio, backlog age, and ready-work coverage",
    boundary:
      "SyncAI provides governed decision support; a named planner retains schedule-freeze and release authority.",
  },
  {
    id: "production-risk-response",
    intentId: "health",
    priority: "portfolio",
    name: "Production Risk Response",
    agentProduct: "SyncAI Failure Investigation Agent",
    platformSurface:
      "Risk Operating System, Decision Cases, Approvals, and Work",
    buyerQuestion:
      "Can we keep operating, inspect, constrain, or intervene now?",
    input:
      "Condition observations, consequence context, current controls, and missing evidence",
    outcome:
      "A bounded operating recommendation with risks, controls, escalation, and named authority",
    successMetric:
      "Decision lead time, controlled exposure, production interruption, and follow-up completion",
    boundary:
      "The public path is decision support and never executes against plant or control systems.",
  },
  {
    id: "downtime-evidence-audit",
    intentId: "fact-check",
    priority: "portfolio",
    name: "Downtime Evidence Audit",
    agentProduct: "SyncAI Failure Investigation Agent",
    platformSurface:
      "Decision Evidence, Assessments, Knowledge, and Reliability",
    buyerQuestion:
      "What does our downtime and maintenance data actually prove?",
    input:
      "Exports, reports, downtime records, and the decision they are expected to support",
    outcome:
      "A fact, assumption, conflict, and missing-evidence map tied to the target decision",
    successMetric:
      "Decision-critical data coverage, unresolved conflicts, and time to a defensible baseline",
    boundary:
      "Data quality and completeness are reported explicitly; missing proof is not filled with invented facts.",
  },
  {
    id: "reliability-spend-prioritization",
    intentId: "compare",
    priority: "portfolio",
    name: "Reliability Spend Prioritization",
    agentProduct: "SyncAI Reliability Briefing Agent",
    platformSurface:
      "Executive Intelligence, Value Realization, Decision Cases, and Risk",
    buyerQuestion: "Where should the next reliability dollar go?",
    input:
      "Candidate actions, consequences, costs, evidence, and decision constraints",
    outcome:
      "A comparable option record with value logic, uncertainty, evidence gaps, and approval path",
    successMetric:
      "Approved spend, decision lead time, projected value, and separately verified outcome",
    boundary:
      "Projected value remains separate from observed and independently verified outcomes.",
  },
  {
    id: "asset-criticality-foundation",
    intentId: "fact-check",
    priority: "portfolio",
    name: "Asset Criticality and Reliability Foundation",
    agentProduct: "SyncAI Preventive Maintenance Decision Agent",
    platformSurface:
      "Asset Onboarding, Asset Twins, Failure Modes, and Reliability Strategy",
    buyerQuestion:
      "Which assets matter most, what can fail, and what evidence is still missing?",
    input:
      "Asset register, hierarchy, operating context, criticality basis, failure history, and available engineering sources",
    outcome:
      "A governed asset and failure-mode foundation with assumptions, evidence gaps, readiness gates, and approval needs",
    successMetric:
      "Asset coverage, unresolved hierarchy and criticality gaps, failure-mode coverage, and decision-ready assets",
    boundary:
      "Starter templates and inferred structure remain draft until customer, site, OEM, or engineering evidence is reviewed.",
  },
] as const;

export type ProductEntryAttribution = {
  source?: string;
  campaign?: string;
  variant?: string;
};

export function productEntryById(id: string): ProductEntryPath | undefined {
  const canonicalId =
    id === "downtime-reduction" ? "failure-investigation" : id;
  return PRODUCT_ENTRY_PATHS.find((entry) => entry.id === canonicalId);
}

export function productEntryPath(entry: Pick<ProductEntryPath, "id">): string {
  return `/solutions/${entry.id}`;
}

export function productEntryDestination(
  entry: Pick<ProductEntryPath, "id" | "intentId">,
  attribution: ProductEntryAttribution = {},
): string {
  const params = new URLSearchParams({ entry: entry.id });
  for (const [key, value] of Object.entries(attribution)) {
    const normalized = value?.trim();
    if (normalized) params.set(key, normalized);
  }
  return `/get-started?${params.toString()}`;
}

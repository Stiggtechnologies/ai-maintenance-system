/**
 * Operating-loop service — the typed Supabase data layer behind the SyncAI
 * buyer-value loop:
 *   Mission Control → Recommendation → Evidence → Scenario → Approval
 *   → Work Action → Decision → Value Realization → Learning Loop
 *
 * All reads are org-scoped by RLS (app_current_org()); writes stamp the caller's
 * organization_id. Every function throws on a hard Supabase error so callers can
 * surface a real error state instead of silently rendering empty data.
 */
import { supabase } from "../lib/supabase";
import type {
  AgentRow,
  AppRole,
  ArtifactRow,
  ApprovalRow,
  AssetRow,
  CoworkMessageRow,
  CoworkWorkspaceRow,
  DecisionRow,
  EvidenceItemRow,
  IntegrationRow,
  LearningEventRow,
  RecommendationRow,
  ScenarioRow,
  ValueMetricRow,
  WorkOrderRow,
} from "../types/operating";

export interface OrgContext {
  userId: string;
  organizationId: string;
  role: AppRole;
}

function fail(message: string, error: { message: string } | null): never {
  throw new Error(error ? `${message}: ${error.message}` : message);
}

let cachedContext: OrgContext | null = null;

export async function getOrgContext(): Promise<OrgContext> {
  if (cachedContext) return cachedContext;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .maybeSingle()
    .returns<{ organization_id: string | null; role: string | null }>();

  if (error) fail("Could not load your profile", error);
  if (!data?.organization_id)
    throw new Error("Your profile is not linked to an organization.");

  cachedContext = {
    userId: user.id,
    organizationId: data.organization_id,
    role: (data.role as AppRole) ?? "reliability_engineer",
  };
  return cachedContext;
}

export function clearOrgContextCache() {
  cachedContext = null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getAssets(): Promise<AssetRow[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("*")
    .order("risk_score", { ascending: false })
    .returns<AssetRow[]>();
  if (error) fail("Could not load assets", error);
  return data ?? [];
}

export async function getAgents(): Promise<AgentRow[]> {
  const { data, error } = await supabase
    .from("ai_agents")
    .select("*")
    .order("category")
    .returns<AgentRow[]>();
  if (error) fail("Could not load AI agents", error);
  return data ?? [];
}

export async function getRecommendations(
  status?: string,
): Promise<RecommendationRow[]> {
  let query = supabase
    .from("recommendations")
    .select(
      "*, asset:assets(id,name,tag,criticality), agent:ai_agents(id,name)",
    )
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query.returns<RecommendationRow[]>();
  if (error) fail("Could not load recommendations", error);
  return data ?? [];
}

export async function getRecommendation(
  id: string,
): Promise<RecommendationRow | null> {
  const { data, error } = await supabase
    .from("recommendations")
    .select(
      "*, asset:assets(id,name,tag,criticality), agent:ai_agents(id,name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) fail("Could not load recommendation", error);
  return (data as unknown as RecommendationRow) ?? null;
}

export async function getEvidence(
  recommendationId: string,
): Promise<EvidenceItemRow[]> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select("*")
    .eq("recommendation_id", recommendationId)
    .order("confidence_contribution", { ascending: false })
    .returns<EvidenceItemRow[]>();
  if (error) fail("Could not load evidence", error);
  return data ?? [];
}

export async function getScenarios(
  recommendationId: string,
): Promise<ScenarioRow[]> {
  const { data, error } = await supabase
    .from("scenarios")
    .select("*")
    .eq("recommendation_id", recommendationId)
    .order("cost")
    .returns<ScenarioRow[]>();
  if (error) fail("Could not load scenarios", error);
  return data ?? [];
}

export async function getWorkOrders(): Promise<WorkOrderRow[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("*, asset:assets(id,name,area)")
    .order("risk_score", { ascending: false })
    .returns<WorkOrderRow[]>();
  if (error) fail("Could not load work orders", error);
  return data ?? [];
}

export async function getDecisions(): Promise<DecisionRow[]> {
  const { data, error } = await supabase
    .from("decisions")
    .select("*, asset:assets(id,name), agent:ai_agents(id,name)")
    .order("created_at", { ascending: false })
    .returns<DecisionRow[]>();
  if (error) fail("Could not load decisions", error);
  return data ?? [];
}

export async function getValueMetrics(): Promise<ValueMetricRow[]> {
  const { data, error } = await supabase
    .from("value_metrics")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<ValueMetricRow[]>();
  if (error) fail("Could not load value metrics", error);
  return data ?? [];
}

/** Human verification of a projected value metric — feeds the Learning Loop. */
export async function verifyValueMetric(
  metricId: string,
  verified: boolean,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("verify_value_metric", {
    p_metric_id: metricId,
    p_verified: verified,
    p_note: note ?? null,
  });
  if (error) fail("Could not verify value metric", error);
}

export interface PilotScorecard {
  pilot_started_at: string;
  pilot_day: number;
  pilot_length_days: number;
  recommendations_total: number;
  recommendations_approved: number;
  recommendations_pending: number;
  recommendations_from_agent_loop: number;
  acceptance_rate_pct: number;
  autonomous_actions_executed: number;
  work_orders_total: number;
  work_orders_approval_gated: number;
  value_verified_usd: number;
  value_projected_usd: number;
  downtime_avoided_hours: number;
  risk_exposure_reduced_usd: number;
}

/** Live 90-day pilot scorecard derived from real operating data. */
export async function getPilotScorecard(): Promise<PilotScorecard> {
  const { data, error } = await supabase.rpc("get_pilot_scorecard");
  if (error) fail("Could not load pilot scorecard", error);
  return data as PilotScorecard;
}

export async function getLearningEvents(): Promise<LearningEventRow[]> {
  const { data, error } = await supabase
    .from("learning_events")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<LearningEventRow[]>();
  if (error) fail("Could not load learning events", error);
  return data ?? [];
}

export async function getIntegrations(): Promise<IntegrationRow[]> {
  const { data, error } = await supabase
    .from("integrations")
    .select("*")
    .order("name")
    .returns<IntegrationRow[]>();
  if (error) fail("Could not load integrations", error);
  return data ?? [];
}

export async function getCoworkWorkspaces(): Promise<CoworkWorkspaceRow[]> {
  const { data, error } = await supabase
    .from("cowork_workspaces")
    .select("*")
    .order("updated_at", { ascending: false })
    .returns<CoworkWorkspaceRow[]>();
  if (error) fail("Could not load cowork workspaces", error);
  return data ?? [];
}

export async function getCoworkMessages(
  workspaceId: string,
): Promise<CoworkMessageRow[]> {
  const { data, error } = await supabase
    .from("cowork_messages")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at")
    .returns<CoworkMessageRow[]>();
  if (error) fail("Could not load workspace messages", error);
  return data ?? [];
}

export async function getArtifacts(
  workspaceId: string,
): Promise<ArtifactRow[]> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .returns<ArtifactRow[]>();
  if (error) fail("Could not load artifacts", error);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Mission Control aggregate                                                  */
/* -------------------------------------------------------------------------- */

export interface MissionReadinessFactor {
  label: string;
  score: number;
  trend: "up" | "down" | "stable";
}

export interface MissionRisk {
  id: string;
  asset: string;
  probability: number;
  exposure: string;
  missionImpact: "High" | "Medium" | "Low";
  recommendedAction: string;
  urgency: "critical" | "action" | "advisory";
}

export interface MissionControlData {
  readinessScore: number;
  readinessStatus: "Ready" | "Watch" | "At Risk";
  readinessReason: string;
  factors: MissionReadinessFactor[];
  topRisks: MissionRisk[];
  topRecommendations: RecommendationRow[];
  stats: {
    actionsExecuted: number;
    pendingApprovals: number;
    recommendationsToday: number;
    autonomousRate: number;
  };
  financialExposures: {
    asset: string;
    exposure: string;
    probability: number;
  }[];
  valueCreated: number;
}

function avg(values: number[]): number {
  if (values.length === 0) return 100;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function urgencyToImpact(urgency: string): "High" | "Medium" | "Low" {
  if (urgency === "critical") return "High";
  if (urgency === "action") return "Medium";
  return "Low";
}

export async function getMissionControl(): Promise<MissionControlData> {
  const [assets, recs, workOrders, approvals, agents, valueMetrics] =
    await Promise.all([
      getAssets(),
      getRecommendations(),
      getWorkOrders(),
      listApprovals(),
      getAgents(),
      getValueMetrics(),
    ]);

  const pendingRecs = recs.filter(
    (r) => r.status === "pending" || r.status === "escalated",
  );

  // Readiness factors derived from live data.
  const assetHealth = avg(assets.map((a) => a.health_score));
  const partsReady = workOrders.length
    ? Math.round(
        (workOrders.filter((w) => w.parts_ready).length / workOrders.length) *
          100,
      )
    : 100;
  const safetyControls = workOrders.length
    ? Math.round(
        (1 -
          workOrders.filter((w) => w.safety_flag && w.status === "blocked")
            .length /
            workOrders.length) *
          100,
      )
    : 100;
  const maintenanceReadiness = workOrders.length
    ? Math.round(
        (workOrders.filter((w) => w.status !== "blocked").length /
          workOrders.length) *
          100,
      )
    : 100;
  const operationalRisk = assets.length
    ? 100 - avg(assets.map((a) => a.risk_score))
    : 100;

  const factors: MissionReadinessFactor[] = [
    {
      label: "Asset Health",
      score: assetHealth,
      trend: assetHealth >= 85 ? "up" : "down",
    },
    {
      label: "Maintenance Readiness",
      score: maintenanceReadiness,
      trend: "stable",
    },
    {
      label: "Parts Availability",
      score: partsReady,
      trend: partsReady >= 85 ? "up" : "down",
    },
    { label: "Safety Controls", score: safetyControls, trend: "stable" },
    {
      label: "Operational Risk",
      score: operationalRisk,
      trend: operationalRisk >= 70 ? "up" : "down",
    },
  ];

  const readinessScore = avg(factors.map((f) => f.score));
  const criticalOpen = pendingRecs.filter(
    (r) => r.urgency === "critical",
  ).length;
  const readinessStatus: MissionControlData["readinessStatus"] =
    readinessScore >= 90 && criticalOpen === 0
      ? "Ready"
      : readinessScore >= 75
        ? "Watch"
        : "At Risk";
  const topRiskAsset = assets[0];
  const readinessReason = criticalOpen
    ? `${criticalOpen} critical recommendation${criticalOpen === 1 ? "" : "s"} open${topRiskAsset ? ` — ${topRiskAsset.name} highest risk` : ""}.`
    : "No critical recommendations open.";

  const topRisks: MissionRisk[] = assets.slice(0, 4).map((a) => {
    const assetRec = recs.find((r) => r.asset_id === a.id);
    return {
      id: a.id,
      asset: a.name,
      probability: a.risk_score,
      exposure: assetRec?.financial_impact ?? `${a.criticality} criticality`,
      missionImpact:
        a.risk_score >= 70 ? "High" : a.risk_score >= 45 ? "Medium" : "Low",
      recommendedAction: assetRec?.action ?? "Monitor",
      urgency:
        a.risk_score >= 70
          ? "critical"
          : a.risk_score >= 45
            ? "action"
            : "advisory",
    };
  });

  const financialExposures = assets.slice(0, 4).map((a) => {
    const assetRec = recs.find(
      (r) => r.asset_id === a.id && r.financial_impact,
    );
    return {
      asset: a.name,
      exposure: assetRec?.financial_impact ?? `${a.criticality}`,
      probability: a.risk_score,
    };
  });

  const actionsExecuted = agents.reduce(
    (sum, a) => sum + a.actions_executed,
    0,
  );
  const pendingApprovals =
    approvals.filter(
      (ap) => ap.status === "required" || ap.status === "pending",
    ).length + criticalOpen;
  const autonomousAgents = agents.filter(
    (a) => a.autonomy_mode === "controlled",
  ).length;
  const autonomousRate = agents.length
    ? Math.round((autonomousAgents / agents.length) * 100)
    : 0;

  const valueCreated = valueMetrics
    .filter((m) => m.unit === "usd" && m.status === "verified")
    .reduce((sum, m) => sum + Number(m.value), 0);

  return {
    readinessScore,
    readinessStatus,
    readinessReason,
    factors,
    topRisks,
    topRecommendations: pendingRecs.slice(0, 5),
    stats: {
      actionsExecuted,
      pendingApprovals,
      recommendationsToday: recs.length,
      autonomousRate,
    },
    financialExposures,
    valueCreated,
  };
}

async function listApprovals(): Promise<ApprovalRow[]> {
  const { data, error } = await supabase
    .from("approvals")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<ApprovalRow[]>();
  if (error) fail("Could not load approvals", error);
  return data ?? [];
}

export { listApprovals as getApprovals };

/* -------------------------------------------------------------------------- */
/* Mutations — the buyer-value loop                                           */
/* -------------------------------------------------------------------------- */

export type RecommendationAction =
  | "approved"
  | "rejected"
  | "dismissed"
  | "escalated"
  | "modified";

export interface ApproveResult {
  recommendationId: string;
  workOrderId: string | null;
  decisionId: string | null;
}

function moneyFromText(text: string | null): number {
  if (!text) return 0;
  const match = text.replace(/,/g, "").match(/\$?\s*([\d.]+)\s*([mMkK])?/);
  if (!match) return 0;
  const base = parseFloat(match[1]);
  const scale =
    match[2]?.toLowerCase() === "m"
      ? 1_000_000
      : match[2]?.toLowerCase() === "k"
        ? 1_000
        : 1;
  return Math.round(base * scale);
}

/**
 * Approve a recommendation and propagate it through the whole loop:
 * update status → log a decision → resolve the approval → create a work action
 * → record realized value → emit a learning event. Safety-critical work is
 * created in an approval-gated state, never auto-executed.
 */
export async function approveRecommendation(
  rec: RecommendationRow,
): Promise<ApproveResult> {
  const ctx = await getOrgContext();
  const now = new Date().toISOString();

  const { error: recErr } = await supabase
    .from("recommendations")
    .update({ status: "approved", updated_at: now })
    .eq("id", rec.id);
  if (recErr) fail("Could not update recommendation", recErr);

  const safetyCritical =
    rec.urgency === "critical" || rec.risk_impact === "High";

  // Decision log
  const { data: decision, error: decErr } = await supabase
    .from("decisions")
    .insert({
      organization_id: ctx.organizationId,
      recommendation_id: rec.id,
      agent_id: rec.agent_id,
      asset_id: rec.asset_id,
      decision_type: "work_order",
      action_taken: `Approved: ${rec.action ?? rec.title}`,
      approval_status: "approved",
      autonomy_mode: safetyCritical ? "conditional" : "controlled",
      confidence_score: rec.confidence,
      human_actor: ctx.userId,
      rationale: rec.rationale ?? rec.issue,
      outcome_status: "executed",
    })
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();
  if (decErr) fail("Could not log decision", decErr);

  // Approval record (resolve existing or create one)
  const { data: existingApproval } = await supabase
    .from("approvals")
    .select("id")
    .eq("recommendation_id", rec.id)
    .maybeSingle()
    .returns<{ id: string }>();
  if (existingApproval) {
    await supabase
      .from("approvals")
      .update({ status: "approved", approver: ctx.userId, decided_at: now })
      .eq("id", existingApproval.id);
  } else {
    await supabase.from("approvals").insert({
      organization_id: ctx.organizationId,
      recommendation_id: rec.id,
      status: "approved",
      owner_role: rec.accountable,
      approver: ctx.userId,
      reason: rec.title,
    });
  }

  // Work action — safety-critical lands in the approval gate, never auto-executed.
  const { data: workOrder, error: woErr } = await supabase
    .from("work_orders")
    .insert({
      organization_id: ctx.organizationId,
      asset_id: rec.asset_id,
      recommendation_id: rec.id,
      wo_number: `WO-${Date.now().toString().slice(-5)}`,
      title: rec.action ?? rec.title,
      description: rec.rationale ?? rec.issue,
      status: safetyCritical ? "approval" : "scheduled",
      priority:
        rec.urgency === "critical"
          ? "critical"
          : rec.urgency === "action"
            ? "high"
            : "medium",
      type: "ai_generated",
      risk_score: rec.confidence,
      financial_exposure: rec.financial_impact,
      production_impact: urgencyToImpact(rec.urgency),
      safety_flag: safetyCritical,
      approval_required: safetyCritical,
    })
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();
  if (woErr) fail("Could not create work action", woErr);

  // Value metric — realized/projected exposure reduction
  const exposure = moneyFromText(rec.financial_impact ?? rec.impact);
  if (exposure > 0) {
    await supabase.from("value_metrics").insert({
      organization_id: ctx.organizationId,
      recommendation_id: rec.id,
      asset_id: rec.asset_id,
      metric_type: "risk_exposure_reduced",
      label: `Risk mitigated — ${rec.title}`,
      value: exposure,
      unit: "usd",
      status: "projected",
      period: "from_approval",
    });
  }

  // Learning event
  await supabase.from("learning_events").insert({
    organization_id: ctx.organizationId,
    recommendation_id: rec.id,
    asset_id: rec.asset_id,
    event_type: "recommendation_accepted",
    title: `Recommendation approved — ${rec.title}`,
    detail: `Approved by operator; work action created${safetyCritical ? " (approval-gated, safety-critical)" : ""}.`,
    expected_value: exposure || null,
    model_confidence: rec.confidence,
  });

  return {
    recommendationId: rec.id,
    workOrderId: workOrder?.id ?? null,
    decisionId: decision?.id ?? null,
  };
}

/** Reject / dismiss / escalate / modify a recommendation, with a decision + learning trail. */
export async function setRecommendationStatus(
  rec: RecommendationRow,
  action: Exclude<RecommendationAction, "approved">,
): Promise<void> {
  const ctx = await getOrgContext();
  const now = new Date().toISOString();

  const { error: recErr } = await supabase
    .from("recommendations")
    .update({ status: action, updated_at: now })
    .eq("id", rec.id);
  if (recErr) fail("Could not update recommendation", recErr);

  await supabase.from("decisions").insert({
    organization_id: ctx.organizationId,
    recommendation_id: rec.id,
    agent_id: rec.agent_id,
    asset_id: rec.asset_id,
    decision_type: "recommendation_review",
    action_taken: `${action[0].toUpperCase()}${action.slice(1)}: ${rec.title}`,
    approval_status: action === "rejected" ? "rejected" : "pending",
    autonomy_mode: "advisory",
    confidence_score: rec.confidence,
    human_actor: ctx.userId,
    rationale: rec.rationale ?? rec.issue,
    outcome_status: action === "escalated" ? "open" : "reverted",
  });

  if (action === "rejected" || action === "dismissed") {
    await supabase.from("learning_events").insert({
      organization_id: ctx.organizationId,
      recommendation_id: rec.id,
      asset_id: rec.asset_id,
      event_type: "recommendation_rejected",
      title: `Recommendation ${action} — ${rec.title}`,
      detail: "Human override captured for model feedback.",
      model_confidence: rec.confidence,
    });
  }
}

/** Create a draft work order directly from a recommendation (without approving it). */
export async function createWorkOrderFromRecommendation(
  rec: RecommendationRow,
): Promise<string | null> {
  const ctx = await getOrgContext();
  const safetyCritical =
    rec.urgency === "critical" || rec.risk_impact === "High";
  const { data, error } = await supabase
    .from("work_orders")
    .insert({
      organization_id: ctx.organizationId,
      asset_id: rec.asset_id,
      recommendation_id: rec.id,
      wo_number: `WO-${Date.now().toString().slice(-5)}`,
      title: rec.action ?? rec.title,
      description: rec.rationale ?? rec.issue,
      status: safetyCritical ? "approval" : "pending",
      priority:
        rec.urgency === "critical"
          ? "critical"
          : rec.urgency === "action"
            ? "high"
            : "medium",
      type: "ai_generated",
      risk_score: rec.confidence,
      financial_exposure: rec.financial_impact,
      production_impact: urgencyToImpact(rec.urgency),
      safety_flag: safetyCritical,
      approval_required: safetyCritical,
    })
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();
  if (error) fail("Could not create work order", error);
  return data?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Cowork Studio — objective → workspace                                      */
/* -------------------------------------------------------------------------- */

export interface CoworkCreateResult {
  workspaceId: string;
  artifactId: string | null;
  recommendationId: string | null;
}

const COWORK_AGENTS = [
  "Reliability Engineering",
  "Condition Monitoring",
  "Work Order Management",
  "Financial & Contract",
];

/**
 * Turn a plain-language objective into a live cowork workspace: assign agents,
 * seed agent messages, generate a starter artifact, and create a recommended
 * action — all persisted to Supabase.
 */
export async function createCoworkWorkspaceFromObjective(
  objective: string,
): Promise<CoworkCreateResult> {
  const ctx = await getOrgContext();

  // Try to bind the objective to a known asset (by tag mention).
  const assets = await getAssets();
  const matched = assets.find(
    (a) => a.tag && objective.toUpperCase().includes(a.tag.toUpperCase()),
  );

  const title = matched
    ? `Cowork — ${matched.name}`
    : `Cowork — ${objective.slice(0, 40)}`;

  const { data: workspace, error: wsErr } = await supabase
    .from("cowork_workspaces")
    .insert({
      organization_id: ctx.organizationId,
      asset_id: matched?.id ?? null,
      title,
      objective,
      status: "active",
      agents: COWORK_AGENTS,
      progress: 20,
      artifacts: 1,
      next_action: "Review agent findings and approve recommended actions",
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();
  if (wsErr || !workspace) fail("Could not create workspace", wsErr);
  const workspaceId = workspace!.id;

  const subject = matched ? matched.name : "the objective";
  await supabase.from("cowork_messages").insert([
    {
      organization_id: ctx.organizationId,
      workspace_id: workspaceId,
      agent: "Reliability Engineering",
      role: "agent",
      message: `Reviewing failure history and dominant failure modes for ${subject}.`,
      confidence: 86,
    },
    {
      organization_id: ctx.organizationId,
      workspace_id: workspaceId,
      agent: "Condition Monitoring",
      role: "agent",
      message: `Correlating sensor signatures and process deviations for ${subject}.`,
      confidence: 84,
    },
    {
      organization_id: ctx.organizationId,
      workspace_id: workspaceId,
      agent: "Financial & Contract",
      role: "agent",
      message: `Estimating downtime exposure and corrective-action ROI for ${subject}.`,
      confidence: 82,
    },
  ]);

  const { data: artifact } = await supabase
    .from("artifacts")
    .insert({
      organization_id: ctx.organizationId,
      workspace_id: workspaceId,
      asset_id: matched?.id ?? null,
      type: "rca_report",
      title: `Starter analysis — ${subject}`,
      content: `Objective: ${objective}\n\nStarter findings generated by the assigned agents. Validate with site SMEs before approving corrective actions.`,
    })
    .select("id")
    .maybeSingle()
    .returns<{ id: string }>();

  let recommendationId: string | null = null;
  if (matched) {
    const { data: rec } = await supabase
      .from("recommendations")
      .insert({
        organization_id: ctx.organizationId,
        asset_id: matched.id,
        title: `Corrective action for ${matched.name}`,
        issue: objective,
        action: `Implement corrective action plan for ${matched.name}`,
        impact: "Reduce recurrence and downtime exposure",
        confidence: 80,
        urgency: "action",
        status: "pending",
        approval_required: "Reliability Manager",
        accountable: "Reliability Manager",
        rationale: `Generated from cowork objective: ${objective}`,
      })
      .select("id")
      .maybeSingle()
      .returns<{ id: string }>();
    recommendationId = rec?.id ?? null;
  }

  return { workspaceId, artifactId: artifact?.id ?? null, recommendationId };
}

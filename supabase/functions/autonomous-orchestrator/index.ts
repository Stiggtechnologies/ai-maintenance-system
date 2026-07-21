import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INTERNAL_SECRET = Deno.env.get("AUTONOMOUS_INTERNAL_SECRET") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

interface AuthContext {
  internal: boolean;
  userId: string;
  organizationId: string;
  role: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearer(req: Request): string {
  const value = req.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearer(req);
  if (!token) return null;
  const internal = (SERVICE_ROLE_KEY && safeEqual(token, SERVICE_ROLE_KEY)) ||
    (INTERNAL_SECRET && safeEqual(token, INTERNAL_SECRET));
  if (internal) {
    return { internal: true, userId: "00000000-0000-0000-0000-000000000000", organizationId: "", role: "service_role" };
  }

  const admin = adminClient();
  const { data: userResult, error: authError } = await admin.auth.getUser(token);
  if (authError || !userResult.user) return null;
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) return null;
  return {
    internal: false,
    userId: userResult.user.id,
    organizationId: profile.organization_id,
    role: String(profile.role ?? "user").toLowerCase(),
  };
}

const APPROVAL_ROLES = new Set([
  "admin",
  "manager",
  "maintenance_manager",
  "plant_manager",
  "operations_manager",
  "reliability_engineer",
]);

function canApprove(auth: AuthContext): boolean {
  return auth.internal || APPROVAL_ROLES.has(auth.role);
}

async function monitorAssets(admin: ReturnType<typeof adminClient>) {
  const { data: assets, error } = await admin
    .from("assets")
    .select("id, organization_id, name, criticality, status")
    .in("status", ["healthy", "watch", "critical", "operational", "maintenance"]);
  if (error) throw error;

  let decisionsCreated = 0;
  let healthUpdates = 0;
  for (const asset of assets ?? []) {
    const { data: signals } = await admin
      .from("normalized_signals")
      .select("signal_type, numeric_value")
      .eq("asset_id", asset.id)
      .gte("signal_time", new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order("signal_time", { ascending: false })
      .limit(20);

    if (!signals?.length) continue;
    const temp = Number(signals.find((s: any) => s.signal_type === "temperature")?.numeric_value ?? 90);
    const vibration = Number(signals.find((s: any) => s.signal_type === "vibration")?.numeric_value ?? 5);
    const pressure = Number(signals.find((s: any) => s.signal_type === "pressure")?.numeric_value ?? 115);
    const healthScore = Math.max(0, Math.min(100,
      100 - Math.max(0, temp - 90) * 2 - Math.max(0, vibration - 5) * 10 - ((pressure > 150 || pressure < 80) ? 15 : 0)
    ));
    const anomaly = healthScore < 60;

    const { error: healthError } = await admin.from("asset_health_monitoring").insert({
      asset_id: asset.id,
      health_score: healthScore,
      anomaly_detected: anomaly,
      sensor_data: { temperature: temp, vibration, pressure },
      ai_analysis: anomaly ? `Condition threshold breach detected. Health score ${healthScore.toFixed(1)}.` : "Operating within configured thresholds.",
      recommendations: anomaly ? ["Validate signal quality", "Inspect the affected asset", "Route a maintenance recommendation for human review"] : ["Continue monitoring"],
    });
    if (!healthError) healthUpdates += 1;

    if (anomaly && healthScore < 50) {
      const correlationId = crypto.randomUUID();
      const { error: decisionError } = await admin.from("autonomous_decisions").insert({
        tenant_id: asset.organization_id,
        correlation_id: correlationId,
        asset_id: asset.id,
        autonomy_level: "advisory",
        decision_type: "work_order_creation",
        decision_data: {
          asset_name: asset.name,
          reason: "Low condition-derived health score",
          health_score: healthScore,
          recommended_action: "Create a governed inspection work order",
        },
        confidence_score: Math.min(95, Math.round(100 - healthScore)),
        requires_approval: true,
        status: "pending",
        approval_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (!decisionError) decisionsCreated += 1;
    }
  }

  return json({ success: true, monitored_assets: assets?.length ?? 0, health_updates: healthUpdates, decisions_created: decisionsCreated, execution_mode: "human_approval_required" });
}

async function processDecision(admin: ReturnType<typeof adminClient>, auth: AuthContext, data: any) {
  if (!canApprove(auth)) return json({ success: false, error: "approval_authority_required" }, 403);
  const decisionId = String(data?.decision_id ?? "");
  const approved = Boolean(data?.approved);
  if (!decisionId) return json({ success: false, error: "decision_id_required" }, 400);

  const query = admin.from("autonomous_decisions").select("id, tenant_id, status, decision_type, decision_data, work_order_id").eq("id", decisionId);
  if (!auth.internal) query.eq("tenant_id", auth.organizationId);
  const { data: decision, error } = await query.maybeSingle();
  if (error || !decision) return json({ success: false, error: "decision_not_found" }, 404);
  if (decision.status !== "pending") return json({ success: false, error: "decision_not_pending", status: decision.status }, 409);

  const status = approved ? "approved" : "rejected";
  const { data: updated, error: updateError } = await admin
    .from("autonomous_decisions")
    .update({ status, approved_by: auth.userId, executed_at: approved ? new Date().toISOString() : null })
    .eq("id", decisionId)
    .eq("status", "pending")
    .select()
    .single();
  if (updateError) throw updateError;

  await admin.from("approval_workflows").update({
    status,
    responded_at: new Date().toISOString(),
    approver_id: auth.userId,
  }).eq("decision_id", decisionId).eq("status", "pending");

  return json({ success: true, decision: updated, executed: false, note: approved ? "Approved; use the governed execute action to apply the selected side-effect." : "Rejected; no operational side-effect was applied." });
}

async function createIntelligenceDecision(admin: ReturnType<typeof adminClient>, data: any) {
  const tenantId = String(data?.tenant_id ?? "");
  const correlationId = String(data?.correlation_id ?? "");
  const taskCode = String(data?.task_code ?? "");
  if (!tenantId || !correlationId || !taskCode) return json({ success: false, error: "invalid_decision_input" }, 400);

  const confidence = Math.max(0, Math.min(1, Number(data?.confidence ?? 0.5)));
  const { data: decision, error } = await admin.from("autonomous_decisions").insert({
    tenant_id: tenantId,
    correlation_id: correlationId,
    asset_id: data.asset_id ?? null,
    work_order_id: data.work_order_id ?? null,
    autonomy_level: data.autonomy_level ?? "advisory",
    decision_type: "reliability_recommendation",
    decision_data: {
      task_code: taskCode,
      agent_run_id: data.agent_run_id,
      raw_summary: data.raw_summary,
      ...(data.structured_output ?? {}),
    },
    confidence_score: Math.round(confidence * 100),
    requires_approval: true,
    status: "pending",
    approval_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }).select("id").single();
  if (error) {
    console.error("create intelligence decision failed", error);
    return json({ success: false, error: "decision_create_failed", correlation_id: correlationId }, 500);
  }
  const { data: workflow } = await admin.from("approval_workflows").select("id, status").eq("decision_id", decision.id).maybeSingle();
  return json({ success: true, decision_id: decision.id, correlation_id: correlationId, approval_workflow_id: workflow?.id ?? null, approval_status: workflow?.status ?? "pending" });
}

async function createFailedDecision(admin: ReturnType<typeof adminClient>, data: any) {
  const correlationId = String(data?.correlation_id ?? crypto.randomUUID());
  const { data: decision, error } = await admin.from("autonomous_decisions").insert({
    tenant_id: data?.tenant_id,
    correlation_id: correlationId,
    asset_id: data?.asset_id ?? null,
    work_order_id: data?.work_order_id ?? null,
    decision_type: "reliability_recommendation",
    decision_data: { task_code: data?.task_code, error: "intelligence_invocation_failed", failed: true },
    confidence_score: 0,
    status: "failed",
    requires_approval: false,
  }).select("id").single();
  if (error) console.error("failed decision audit record failed", error);
  return json({ success: !error, decision_id: decision?.id ?? null, correlation_id: correlationId });
}

async function approveAndExecute(admin: ReturnType<typeof adminClient>, auth: AuthContext, data: any) {
  if (!canApprove(auth)) return json({ success: false, error: "approval_authority_required" }, 403);
  const decisionId = String(data?.decision_id ?? "");
  if (!decisionId) return json({ success: false, error: "decision_id_required" }, 400);
  const actionType = String(data?.action_type ?? "append_work_order_note");
  const allowedActions = new Set(["append_work_order_note", "create_follow_up_task", "flag_for_engineering_review"]);
  if (!allowedActions.has(actionType)) return json({ success: false, error: "action_type_not_allowed" }, 400);

  const idempotencyKey = `approve_execute:${decisionId}`;
  const { data: existing } = await admin.from("autonomous_actions").select("id, correlation_id, action_type").eq("idempotency_key", idempotencyKey).eq("success", true).maybeSingle();
  if (existing) return json({ success: true, idempotent_replay: true, action_id: existing.id, correlation_id: existing.correlation_id, action_type: existing.action_type });

  const decisionQuery = admin.from("autonomous_decisions").select("*").eq("id", decisionId);
  if (!auth.internal) decisionQuery.eq("tenant_id", auth.organizationId);
  const { data: decision } = await decisionQuery.maybeSingle();
  if (!decision) return json({ success: false, error: "decision_not_found" }, 404);
  if (!["pending", "approved"].includes(decision.status)) return json({ success: false, error: "decision_not_executable", status: decision.status }, 409);

  const tenantId = decision.tenant_id;
  const correlationId = decision.correlation_id ?? crypto.randomUUID();
  const noteText = String(data?.action_note ?? decision.decision_data?.raw_summary ?? decision.decision_data?.summary ?? "Approved SyncAI recommendation.");
  const affected: string[] = [];

  if (actionType === "append_work_order_note" && decision.work_order_id) {
    const { data: history, error: historyError } = await admin.from("work_order_status_history").insert({
      work_order_id: decision.work_order_id,
      status_from: "in_progress",
      status_to: "in_progress",
      changed_by: auth.userId,
      changed_at: new Date().toISOString(),
      comments: `[SyncAI recommendation approved]\n${noteText}`,
    }).select("id").single();
    if (historyError) throw historyError;
    affected.push(`work_order_status_history:${history.id}`);
  }

  if (actionType === "create_follow_up_task" && decision.work_order_id) {
    const { data: task, error: taskError } = await admin.from("work_orders").insert({
      organization_id: tenantId,
      asset_id: decision.asset_id,
      recommendation_id: null,
      title: `Follow-up: ${noteText.slice(0, 120)}`,
      description: noteText,
      status: "pending",
      priority: "medium",
      type: "ai_generated",
      approval_required: false,
    }).select("id").single();
    if (taskError) throw taskError;
    affected.push(`work_orders:${task.id}`);
  }

  await admin.from("autonomous_decisions").update({ status: "approved", approved_by: auth.userId, executed_at: new Date().toISOString() }).eq("id", decisionId);
  await admin.from("approval_workflows").update({ status: "approved", responded_at: new Date().toISOString(), approver_id: auth.userId }).eq("decision_id", decisionId).eq("status", "pending");

  const executionResult = { status: "success", affected_records: affected, timestamp: new Date().toISOString() };
  const { data: action, error: actionError } = await admin.from("autonomous_actions").insert({
    tenant_id: tenantId,
    correlation_id: correlationId,
    decision_id: decisionId,
    idempotency_key: idempotencyKey,
    action_type: actionType,
    target_id: decision.work_order_id,
    action_data: { note: noteText, approved_by: auth.userId },
    triggered_by: "ApprovalExecution",
    success: true,
    executed_at: new Date().toISOString(),
    execution_result: executionResult,
  }).select("id").single();
  if (actionError) throw actionError;
  return json({ success: true, decision_id: decisionId, action_id: action.id, correlation_id: correlationId, action_type: actionType, executed: true, execution_result: executionResult });
}

async function generateHealthReport(admin: ReturnType<typeof adminClient>, auth: AuthContext) {
  const assetQuery = admin.from("assets").select("id, name, organization_id, status, health_score, risk_score");
  if (!auth.internal) assetQuery.eq("organization_id", auth.organizationId);
  const { data: assets, error } = await assetQuery;
  if (error) throw error;
  const rows = assets ?? [];
  const avg = rows.length ? rows.reduce((sum: number, asset: any) => sum + Number(asset.health_score ?? 0), 0) / rows.length : 0;
  return json({
    total_assets: rows.length,
    critical_assets: rows.filter((asset: any) => Number(asset.health_score ?? 100) < 50 || asset.status === "critical").length,
    average_health: Number(avg.toFixed(1)),
    assets: rows,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "service_unavailable" }, 503);

  const auth = await authenticate(req);
  if (!auth) return json({ success: false, error: "unauthorized" }, 401);

  try {
    const { action, data } = await req.json();
    const admin = adminClient();
    const internalOnly = new Set(["monitor_assets", "execute_autonomous_action", "create_intelligence_decision", "create_failed_decision"]);
    if (internalOnly.has(action) && !auth.internal) return json({ success: false, error: "internal_authorization_required" }, 403);

    switch (action) {
      case "monitor_assets": return await monitorAssets(admin);
      case "process_decision": return await processDecision(admin, auth, data);
      case "approve_and_execute_decision": return await approveAndExecute(admin, auth, data);
      case "generate_health_report": return await generateHealthReport(admin, auth);
      case "create_intelligence_decision": return await createIntelligenceDecision(admin, data);
      case "create_failed_decision": return await createFailedDecision(admin, data);
      case "execute_autonomous_action":
        return json({ success: false, error: "direct_execution_disabled_use_approval_workflow" }, 409);
      default: return json({ success: false, error: "unknown_action" }, 400);
    }
  } catch (error) {
    console.error("autonomous-orchestrator request failed", error);
    return json({ success: false, error: "request_failed" }, 500);
  }
});

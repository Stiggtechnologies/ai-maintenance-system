import { supabase } from "../lib/supabase";
import {
  buildAssetOnboardingExports,
  type AssetOnboardingIndustry,
  type AssetOnboardingLifecycle,
  type AssetOnboardingExports,
  type AssetOnboardingSession,
} from "../lib/asset-onboarding";

const LOCAL_STORAGE_KEY = "syncai.assetOnboarding.sessions.v1";

export type AssetOnboardingPersistenceMode = "supabase" | "local";

export interface AssetOnboardingSummary {
  sessionId: string;
  assetId: string;
  assetClass: string;
  mode: string;
  lifecycle: AssetOnboardingLifecycle;
  industry: AssetOnboardingIndustry;
  status: string;
  completionScore: number;
  reliabilityReadiness: string;
  currentStep: string;
  updatedAt: string;
  source: AssetOnboardingPersistenceMode;
}

export interface AssetOnboardingSaveResult {
  mode: AssetOnboardingPersistenceMode;
  sessionId: string;
  warning?: string;
}

interface StoredAssetOnboardingSession {
  session: AssetOnboardingSession;
  exports?: AssetOnboardingExports;
}

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): BrowserStorage | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  if (
    typeof storage?.getItem !== "function" ||
    typeof storage?.setItem !== "function" ||
    typeof storage?.removeItem !== "function"
  ) {
    return null;
  }
  return storage;
}

function isSupabaseConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  return Boolean(url && key && !url.includes("placeholder") && key !== "placeholder");
}

function readLocalStore(storage = getStorage()): StoredAssetOnboardingSession[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredAssetOnboardingSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalStore(
  sessions: StoredAssetOnboardingSession[],
  storage = getStorage(),
) {
  if (!storage) return;
  try {
    storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Browser demo persistence is best-effort; database persistence still runs
    // for signed-in tenants.
  }
}

export function saveAssetOnboardingSessionLocal(
  session: AssetOnboardingSession,
  exports = buildAssetOnboardingExports(session),
  storage = getStorage(),
): AssetOnboardingSaveResult {
  const existing = readLocalStore(storage).filter(
    (item) => item.session.sessionId !== session.sessionId,
  );
  const next = [{ session, exports }, ...existing].slice(0, 25);
  writeLocalStore(next, storage);

  return {
    mode: "local",
    sessionId: session.sessionId,
  };
}

export function listAssetOnboardingSessionsLocal(
  storage = getStorage(),
): AssetOnboardingSummary[] {
  return readLocalStore(storage).map(({ session }) => ({
    sessionId: session.sessionId,
    assetId: session.assetId,
    assetClass: session.assetClass,
    mode: session.mode,
    lifecycle: session.lifecycle,
    industry: session.industry,
    status: session.status,
    completionScore: session.completionScore,
    reliabilityReadiness: session.reliabilityReadiness,
    currentStep: session.currentStep,
    updatedAt: session.updatedAt,
    source: "local",
  }));
}

export function loadAssetOnboardingSessionLocal(
  sessionId: string,
  storage = getStorage(),
): AssetOnboardingSession | null {
  return (
    readLocalStore(storage).find((item) => item.session.sessionId === sessionId)
      ?.session ?? null
  );
}

export function clearAssetOnboardingSessionsLocal(storage = getStorage()) {
  storage?.removeItem(LOCAL_STORAGE_KEY);
}

async function getSupabaseOrgContext() {
  if (!isSupabaseConfigured()) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileById, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  let profile = profileById;
  if (!profile && !error) {
    const { data: profileByAuthUser } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    profile = profileByAuthUser;
  }

  const organizationId = profile?.organization_id ?? profile?.org_id;

  if (error || !organizationId) return null;

  return {
    userId: user.id,
    organizationId: organizationId as string,
  };
}

function sessionRow(
  session: AssetOnboardingSession,
  organizationId: string,
  userId: string,
) {
  return {
    session_id: session.sessionId,
    organization_id: organizationId,
    asset_id: session.assetId,
    asset_class: session.assetClass,
    mode: session.mode,
    source: session.source,
    status: session.status,
    current_step: session.currentStep,
    completion_score: session.completionScore,
    reliability_readiness: session.reliabilityReadiness,
    readiness_message: session.readinessMessage,
    missing_fields: session.missingFields,
    assumptions: session.assumptions,
    recommendations: session.recommendations,
    approval_required: session.approvalRequired,
    session_payload: session,
    created_by: userId,
    created_by_label: session.createdBy,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    completed_at: session.completedAt ?? null,
  };
}

async function saveSupabaseArtifacts({
  session,
  exports,
  organizationId,
  userId,
}: {
  session: AssetOnboardingSession;
  exports: AssetOnboardingExports;
  organizationId: string;
  userId: string;
}) {
  const sessionId = session.sessionId;
  const assetId = session.assetId;
  const answeredSteps = session.steps.filter((step) => step.answer);

  await supabase
    .from("asset_onboarding_sessions")
    .upsert(sessionRow(session, organizationId, userId), {
      onConflict: "session_id",
    })
    .throwOnError();

  await Promise.all([
    supabase
      .from("asset_onboarding_steps")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
    supabase
      .from("asset_failure_mode_libraries")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
    supabase
      .from("asset_maintenance_strategy_recommendations")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
    supabase
      .from("asset_onboarding_evidence_items")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
    supabase
      .from("asset_onboarding_exports")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
    supabase
      .from("recommendation_approval_workflows")
      .delete()
      .eq("session_id", sessionId)
      .throwOnError(),
  ]);

  await Promise.all([
    supabase
      .from("asset_onboarding_steps")
      .insert(
        session.steps.map((step) => ({
          session_id: sessionId,
          organization_id: organizationId,
          step_id: step.id,
          step_name: step.name,
          completion_status: step.completionStatus,
          completion_score: step.completionScore,
          confidence_score: step.confidenceScore,
          source: step.source,
          required_fields: step.requiredFields,
          optional_fields: step.optionalFields,
          validation_rules: step.validationRules,
          outputs: step.outputs,
          answer: step.answer ?? null,
          step_payload: step,
          last_updated: step.lastUpdated ?? null,
        })),
      )
      .throwOnError(),
    supabase
      .from("asset_profiles_reliability")
      .upsert(
        {
          session_id: sessionId,
          organization_id: organizationId,
          asset_id: assetId,
          identity: session.profile.identity,
          hierarchy: session.profile.hierarchy,
          functional_definition: session.profile.functionalDefinition,
          operating_context: session.profile.operatingContext,
          criticality: session.profile.criticality,
          existing_maintenance: session.profile.existingMaintenance,
          condition_monitoring: session.profile.conditionMonitoring,
          spares: session.profile.spares,
          reliability_baseline: session.profile.reliabilityBaseline,
          fracas_readiness: session.profile.fracasReadiness,
          risk_safeguards: session.profile.riskSafeguards,
          lifecycle: session.profile.lifecycle,
        },
        { onConflict: "session_id" },
      )
      .throwOnError(),
    supabase
      .from("asset_failure_mode_libraries")
      .insert(
        session.profile.failureModes.map((mode) => ({
          session_id: sessionId,
          organization_id: organizationId,
          asset_id: assetId,
          failure_mode: mode.failureMode,
          failure_mechanism: mode.failureMechanism,
          cause: mode.cause,
          effect: mode.effect,
          detection_method: mode.detectionMethod,
          consequence: mode.consequence,
          current_controls: mode.currentControls,
          recommended_controls: mode.recommendedControls,
          source: "generated",
        })),
      )
      .throwOnError(),
    supabase
      .from("asset_maintenance_strategy_recommendations")
      .insert(
        session.profile.recommendedStrategy.map((item) => ({
          session_id: sessionId,
          organization_id: organizationId,
          asset_id: assetId,
          recommendation: item.recommendation,
          failure_mode_addressed: item.failureModeAddressed,
          risk_reduced: item.riskReduced,
          evidence_used: item.evidenceUsed,
          assumptions: item.assumptions,
          confidence: item.confidence,
          required_approval: item.requiredApproval,
          implementation_work_order: item.implementationWorkOrder,
          status: "draft",
        })),
      )
      .throwOnError(),
    answeredSteps.length
      ? supabase
        .from("asset_onboarding_evidence_items")
        .insert(
          answeredSteps.map((step) => ({
            session_id: sessionId,
            organization_id: organizationId,
            asset_id: assetId,
            evidence_type: "guided_answer",
            title: step.name,
            source_reference: step.source,
            confidence:
              step.confidenceScore >= 70
                ? "high"
                : step.confidenceScore >= 45
                  ? "medium"
                  : "low",
            notes: step.answer,
            payload: step,
            created_by: userId,
          })),
        )
        .throwOnError()
      : Promise.resolve(),
    supabase
      .from("recommendation_approval_workflows")
      .insert(
        session.approvalRequired.map((approval) => ({
          session_id: sessionId,
          organization_id: organizationId,
          asset_id: assetId,
          approval_reason: approval,
          owner_role: "Reliability Engineer",
          status: "required",
          consequence_of_being_wrong:
            "Unapproved maintenance strategy changes can create safety, environmental, production, or reliability risk.",
          required_validation:
            "Review supporting evidence, assumptions, OEM limits, and site standards before implementation.",
        })),
      )
      .throwOnError(),
  ]);

  await supabase
    .from("asset_onboarding_exports")
    .insert(
      Object.entries(exports).map(([exportType, content]) => ({
        session_id: sessionId,
        organization_id: organizationId,
        asset_id: assetId,
        export_type: exportType,
        filename: `syncai-${assetId.toLowerCase()}-asset-onboarding-${exportType}`,
        mime_type: exportType.includes("Csv")
          ? "text/csv"
          : exportType.includes("Json") || exportType === "json"
            ? "application/json"
            : "text/html",
        content,
        created_by: userId,
      })),
    )
    .throwOnError();
}

export async function saveAssetOnboardingSession(
  session: AssetOnboardingSession,
  exports = buildAssetOnboardingExports(session),
): Promise<AssetOnboardingSaveResult> {
  saveAssetOnboardingSessionLocal(session, exports);

  const context = await getSupabaseOrgContext();
  if (!context) {
    return {
      mode: "local",
      sessionId: session.sessionId,
      warning:
        "Saved in this browser. Connect Supabase and sign in to save this session to the tenant database.",
    };
  }

  try {
    await saveSupabaseArtifacts({
      session,
      exports,
      organizationId: context.organizationId,
      userId: context.userId,
    });

    return {
      mode: "supabase",
      sessionId: session.sessionId,
    };
  } catch (error) {
    return {
      mode: "local",
      sessionId: session.sessionId,
      warning:
        error instanceof Error
          ? `Saved locally because database persistence failed: ${error.message}`
          : "Saved locally because database persistence failed.",
    };
  }
}

export async function listAssetOnboardingSessions(): Promise<
  AssetOnboardingSummary[]
> {
  const localSessions = listAssetOnboardingSessionsLocal();
  const context = await getSupabaseOrgContext();

  if (!context) return localSessions;

  try {
    const { data, error } = await supabase
      .from("asset_onboarding_sessions")
      .select(
        "session_id, asset_id, asset_class, mode, status, completion_score, reliability_readiness, current_step, updated_at, session_payload",
      )
      .eq("organization_id", context.organizationId)
      .order("updated_at", { ascending: false })
      .limit(25);

    if (error) throw error;

    const remoteSessions = (data ?? []).map((row) => ({
      sessionId: row.session_id as string,
      assetId: row.asset_id as string,
      assetClass: row.asset_class as string,
      mode: row.mode as string,
      lifecycle: ((row.session_payload as AssetOnboardingSession | null)?.lifecycle ??
        "in_service") as AssetOnboardingLifecycle,
      industry: ((row.session_payload as AssetOnboardingSession | null)?.industry ??
        "general") as AssetOnboardingIndustry,
      status: row.status as string,
      completionScore: row.completion_score as number,
      reliabilityReadiness: row.reliability_readiness as string,
      currentStep: row.current_step as string,
      updatedAt: row.updated_at as string,
      source: "supabase" as const,
    }));

    const localOnly = localSessions.filter(
      (local) =>
        !remoteSessions.some((remote) => remote.sessionId === local.sessionId),
    );

    return [...remoteSessions, ...localOnly];
  } catch {
    return localSessions;
  }
}

export async function loadAssetOnboardingSession(
  sessionId: string,
): Promise<AssetOnboardingSession | null> {
  const context = await getSupabaseOrgContext();

  if (context) {
    try {
      const { data, error } = await supabase
        .from("asset_onboarding_sessions")
        .select("session_payload")
        .eq("organization_id", context.organizationId)
        .eq("session_id", sessionId)
        .maybeSingle();

      if (error) throw error;
      if (data?.session_payload) {
        return data.session_payload as AssetOnboardingSession;
      }
    } catch {
      // Fall through to local cache.
    }
  }

  return loadAssetOnboardingSessionLocal(sessionId);
}

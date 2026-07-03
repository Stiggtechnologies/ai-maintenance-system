/**
 * Onboarding Operating Loop
 *
 * Pure, framework-free derivations that turn a completed (or in-progress)
 * `AssetOnboardingSession` into the operational view-models consumed across the
 * SyncAI operating loop: Asset Intelligence, Reliability, Work Action Board,
 * Decision Governance, Mission Control, Value Realization, Learning Loop, and
 * Cowork Studio.
 *
 * These functions hold no React or Supabase state so they can be unit tested in
 * isolation and reused by the zustand store + page hooks.
 */
import {
  getAssetClassLabel,
  getAssetOnboardingIndustryLabel,
  getAssetOnboardingLifecycleLabel,
  getCurrentOnboardingStep,
  type AssetOnboardingProfile,
  type AssetOnboardingSession,
  type CriticalityResult,
} from "../lib/asset-onboarding";

/* -------------------------------------------------------------------------- */
/* Shared criticality mapping                                                 */
/* -------------------------------------------------------------------------- */

type CriticalityClass = CriticalityResult["criticalityClass"];

interface CriticalityProfile {
  letter: "A" | "B" | "C" | "D";
  riskScore: number;
  urgency: "critical" | "action" | "advisory";
  priority: "critical" | "high" | "medium" | "low";
  missionImpact: "High" | "Medium" | "Low";
}

const CRITICALITY_PROFILE: Record<CriticalityClass, CriticalityProfile> = {
  critical: {
    letter: "A",
    riskScore: 92,
    urgency: "critical",
    priority: "critical",
    missionImpact: "High",
  },
  high: {
    letter: "B",
    riskScore: 74,
    urgency: "action",
    priority: "high",
    missionImpact: "High",
  },
  medium: {
    letter: "C",
    riskScore: 48,
    urgency: "advisory",
    priority: "medium",
    missionImpact: "Medium",
  },
  low: {
    letter: "D",
    riskScore: 26,
    urgency: "advisory",
    priority: "low",
    missionImpact: "Low",
  },
};

function criticalityProfile(
  session: AssetOnboardingSession,
): CriticalityProfile {
  return (
    CRITICALITY_PROFILE[session.profile.criticality.criticalityClass] ??
    CRITICALITY_PROFILE.medium
  );
}

const SEVERITY_BY_CLASS: Record<
  CriticalityClass,
  "Critical" | "High" | "Medium" | "Low"
> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Maps an onboarding approval gate to the role accountable for clearing it. */
export function ownerRoleForApproval(approval: string): string {
  const value = approval.toLowerCase();
  if (
    value.includes("safety") ||
    value.includes("hazard") ||
    value.includes("loto")
  )
    return "HSE Manager";
  if (value.includes("environmental")) return "Environmental Lead";
  if (
    value.includes("regulat") ||
    value.includes("compliance") ||
    value.includes("statutory")
  )
    return "Compliance & Auditing Lead";
  if (value.includes("oem") || value.includes("warranty"))
    return "Reliability Engineer";
  if (
    value.includes("pm interval") ||
    value.includes("interval") ||
    value.includes("strategy")
  )
    return "Reliability Manager";
  if (
    value.includes("capital") ||
    value.includes("budget") ||
    value.includes("cost")
  )
    return "Asset Manager";
  return "Reliability Engineer";
}

function isSafetyCriticalApproval(approval: string): boolean {
  const value = approval.toLowerCase();
  return (
    value.includes("safety") ||
    value.includes("environmental") ||
    value.includes("regulat") ||
    value.includes("oem") ||
    value.includes("hazard") ||
    value.includes("loto")
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Asset Intelligence                                                      */
/* -------------------------------------------------------------------------- */

export interface DerivedHierarchyLevel {
  level: string;
  name: string;
}

export interface DerivedAssetFailureMode {
  mode: string;
  probability: number;
  severity: "Critical" | "High" | "Medium" | "Low";
  detection: string;
  riskScore: number;
}

export interface DerivedAssetIntelligence {
  sessionId: string;
  assetId: string;
  name: string;
  assetClass: string;
  classLabel: string;
  industryLabel: string;
  lifecycleLabel: string;
  criticalityClass: CriticalityClass;
  criticalityLetter: "A" | "B" | "C" | "D";
  status: "Onboarding" | "Watch" | "Ready";
  readiness: AssetOnboardingSession["reliabilityReadiness"];
  readinessMessage: string;
  completionScore: number;
  readinessScore: number;
  riskScore: number;
  identity: Record<string, string>;
  hierarchy: DerivedHierarchyLevel[];
  functionalDefinition: Record<string, string>;
  operatingContext: Record<string, string>;
  criticality: CriticalityResult;
  reliabilityBaseline: AssetOnboardingProfile["reliabilityBaseline"];
  lifecycle: AssetOnboardingProfile["lifecycle"];
  riskSafeguards: AssetOnboardingProfile["riskSafeguards"];
  dataGaps: string[];
  failureModes: DerivedAssetFailureMode[];
  updatedAt: string;
}

function readinessToStatus(
  readiness: AssetOnboardingSession["reliabilityReadiness"],
): DerivedAssetIntelligence["status"] {
  if (readiness === "complete") return "Ready";
  if (readiness === "high") return "Watch";
  return "Onboarding";
}

function hierarchyLevels(
  profile: AssetOnboardingProfile,
  assetId: string,
): DerivedHierarchyLevel[] {
  const placement = profile.hierarchy.recommendedPlacement;
  if (placement.length > 0) {
    const levelNames = [
      "Enterprise",
      "Site",
      "Area",
      "System",
      "Sub-system",
      "Asset",
      "Component",
    ];
    return placement.slice(0, levelNames.length).map((name, index) => ({
      level: levelNames[index] ?? "Level",
      name,
    }));
  }
  return [{ level: "Asset", name: assetId }];
}

export function deriveAssetIntelligence(
  session: AssetOnboardingSession,
): DerivedAssetIntelligence {
  const profile = session.profile;
  const crit = criticalityProfile(session);
  const severity =
    SEVERITY_BY_CLASS[profile.criticality.criticalityClass] ?? "Medium";

  const failureModes: DerivedAssetFailureMode[] = profile.failureModes.map(
    (mode, index) => ({
      mode: mode.failureMode,
      // Onboarding has no measured probability yet; surface a deterministic
      // descending placeholder so the table reads sensibly and flags review.
      probability: Math.max(10, 60 - index * 8),
      severity,
      detection: mode.detectionMethod,
      riskScore: Math.max(6, crit.riskScore - index * 6),
    }),
  );

  return {
    sessionId: session.sessionId,
    assetId: session.assetId,
    name: `${session.assetId} ${getAssetClassLabel(session.assetClass)}`,
    assetClass: session.assetClass,
    classLabel: getAssetClassLabel(session.assetClass),
    industryLabel: getAssetOnboardingIndustryLabel(session.industry),
    lifecycleLabel: getAssetOnboardingLifecycleLabel(session.lifecycle),
    criticalityClass: profile.criticality.criticalityClass,
    criticalityLetter: crit.letter,
    status: readinessToStatus(session.reliabilityReadiness),
    readiness: session.reliabilityReadiness,
    readinessMessage: session.readinessMessage,
    completionScore: session.completionScore,
    readinessScore: session.completionScore,
    riskScore: crit.riskScore,
    identity: profile.identity,
    hierarchy: hierarchyLevels(profile, session.assetId),
    functionalDefinition: profile.functionalDefinition,
    operatingContext: profile.operatingContext,
    criticality: profile.criticality,
    reliabilityBaseline: profile.reliabilityBaseline,
    lifecycle: profile.lifecycle,
    riskSafeguards: profile.riskSafeguards,
    dataGaps: session.finalPackage.dataGaps,
    failureModes,
    updatedAt: session.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Reliability                                                             */
/* -------------------------------------------------------------------------- */

export interface DerivedReliability {
  sessionId: string;
  assetId: string;
  classLabel: string;
  criticalityClass: CriticalityClass;
  failureModes: AssetOnboardingProfile["failureModes"];
  strategyRecommendations: AssetOnboardingProfile["recommendedStrategy"];
  rcaTriggers: string[];
  fracasReadiness: AssetOnboardingProfile["fracasReadiness"];
  pmOptimizationBlockers: string[];
  fracasIntakeReady: boolean;
}

export function deriveReliability(
  session: AssetOnboardingSession,
): DerivedReliability {
  const profile = session.profile;
  const baseline = profile.reliabilityBaseline;

  const pmOptimizationBlockers: string[] = [];
  if (baseline.failureCount === 0) {
    pmOptimizationBlockers.push(
      "Confirmed failure history not yet imported — PM interval optimization is blocked.",
    );
  }
  if (baseline.missingData.some((item) => /operating hour/i.test(item))) {
    pmOptimizationBlockers.push(
      "Operating hours missing — interval basis cannot be validated.",
    );
  }
  if (profile.existingMaintenance.capturedTasks.length === 0) {
    pmOptimizationBlockers.push(
      "No current PM tasks imported — baseline strategy cannot be optimized.",
    );
  }
  baseline.missingData
    .filter((item) => !/operating hour/i.test(item))
    .slice(0, 4)
    .forEach((item) => pmOptimizationBlockers.push(`Missing data: ${item}.`));

  return {
    sessionId: session.sessionId,
    assetId: session.assetId,
    classLabel: getAssetClassLabel(session.assetClass),
    criticalityClass: profile.criticality.criticalityClass,
    failureModes: profile.failureModes,
    strategyRecommendations: profile.recommendedStrategy,
    rcaTriggers: profile.fracasReadiness.rcaTriggerCriteria,
    fracasReadiness: profile.fracasReadiness,
    pmOptimizationBlockers,
    fracasIntakeReady:
      profile.fracasReadiness.failureEventIntakeFields.length > 0,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Work Action Board                                                       */
/* -------------------------------------------------------------------------- */

export type DerivedWorkActionStatus = "approval" | "pending";

export interface DerivedWorkAction {
  id: string;
  woNumber: string;
  title: string;
  asset: string;
  area: string;
  status: DerivedWorkActionStatus;
  priority: "critical" | "high" | "medium" | "low";
  riskScore: number;
  safetyFlag: boolean;
  approvalRequired: boolean;
  description: string;
  failureModeAddressed: string;
  requiredApproval: string;
  confidence: "low" | "medium" | "high";
  source: "strategy_recommendation" | "implementation_action";
}

export function deriveWorkActions(
  session: AssetOnboardingSession,
): DerivedWorkAction[] {
  const profile = session.profile;
  const crit = criticalityProfile(session);
  const area =
    profile.identity["System"] ??
    profile.identity["Functional location"] ??
    "Onboarding intake";
  const actions: DerivedWorkAction[] = [];

  profile.recommendedStrategy.forEach((rec, index) => {
    const safety =
      isSafetyCriticalApproval(rec.requiredApproval) ||
      profile.criticality.criticalityClass === "critical";
    const needsApproval =
      safety ||
      rec.confidence === "low" ||
      profile.criticality.criticalityClass === "high";
    actions.push({
      id: `${session.sessionId}-strategy-${index}`,
      woNumber: `ONB-${session.assetId}-S${index + 1}`,
      title: rec.recommendation,
      asset: session.assetId,
      area,
      // Never auto-approve: safety/high-risk lands in the approval gate, the
      // rest enters as a draft pending planner pickup.
      status: needsApproval ? "approval" : "pending",
      priority: crit.priority,
      riskScore: Math.max(10, crit.riskScore - index * 4),
      safetyFlag: safety,
      approvalRequired: needsApproval,
      description: `${rec.riskReduced} Evidence: ${rec.evidenceUsed.join("; ") || "Generated starter content — validate with site data."}`,
      failureModeAddressed: rec.failureModeAddressed,
      requiredApproval: rec.requiredApproval,
      confidence: rec.confidence,
      source: "strategy_recommendation",
    });
  });

  if (profile.recommendedStrategy.length === 0) {
    session.finalPackage.implementationActions
      .slice(0, 6)
      .forEach((action, index) => {
        const safety =
          isSafetyCriticalApproval(action) ||
          profile.criticality.criticalityClass === "critical";
        actions.push({
          id: `${session.sessionId}-impl-${index}`,
          woNumber: `ONB-${session.assetId}-A${index + 1}`,
          title: action,
          asset: session.assetId,
          area,
          status: safety ? "approval" : "pending",
          priority: crit.priority,
          riskScore: Math.max(10, crit.riskScore - index * 4),
          safetyFlag: safety,
          approvalRequired: safety,
          description:
            "Implementation action generated from asset onboarding package.",
          failureModeAddressed: "Onboarding implementation",
          requiredApproval: safety
            ? "Engineering approval required"
            : "Planner review",
          confidence: "medium",
          source: "implementation_action",
        });
      });
  }

  return actions;
}

/* -------------------------------------------------------------------------- */
/* 4. Decision Governance                                                     */
/* -------------------------------------------------------------------------- */

export type DerivedGovernanceStatus = "required" | "approved" | "rejected";

export interface DerivedGovernanceRecord {
  id: string;
  sessionId: string;
  assetId: string;
  requiredApproval: string;
  ownerRole: string;
  reason: string;
  consequenceOfWrong: string;
  requiredValidation: string;
  status: DerivedGovernanceStatus;
  safetyCritical: boolean;
}

const DEFAULT_CONSEQUENCE =
  "Unapproved maintenance strategy changes can create safety, environmental, production, or reliability risk.";
const DEFAULT_VALIDATION =
  "Review supporting evidence, assumptions, OEM limits, and site standards before implementation.";

export function deriveGovernanceRecords(
  session: AssetOnboardingSession,
  decisions: Record<string, DerivedGovernanceStatus> = {},
): DerivedGovernanceRecord[] {
  const records: DerivedGovernanceRecord[] = [];
  const seen = new Set<string>();

  const push = (approval: string, source: string) => {
    const key = approval.trim().toLowerCase();
    if (!approval.trim() || seen.has(key)) return;
    seen.add(key);
    const id = `${session.sessionId}-gov-${source}-${records.length}`;
    records.push({
      id,
      sessionId: session.sessionId,
      assetId: session.assetId,
      requiredApproval: approval,
      ownerRole: ownerRoleForApproval(approval),
      reason: `Asset onboarding approval gate for ${session.assetId} (${getAssetClassLabel(session.assetClass)}).`,
      consequenceOfWrong: DEFAULT_CONSEQUENCE,
      requiredValidation: DEFAULT_VALIDATION,
      status: decisions[id] ?? "required",
      safetyCritical: isSafetyCriticalApproval(approval),
    });
  };

  session.approvalRequired.forEach((approval) => push(approval, "gate"));
  session.profile.criticality.approvalRequirements.forEach((approval) =>
    push(approval, "criticality"),
  );
  session.profile.recommendedStrategy.forEach((rec) =>
    push(rec.requiredApproval, "strategy"),
  );

  return records;
}

/* -------------------------------------------------------------------------- */
/* 5. Mission Control                                                         */
/* -------------------------------------------------------------------------- */

export interface MissionReadinessSignal {
  sessionId: string;
  assetId: string;
  classLabel: string;
  criticalityClass: CriticalityClass;
  readiness: AssetOnboardingSession["reliabilityReadiness"];
  completionScore: number;
  readinessGap: number;
  urgency: "critical" | "action" | "advisory";
  exposure: string;
  missionImpact: "High" | "Medium" | "Low";
  reasons: string[];
  recommendedAction: string;
}

export function deriveMissionSignal(
  session: AssetOnboardingSession,
): MissionReadinessSignal | null {
  const profile = session.profile;
  const crit = criticalityProfile(session);
  const baseline = profile.reliabilityBaseline;
  const reasons: string[] = [];

  if (
    session.reliabilityReadiness === "low" ||
    session.reliabilityReadiness === "medium"
  ) {
    reasons.push(
      `Low reliability readiness (${session.completionScore}% onboarded).`,
    );
  }
  if (
    profile.criticality.criticalityClass === "high" ||
    profile.criticality.criticalityClass === "critical"
  ) {
    reasons.push(`High criticality (${profile.criticality.criticalityClass}).`);
  }
  if (baseline.failureCount === 0) {
    reasons.push("Missing confirmed failure history.");
  }
  if (baseline.missingData.some((item) => /operating hour/i.test(item))) {
    reasons.push("Missing operating hours.");
  }
  if (profile.existingMaintenance.capturedTasks.length === 0) {
    reasons.push("Missing PM strategy.");
  }
  if (profile.riskSafeguards.humanApprovalGates.length > 0) {
    reasons.push(
      `Open safety/environmental approval gates (${profile.riskSafeguards.humanApprovalGates.length}).`,
    );
  }

  if (reasons.length === 0) return null;

  const safetyGate = profile.riskSafeguards.humanApprovalGates.length > 0;
  const urgency: MissionReadinessSignal["urgency"] =
    profile.criticality.criticalityClass === "critical" ||
    (crit.urgency === "action" && safetyGate)
      ? "critical"
      : profile.criticality.criticalityClass === "high"
        ? "action"
        : "advisory";

  return {
    sessionId: session.sessionId,
    assetId: session.assetId,
    classLabel: getAssetClassLabel(session.assetClass),
    criticalityClass: profile.criticality.criticalityClass,
    readiness: session.reliabilityReadiness,
    completionScore: session.completionScore,
    readinessGap: Math.max(0, 100 - session.completionScore),
    urgency,
    exposure: `${profile.criticality.criticalityClass} criticality`,
    missionImpact: crit.missionImpact,
    reasons,
    recommendedAction: `Complete reliability onboarding — ${reasons.length} readiness gap${reasons.length === 1 ? "" : "s"} open.`,
  };
}

/* -------------------------------------------------------------------------- */
/* 6. Value Realization                                                       */
/* -------------------------------------------------------------------------- */

export interface DerivedValueBaseline {
  sessionId: string;
  assetId: string;
  classLabel: string;
  criticalityClass: CriticalityClass;
  riskExposureBaseline: string;
  riskExposureScore: number;
  downtimeExposurePlaceholder: string;
  maintenanceCostBaseline: number;
  maintenanceCostLabel: string;
  valueOpportunity: string;
  projectedAnnualizedValuePlaceholder: string;
  status: "baseline_pending_validation";
  createdAt: string;
}

export function deriveValueBaseline(
  session: AssetOnboardingSession,
): DerivedValueBaseline {
  const profile = session.profile;
  const maintenanceCost = profile.reliabilityBaseline.maintenanceCost;

  return {
    sessionId: session.sessionId,
    assetId: session.assetId,
    classLabel: getAssetClassLabel(session.assetClass),
    criticalityClass: profile.criticality.criticalityClass,
    riskExposureBaseline: `${profile.criticality.criticalityClass} criticality (${profile.criticality.score}/${profile.criticality.maxScore})`,
    riskExposureScore: profile.criticality.score,
    downtimeExposurePlaceholder:
      "Pending operating hours + confirmed failure history",
    maintenanceCostBaseline: maintenanceCost,
    maintenanceCostLabel:
      maintenanceCost > 0
        ? `$${maintenanceCost.toLocaleString()}`
        : "Not yet available",
    valueOpportunity:
      "Avoided downtime + optimized PM strategy once failure history and operating hours are validated.",
    projectedAnnualizedValuePlaceholder: "Pending baseline validation",
    status: "baseline_pending_validation",
    createdAt: session.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* 7. Cowork Studio                                                           */
/* -------------------------------------------------------------------------- */

export interface DerivedWorkspace {
  id: string;
  sessionId: string;
  title: string;
  objective: string;
  status: "active" | "completed";
  agents: string[];
  progress: number;
  artifacts: number;
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

const BASE_ONBOARDING_AGENTS = [
  "Asset Management",
  "Reliability Engineering",
  "Maintenance Strategy Development",
  "Data Analytics",
];

export function deriveWorkspace(
  session: AssetOnboardingSession,
): DerivedWorkspace {
  const agents = [...BASE_ONBOARDING_AGENTS];
  if (
    session.mode === "regulatory" ||
    session.profile.riskSafeguards.humanApprovalGates.length > 0
  ) {
    agents.push("Compliance & Auditing");
  }

  const pkg = session.finalPackage;
  const artifacts = [
    pkg.assetProfile,
    pkg.fmea.length,
    pkg.maintenanceStrategy.length,
    pkg.conditionMonitoringPlan.length,
    pkg.sparesRecommendation.length,
    pkg.implementationActions.length,
  ].filter(Boolean).length;

  const currentStep = getCurrentOnboardingStep(session);
  const nextAction =
    session.status === "completed"
      ? "Validate baseline with site data and approve outstanding gates."
      : `Complete: ${currentStep.name}`;

  return {
    id: `workspace-${session.sessionId}`,
    sessionId: session.sessionId,
    title: `Asset Onboarding — ${session.assetId}`,
    objective: `Onboard ${session.assetId} (${getAssetClassLabel(session.assetClass)}) to reliability-ready status using the ${getAssetOnboardingIndustryLabel(session.industry)} template.`,
    status: session.status === "completed" ? "completed" : "active",
    agents,
    progress: session.completionScore,
    artifacts,
    nextAction,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Learning Loop event model                                                  */
/* -------------------------------------------------------------------------- */

export type OnboardingLearningEventType =
  | "onboarding_started"
  | "step_completed"
  | "package_exported"
  | "recommendation_approved"
  | "recommendation_rejected"
  | "work_action_created";

export interface OnboardingLearningEvent {
  id: string;
  type: OnboardingLearningEventType;
  sessionId: string;
  assetId: string;
  title: string;
  detail: string;
  agent: string;
  confidence: number;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Aggregate helpers (used by Mission Control / Asset Intelligence services)  */
/* -------------------------------------------------------------------------- */

export interface OnboardingDerivedBundle {
  assetIntelligence: DerivedAssetIntelligence[];
  reliability: DerivedReliability[];
  workActions: DerivedWorkAction[];
  governance: DerivedGovernanceRecord[];
  missionSignals: MissionReadinessSignal[];
  valueBaselines: DerivedValueBaseline[];
  workspaces: DerivedWorkspace[];
}

export function deriveOperatingLoop(
  sessions: AssetOnboardingSession[],
  decisions: Record<string, DerivedGovernanceStatus> = {},
): OnboardingDerivedBundle {
  const missionSignals = sessions
    .map((session) => deriveMissionSignal(session))
    .filter((signal): signal is MissionReadinessSignal => signal !== null);

  return {
    assetIntelligence: sessions.map(deriveAssetIntelligence),
    reliability: sessions.map(deriveReliability),
    workActions: sessions.flatMap(deriveWorkActions),
    governance: sessions.flatMap((session) =>
      deriveGovernanceRecords(session, decisions),
    ),
    missionSignals,
    valueBaselines: sessions.map(deriveValueBaseline),
    workspaces: sessions.map(deriveWorkspace),
  };
}

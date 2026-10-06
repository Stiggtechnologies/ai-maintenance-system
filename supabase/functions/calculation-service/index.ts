// calculation-service — authenticated execution boundary for customer-visible
// deterministic calculations. Inputs are read from canonical tenant rows and
// the exact shared TypeScript kernels are executed here; the browser never
// supplies a trusted output. Every attempted calculation is appended to the
// ONE immutable calculation_runs ledger, including refusals.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  cashFlowsDefect,
  compareOptions,
  prioritiseUnderBudget,
  type CashFlow,
} from "../../../src/lib/value/index.ts";
import { selectWeibullMethod } from "../../../src/lib/reliability/method-selection.ts";
import {
  COX_KERNEL_VERSION,
  type CoxResult,
} from "../../../src/lib/reliability/cox.ts";
import { analyseCoxSurvival } from "../../../src/lib/reliability/cox-prediction.ts";
import {
  prepareSurvivalCensus,
  prepareActiveSurvivalScenario,
  prepareSurvivalScenario,
  SURVIVAL_CENSUS_VERSION,
  type SurvivalCensus,
} from "../../../src/lib/reliability/survival-source.ts";
import {
  analyseModellingStudio,
  type ModellingCostSource,
  type ModellingGraphSource,
  type ModellingHistoryRow,
  type ModellingScheduleSource,
  type ModellingTreeSource,
} from "../../../src/lib/modelling/studio.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BUDGET = 1_000_000_000_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

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

type Profile = { organization_id: string; role: string | null };
type BusinessCaseRow = {
  id: number;
  case_ref: string;
  title: string;
  driver: string;
  discount_rate: number | string;
  discount_rate_source: string | null;
  status: string;
};
type BusinessCaseOptionRow = {
  id: number;
  label: string;
  life_periods: number;
  cash_flows: unknown;
  benefit_probability: number | string | null;
  is_do_nothing: boolean;
  notes: string | null;
};
type CapitalPlanRow = {
  id: number;
  plan_year: number;
  label: string;
  cost: number | string;
  benefit_present_value: number | string | null;
  mandatory: boolean;
  mandatory_basis: string | null;
  case_id: number | null;
};
type LifeEventRow = {
  id: number;
  hoursAtChangeOut: number | string;
  eventKind: "failure" | "scheduled" | "other";
  component: string;
};
type AssetStrategySource = {
  error?: string;
  kernelVersion?: string;
  plan?: {
    id: string;
    intervalBasis: "calendar_days" | "run_hours";
    intervalValue: number | string;
    active: boolean;
    componentScope: string | null;
    failureMode: string | null;
    strategyKind:
      | "time_based_pm"
      | "condition_based"
      | "failure_finding"
      | "run_to_failure"
      | null;
    plannedTaskCostUsd: number | string | null;
    failureConsequenceCostUsd: number | string | null;
    costBasis: string | null;
    safetyCritical: boolean | null;
    regulatoryRequired: boolean | null;
    lifecycleObjective: string | null;
    version: number;
  };
  asset?: {
    id: string;
    name: string;
    tag: string | null;
    assetClass: string | null;
    criticality: string | null;
  };
  lifeEvents?: LifeEventRow[];
  pfIntervals?: Array<{
    id: string;
    detectionTechnique: string;
    pfIntervalDays: number | string;
    basis: string;
    status: string;
  }>;
  economics?: Record<string, unknown> | null;
  lifecycleEvaluations?: Array<Record<string, unknown>>;
  fieldExperience?: {
    events: Array<{
      learningEventId: string;
      caVerificationId: string;
      lifecyclePlanId: string;
      lifecyclePlanVersion: number;
      appliedPlanVersion: number;
      effectiveness: "effective" | "ineffective";
      evaluatedAt: string;
      observationDays: number;
      failureMode: string | null;
      recurrenceWorkOrderId: string | null;
      appliesToCurrentPlanVersion: boolean;
      unconsumed: boolean;
    }>;
    eventIds: string[];
    effectiveCount: number;
    ineffectiveCount: number;
    currentEffectiveCount: number;
    currentIneffectiveCount: number;
    refreshRequired: boolean;
    revisionRequired: boolean;
    latestEvaluatedAt: string | null;
    currentPlanVersion: number;
    basis: string;
  };
};

function finiteNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || value.trim() === "")
  )
    return null;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function inputRef(table: string, id: string | number) {
  return { table, id: String(id) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES)
    return json({ error: "request_too_large" }, 413);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: rawProfile, error: profileError } = await service
    .from("user_profiles")
    .select("organization_id,role")
    .eq("id", userData.user.id)
    .maybeSingle();
  const profile = rawProfile as Profile | null;
  if (profileError || !profile?.organization_id)
    return json({ error: "organization_membership_required" }, 403);

  let body: {
    action?: unknown;
    budget?: unknown;
    component?: unknown;
    planId?: unknown;
    covariates?: unknown;
    scenario?: unknown;
    activeScenario?: unknown;
  };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json({ error: "request_too_large" }, 413);
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const organizationId = profile.organization_id;
  const actorId = userData.user.id;

  if (body.action === "reliability_survival") {
    if (body.scenario !== undefined && body.activeScenario !== undefined)
      return json({ error: "choose_one_explicit_survival_scenario" }, 400);
    const component =
      typeof body.component === "string" ? body.component.trim() : "";
    if (
      component.length < 2 ||
      component.length > 160 ||
      !Array.isArray(body.covariates) ||
      body.covariates.length < 1 ||
      body.covariates.length > 8 ||
      body.covariates.some(
        (item) =>
          !item ||
          typeof item.name !== "string" ||
          item.name.trim().length < 1 ||
          item.name.length > 80 ||
          typeof item.unit !== "string" ||
          item.unit.trim().length < 1 ||
          item.unit.length > 80,
      )
    ) {
      return json(
        { error: "bounded_component_and_named_covariates_with_units_required" },
        400,
      );
    }
    const covariates = body.covariates.map((item) => ({
      name: item.name.trim(),
      unit: item.unit.trim(),
    }));
    if (
      new Set(covariates.map((item) => item.name)).size !== covariates.length
    ) {
      return json({ error: "covariate_names_must_be_unique" }, 400);
    }
    try {
      // The requester supplies only a scope and named predictors. Every
      // observation, review, approval and authority fact is server-derived.
      const { data: sourceData, error: sourceError } = await service.rpc(
        "get_survival_source_internal",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_component: component,
        },
      );
      if (sourceError) throw new Error(sourceError.message);
      const source = sourceData as
        | (SurvivalCensus & {
            error?: string;
            kernelVersion?: string;
          })
        | null;
      if (source?.error) return json({ error: source.error }, 403);
      if (
        !source ||
        source.kernelVersion !== COX_KERNEL_VERSION ||
        source.sourceVersion !== SURVIVAL_CENSUS_VERSION ||
        !Array.isArray(source.events) ||
        !Array.isArray(source.activeInstances) ||
        !Array.isArray(source.removedInstances) ||
        !Array.isArray(source.populationGaps)
      ) {
        throw new Error("pinned canonical survival source unavailable");
      }
      const prepared = prepareSurvivalCensus(source, covariates);
      const result: CoxResult = prepared.gaps.length
        ? {
            status: "refused",
            code: "invalid_input",
            reason:
              "Canonical source has unresolved evidence, exposure or review gaps.",
            kernelVersion: COX_KERNEL_VERSION,
            authority: "advisory_only",
          }
        : analyseCoxSurvival(
            prepared.rows,
            covariates.map((item) => item.name),
            prepared.clusterBySubject,
            body.activeScenario !== undefined
              ? prepareActiveSurvivalScenario(
                  source.events,
                  covariates,
                  source.activeInstances,
                  body.activeScenario,
                )
              : body.scenario === undefined
                ? undefined
                : prepareSurvivalScenario(
                    source.events,
                    covariates,
                    body.scenario,
                    source.activeInstances,
                  ),
          );
      const refusals = prepared.gaps.length
        ? prepared.gaps
        : result.status === "refused"
          ? [result.reason]
          : [
              "Formal identity-time PH diagnostics and canonical-asset clustered uncertainty are not customer predictive calibration or model acceptance; no maintenance decision is authorized.",
              ...(result.diagnostics?.status === "refused"
                ? [result.diagnostics.reason]
                : result.diagnostics?.status === "computed" &&
                    result.diagnostics.phIdentity.status === "refused"
                  ? [result.diagnostics.phIdentity.reason]
                  : []),
              ...(result.conditionalScenario
                ? [
                    result.conditionalScenario.status === "refused"
                      ? result.conditionalScenario.reason
                      : "The retained conditional scenario is not a qualified live-asset forecast or predictive calibration; no operational authority is granted.",
                  ]
                : []),
            ];
      const { data: receiptData, error: receiptError } = await service.rpc(
        "record_survival_calculation",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_component: component,
          p_source_snapshot: source,
          p_covariates: covariates,
          p_result: { ...result, populationVersion: SURVIVAL_CENSUS_VERSION },
          p_refusals: refusals,
        },
      );
      if (receiptError) throw new Error(receiptError.message);
      const receipt = receiptData as { error?: string } | null;
      if (receipt?.error) return json({ error: receipt.error }, 422);
      return json(receipt);
    } catch (error) {
      console.error("governed survival calculation failed", error);
      return json({ error: "reliability_survival_calculation_failed" }, 422);
    }
  }

  if (body.action === "reliability_life_data") {
    const component =
      typeof body.component === "string" ? body.component.trim() : "";
    if (component.length < 2 || component.length > 160)
      return json({ error: "component_must_contain_2_to_160_characters" }, 400);
    try {
      const { data: sourceData, error: sourceError } = await service.rpc(
        "get_reliability_life_data_source",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_component: component,
        },
      );
      if (sourceError) throw new Error(sourceError.message);
      const source = sourceData as {
        error?: string;
        component?: string;
        kernelVersion?: string;
        events?: LifeEventRow[];
      } | null;
      if (source?.error) return json({ error: source.error }, 403);
      const events = Array.isArray(source?.events) ? source.events : [];
      if (events.length === 0)
        return json({ error: "no_component_life_data" }, 422);
      const failures = events
        .filter((event) => event.eventKind === "failure")
        .map((event) => finiteNumber(event.hoursAtChangeOut))
        .filter((hours): hours is number => hours !== null && hours > 0);
      const suspensions = events
        .filter((event) => event.eventKind === "scheduled")
        .map((event) => finiteNumber(event.hoursAtChangeOut))
        .filter((hours): hours is number => hours !== null && hours > 0);
      const methodSelection = selectWeibullMethod(failures, suspensions);
      const { data: receiptData, error: receiptError } = await service.rpc(
        "record_reliability_life_data_run",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_component: source?.component ?? component,
          p_event_ids: events.map((event) => event.id),
          p_kernel_version: source?.kernelVersion,
          p_result: methodSelection,
        },
      );
      if (receiptError) throw new Error(receiptError.message);
      const receipt = receiptData as { error?: string } | null;
      if (receipt?.error) return json({ error: receipt.error }, 422);
      return json(receipt);
    } catch (error) {
      console.error("reliability life-data calculation failed", error);
      return json({ error: "reliability_life_data_calculation_failed" }, 422);
    }
  }

  if (body.action === "asset_strategy") {
    const planId = typeof body.planId === "string" ? body.planId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(planId))
      return json({ error: "valid_plan_id_required" }, 400);
    try {
      const { data: sourceData, error: sourceError } = await service.rpc(
        "get_asset_strategy_source_v2",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_plan_id: planId,
        },
      );
      if (sourceError) throw new Error(sourceError.message);
      const source = sourceData as AssetStrategySource | null;
      if (source?.error) return json({ error: source.error }, 403);
      if (!source?.plan || !source.asset || !source.kernelVersion)
        return json({ error: "asset_strategy_source_incomplete" }, 422);

      // Keep the established reliability and value actions independent of the
      // asset-strategy kernel.  The Edge Runtime loads this module only after
      // the caller and exact tenant-scoped strategy source have been accepted.
      const { inspectionInterval, optimalAgeReplacement } =
        await import("../../../src/lib/optimization/index.ts");

      const events = Array.isArray(source.lifeEvents) ? source.lifeEvents : [];
      const failures = events
        .filter((event) => event.eventKind === "failure")
        .map((event) => finiteNumber(event.hoursAtChangeOut))
        .filter((hours): hours is number => hours !== null && hours > 0);
      const suspensions = events
        .filter((event) => event.eventKind === "scheduled")
        .map((event) => finiteNumber(event.hoursAtChangeOut))
        .filter((hours): hours is number => hours !== null && hours > 0);
      const methodSelection = selectWeibullMethod(failures, suspensions);
      const fieldRows = Array.isArray(source.fieldExperience?.events)
        ? source.fieldExperience.events
        : [];
      const fieldExperience = {
        eventIds: fieldRows.map((item) => item.learningEventId),
        effectiveCount: Number(source.fieldExperience?.effectiveCount ?? 0),
        ineffectiveCount: Number(source.fieldExperience?.ineffectiveCount ?? 0),
        currentEffectiveCount: Number(
          source.fieldExperience?.currentEffectiveCount ?? 0,
        ),
        currentIneffectiveCount: Number(
          source.fieldExperience?.currentIneffectiveCount ?? 0,
        ),
        refreshRequired: source.fieldExperience?.refreshRequired === true,
        revisionRequired: source.fieldExperience?.revisionRequired === true,
        latestEvaluatedAt: source.fieldExperience?.latestEvaluatedAt ?? null,
        currentPlanVersion: Number(
          source.fieldExperience?.currentPlanVersion ?? source.plan.version,
        ),
        basis:
          source.fieldExperience?.basis ??
          "No concluded corrective-action field outcomes are linked to this maintenance task.",
      };
      const plannedCost = finiteNumber(source.plan.plannedTaskCostUsd);
      const failureCost = finiteNumber(source.plan.failureConsequenceCostUsd);
      const hasCostEvidence =
        plannedCost != null &&
        plannedCost > 0 &&
        failureCost != null &&
        failureCost > 0 &&
        typeof source.plan.costBasis === "string" &&
        source.plan.costBasis.trim().length >= 20;
      const fit =
        methodSelection.beta != null && methodSelection.eta != null
          ? {
              beta: methodSelection.beta,
              eta: methodSelection.eta,
              failures: methodSelection.failures,
            }
          : null;
      const ageReplacement = fit
        ? optimalAgeReplacement(fit, {
            plannedCost: plannedCost ?? 0,
            failureCost: failureCost ?? 0,
          })
        : {
            recommended: false,
            optimalAge: null,
            costRateAtOptimum: null,
            runToFailureCostRate: null,
            savingsPct: null,
            reason:
              "No identifiable life distribution exists, so an age-replacement interval is refused.",
          };
      const adoptedPf = Array.isArray(source.pfIntervals)
        ? source.pfIntervals[0]
        : undefined;
      const pfDays = finiteNumber(adoptedPf?.pfIntervalDays);
      const inspection =
        pfDays != null
          ? {
              ...inspectionInterval(pfDays, 0.9, 2),
              pfIntervalId: adoptedPf?.id ?? null,
              detectionTechnique: adoptedPf?.detectionTechnique ?? null,
              basis: adoptedPf?.basis ?? null,
            }
          : {
              intervalDays: null,
              detectionProbability: 0,
              opportunities: 0,
              reason:
                "No matching adopted P-F interval exists for this asset class and failure mode; no inspection interval is inferred.",
              pfIntervalId: null,
              detectionTechnique: null,
              basis: null,
            };

      const refusals: string[] = [];
      if (!source.plan.componentScope)
        refusals.push(
          "The maintenance task is not linked to a component-life population.",
        );
      if (!source.plan.failureMode)
        refusals.push("The maintenance task has no stated failure mode.");
      if (!source.plan.strategyKind)
        refusals.push("The current maintenance strategy kind is unknown.");
      if (source.plan.safetyCritical == null)
        refusals.push("Safety-critical applicability is unknown.");
      if (source.plan.regulatoryRequired == null)
        refusals.push("Regulatory applicability is unknown.");
      if (!source.plan.lifecycleObjective)
        refusals.push("No lifecycle objective is recorded for this task.");
      if (!hasCostEvidence)
        refusals.push(
          "Planned-task cost, failure-consequence cost and their provenance are incomplete; no age-replacement or run-to-failure decision is proposed.",
        );
      if (methodSelection.method === "none")
        refusals.push(methodSelection.reason);

      let recommendation: Record<string, unknown>;
      if (
        source.plan.strategyKind === "condition_based" &&
        inspection.intervalDays != null
      ) {
        recommendation = {
          kind: "inspection_interval",
          proposedStrategyKind: "condition_based",
          proposedIntervalBasis: "calendar_days",
          proposedIntervalValue: inspection.intervalDays,
          currentIntervalBasis: source.plan.intervalBasis,
          currentIntervalValue: Number(source.plan.intervalValue),
          reason: inspection.reason,
          humanApprovalRequired: true,
        };
      } else if (fit && ageReplacement.recommended) {
        recommendation = {
          kind: "interval_change",
          proposedStrategyKind: "time_based_pm",
          proposedIntervalBasis: "run_hours",
          proposedIntervalValue: ageReplacement.optimalAge,
          currentIntervalBasis: source.plan.intervalBasis,
          currentIntervalValue: Number(source.plan.intervalValue),
          savingsPct: ageReplacement.savingsPct,
          reason: ageReplacement.reason,
          humanApprovalRequired: true,
        };
      } else if (
        fit &&
        hasCostEvidence &&
        !ageReplacement.recommended &&
        source.plan.safetyCritical === false &&
        source.plan.regulatoryRequired === false &&
        (fit.beta <= 1 ||
          (plannedCost != null &&
            failureCost != null &&
            failureCost <= plannedCost))
      ) {
        recommendation = {
          kind: "run_to_failure_review",
          proposedStrategyKind: "run_to_failure",
          proposedIntervalBasis: null,
          proposedIntervalValue: null,
          reason: ageReplacement.reason,
          humanApprovalRequired: true,
          safetyCritical: false,
          regulatoryRequired: false,
        };
      } else if (fit && hasCostEvidence && !ageReplacement.recommended) {
        recommendation = {
          kind: "strategy_review",
          proposedStrategyKind: null,
          proposedIntervalBasis: null,
          proposedIntervalValue: null,
          reason:
            source.plan.safetyCritical !== false ||
            source.plan.regulatoryRequired !== false
              ? `${ageReplacement.reason} Run-to-failure is not proposed because safety or regulatory applicability is true or unknown.`
              : ageReplacement.reason,
          humanApprovalRequired: true,
        };
      } else {
        recommendation = {
          kind: "evidence_gap",
          proposedStrategyKind: null,
          proposedIntervalBasis: null,
          proposedIntervalValue: null,
          reason:
            "No programme change is proposed until the named evidence gaps are closed.",
          humanApprovalRequired: true,
        };
      }

      // A verified recurrence against the exact currently applied plan version
      // overrides an optimization proposal with a governed strategy review.
      // Historical outcomes remain in the evidence bundle but do not keep an
      // already-revised plan permanently in a refresh state.
      if (fieldExperience.revisionRequired) {
        recommendation = {
          kind: "strategy_review",
          proposedStrategyKind: null,
          proposedIntervalBasis: null,
          proposedIntervalValue: null,
          reason: `${fieldExperience.currentIneffectiveCount} independently concluded corrective-action outcome(s) show recurrence against the current maintenance-plan version. Re-open the failure and task logic before considering any interval or strategy change.`,
          humanApprovalRequired: true,
        };
      }

      const result = {
        methodSelection,
        ageReplacement,
        inspection,
        recommendation,
        fieldExperience,
        refusals,
        lifecyclePlan: {
          objective: source.plan.lifecycleObjective,
          assetId: source.asset.id,
          assetName: source.asset.name,
          assetCriticality: source.asset.criticality,
          existingLifecycleEvaluations: source.lifecycleEvaluations ?? [],
          fieldExperience,
          actions: [
            {
              action: recommendation.kind,
              maintenancePlanId: source.plan.id,
              reason: recommendation.reason,
              requiresNamedHumanAdoption: true,
            },
            ...(refusals.length > 0
              ? [
                  {
                    action: "close_evidence_gaps",
                    gaps: refusals,
                    requiresNamedHumanAdoption: false,
                  },
                ]
              : []),
          ],
        },
      };
      const { data: receiptData, error: receiptError } = await service.rpc(
        "record_asset_strategy_run_v2",
        {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_plan_id: source.plan.id,
          p_plan_version: source.plan.version,
          p_event_ids: events.map((event) => event.id),
          p_learning_event_ids: fieldExperience.eventIds,
          p_kernel_version: source.kernelVersion,
          p_result: result,
        },
      );
      if (receiptError) throw new Error(receiptError.message);
      const receipt = receiptData as { error?: string } | null;
      if (receipt?.error) return json({ error: receipt.error }, 422);
      return json(receipt);
    } catch (error) {
      console.error("asset-strategy calculation failed", error);
      return json({ error: "asset_strategy_calculation_failed" }, 422);
    }
  }

  if (body.action === "modelling_studio") {
    try {
      const [
        treesResult,
        schedulesResult,
        costResult,
        postureResult,
        graphResult,
        historyResult,
        costWorkOrderResult,
        treeIdentityResult,
        eventIdentityResult,
        dependencyIdentityResult,
        assetIdentityResult,
      ] = await Promise.all([
        userClient.rpc("get_fault_trees"),
        userClient.rpc("get_shutdown_schedules"),
        userClient.rpc("get_maintenance_cost_history", { p_months: 24 }),
        userClient.rpc("get_cost_capture_posture"),
        userClient.rpc("get_dependency_graph"),
        service
          .from("work_orders")
          .select(
            "id,asset_id,completed_at,downtime_hours,assets!inner(tag,name)",
          )
          .eq("organization_id", organizationId)
          .eq("work_type", "corrective")
          .not("completed_at", "is", null)
          .order("completed_at"),
        service
          .from("work_orders")
          .select("id,asset_id,completed_at")
          .eq("organization_id", organizationId)
          .not("completed_at", "is", null)
          .order("completed_at"),
        service
          .from("fault_trees")
          .select("id,tree_key")
          .eq("organization_id", organizationId),
        service
          .from("shutdown_events")
          .select("id,event_key")
          .eq("organization_id", organizationId),
        service
          .from("asset_dependencies")
          .select(
            "id,dependent_asset_id,supplier_asset_id,redundancy_group,min_suppliers_required",
          )
          .eq("organization_id", organizationId),
        service
          .from("assets")
          .select("id")
          .eq("organization_id", organizationId),
      ]);
      for (const result of [
        treesResult,
        schedulesResult,
        costResult,
        postureResult,
        graphResult,
        historyResult,
        costWorkOrderResult,
        treeIdentityResult,
        eventIdentityResult,
        dependencyIdentityResult,
        assetIdentityResult,
      ]) {
        if (result.error) throw new Error(result.error.message);
      }

      const treeIdentities = (treeIdentityResult.data ?? []) as Array<{
        id: string;
        tree_key: string;
      }>;
      const eventIdentities = (eventIdentityResult.data ?? []) as Array<{
        id: string;
        event_key: string;
      }>;
      const treeIds = treeIdentities.map((row) => row.id);
      const eventIds = eventIdentities.map((row) => row.id);
      const assetIdentities = (assetIdentityResult.data ?? []) as Array<{
        id: string;
      }>;
      const assetIds = assetIdentities.map((row) => row.id);
      const [
        nodeIdentityResult,
        taskIdentityResult,
        dependencyResult,
        economicsIdentityResult,
      ] = await Promise.all([
        treeIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : service
              .from("fault_tree_nodes")
              .select("id,tree_id,node_key")
              .in("tree_id", treeIds),
        eventIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : service
              .from("shutdown_tasks")
              .select("id,event_id,task_key")
              .in("event_id", eventIds),
        eventIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : service
              .from("shutdown_task_dependencies")
              .select("id,event_id,task_key,predecessor_key")
              .in("event_id", eventIds),
        assetIds.length === 0
          ? Promise.resolve({ data: [], error: null })
          : service
              .from("asset_economics")
              .select("id,asset_id")
              .in("asset_id", assetIds),
      ]);
      for (const result of [
        nodeIdentityResult,
        taskIdentityResult,
        dependencyResult,
        economicsIdentityResult,
      ]) {
        if (result.error) throw new Error(result.error.message);
      }

      const rawTrees = (treesResult.data ?? []) as Array<
        Omit<ModellingTreeSource, "id">
      >;
      const rawSchedules = (schedulesResult.data ?? []) as Array<
        Omit<ModellingScheduleSource, "id">
      >;
      const nodeIdentities = (nodeIdentityResult.data ?? []) as Array<{
        id: string | number;
        tree_id: string;
        node_key: string;
      }>;
      const taskIdentities = (taskIdentityResult.data ?? []) as Array<{
        id: string | number;
        event_id: string;
        task_key: string;
      }>;
      const trees: ModellingTreeSource[] = rawTrees.map((tree) => {
        const identity = treeIdentities.find(
          (candidate) => candidate.tree_key === tree.treeKey,
        );
        if (!identity)
          throw new Error("fault tree lost its canonical tenant identity");
        return {
          ...tree,
          id: identity.id,
          nodes: tree.nodes.map((node) => ({
            ...node,
            rowId: nodeIdentities.find(
              (candidate) =>
                candidate.tree_id === identity.id &&
                candidate.node_key === node.id,
            )?.id,
          })),
        };
      });
      const schedules: ModellingScheduleSource[] = rawSchedules.map(
        (schedule) => {
          const identity = eventIdentities.find(
            (candidate) => candidate.event_key === schedule.eventKey,
          );
          if (!identity)
            throw new Error(
              "shutdown event lost its canonical tenant identity",
            );
          return {
            ...schedule,
            id: identity.id,
            tasks: schedule.tasks.map((task) => ({
              ...task,
              rowId: taskIdentities.find(
                (candidate) =>
                  candidate.event_id === identity.id &&
                  candidate.task_key === task.id,
              )?.id,
            })),
          };
        },
      );
      type RawHistory = {
        id: string;
        asset_id: string;
        completed_at: string;
        downtime_hours: number | string | null;
        assets:
          | { tag: string | null; name: string }
          | Array<{ tag: string | null; name: string }>;
      };
      const history: ModellingHistoryRow[] = (
        (historyResult.data ?? []) as RawHistory[]
      ).map((row) => {
        const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
        return {
          id: row.id,
          asset_id: row.asset_id,
          tag: asset?.tag ?? null,
          name: asset?.name ?? "(unnamed)",
          completed_at: row.completed_at,
          downtime_hours: finiteNumber(row.downtime_hours) ?? 0,
        };
      });
      const graph = (graphResult.data ?? null) as ModellingGraphSource | null;
      const dependencyIdentities = (dependencyIdentityResult.data ??
        []) as Array<{
        id: string | number;
        dependent_asset_id: string;
        supplier_asset_id: string;
        redundancy_group: string | null;
        min_suppliers_required: number | null;
      }>;
      if (graph?.edges) {
        graph.edges = graph.edges.map((edge) => ({
          ...edge,
          id: dependencyIdentities.find(
            (candidate) =>
              candidate.dependent_asset_id === edge.dependent &&
              candidate.supplier_asset_id === edge.supplier &&
              candidate.redundancy_group === (edge.redundancyGroup ?? null) &&
              candidate.min_suppliers_required === (edge.minRequired ?? 1),
          )?.id,
        }));
      }
      type CostWorkOrderIdentity = {
        id: string;
        asset_id: string;
        completed_at: string;
      };
      const costWorkOrders = (costWorkOrderResult.data ??
        []) as CostWorkOrderIdentity[];
      const dataEnd = costWorkOrders.reduce<Date | null>((latest, row) => {
        const completed = new Date(row.completed_at);
        return !Number.isFinite(completed.getTime()) ||
          (latest && latest >= completed)
          ? latest
          : completed;
      }, null);
      const costWindowStart = dataEnd
        ? new Date(
            Date.UTC(dataEnd.getUTCFullYear(), dataEnd.getUTCMonth() - 24, 1),
          )
        : null;
      const costWindowWorkOrders = costWindowStart
        ? costWorkOrders.filter(
            (row) => new Date(row.completed_at) >= costWindowStart,
          )
        : [];
      const economicsIdentities = (economicsIdentityResult.data ??
        []) as Array<{
        id: string | number;
        asset_id: string;
      }>;
      const source = {
        trees,
        schedules,
        cost: ((costResult.data ?? []) as ModellingCostSource[]).map((row) => ({
          ...row,
          plannedCost: finiteNumber(row.plannedCost) ?? 0,
          unplannedCost: finiteNumber(row.unplannedCost) ?? 0,
          failureCount: finiteNumber(row.failureCount) ?? 0,
        })),
        posture: Array.isArray(postureResult.data)
          ? ((postureResult.data[0] ?? null) as Record<string, unknown> | null)
          : (postureResult.data as Record<string, unknown> | null),
        graph,
        history,
      };
      const analysis = analyseModellingStudio(source);

      async function recordModelRun(input: {
        subjectType: "organization" | "fault_tree" | "shutdown_event";
        subjectRef: string;
        key:
          | "fault_tree_quantification"
          | "shutdown_schedule_risk"
          | "organization_rbd"
          | "fleet_production_simulation"
          | "maintenance_cost_forecast";
        method: string;
        inputs: Record<string, unknown>;
        refs: Array<{ table: string; id: string }>;
        outputs: Record<string, unknown>;
        refusals: string[];
      }) {
        const { data, error } = await service.rpc("record_calculation_run", {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_subject_type: input.subjectType,
          p_subject_ref: input.subjectRef,
          p_key: input.key,
          p_method: input.method,
          p_inputs: input.inputs,
          p_input_refs: input.refs,
          p_outputs: input.outputs,
          p_refusals: input.refusals,
        });
        if (error) throw new Error(error.message);
        if (typeof data !== "string" || !data)
          throw new Error("calculation ledger returned no run identity");
        return data;
      }

      const treeRunIds = await Promise.all(
        analysis.trees.map((tree) => {
          const sourceTree = trees.find(
            (candidate) => candidate.id === tree.id,
          )!;
          return recordModelRun({
            subjectType: "fault_tree",
            subjectRef: tree.id,
            key: "fault_tree_quantification",
            method:
              "MOCUS minimal cut sets with bounded exact inclusion-exclusion, falling back to the labelled rare-event approximation only above the exact cut-set limit.",
            inputs: {
              treeKey: tree.treeKey,
              topEvent: tree.topEvent,
              basis: tree.basis,
              reviewed: tree.reviewed,
              nodes: sourceTree.nodes,
            },
            refs: [
              inputRef("fault_trees", tree.id),
              ...sourceTree.nodes
                .filter((node) => node.rowId != null)
                .map((node) => inputRef("fault_tree_nodes", node.rowId!)),
            ],
            outputs: { result: tree.result, importance: tree.importance },
            refusals: tree.result.computable ? [] : [tree.result.reason],
          });
        }),
      );
      const scheduleRunIds = await Promise.all(
        analysis.schedules.map((schedule) => {
          const sourceSchedule = schedules.find(
            (candidate) => candidate.id === schedule.id,
          )!;
          const dependencyRows = (dependencyResult.data ?? []) as Array<{
            id: string | number;
            event_id: string;
          }>;
          return recordModelRun({
            subjectType: "shutdown_event",
            subjectRef: schedule.id,
            key: "shutdown_schedule_risk",
            method:
              "Deterministic CPM plus 2,000 seeded triangular-duration simulations, reporting P10/P50/P80/P90, on-plan probability and task criticality index.",
            inputs: {
              eventKey: schedule.eventKey,
              status: schedule.status,
              tasks: sourceSchedule.tasks,
              iterations: 2000,
              seed: schedule.result.seed,
            },
            refs: [
              inputRef("shutdown_events", schedule.id),
              ...sourceSchedule.tasks
                .filter((task) => task.rowId != null)
                .map((task) => inputRef("shutdown_tasks", task.rowId!)),
              ...dependencyRows
                .filter((row) => row.event_id === schedule.id)
                .map((row) => inputRef("shutdown_task_dependencies", row.id)),
            ],
            outputs: { result: schedule.result },
            refusals: schedule.result.simulated ? [] : [schedule.result.reason],
          });
        }),
      );
      const historyRefs = history.map((row) => inputRef("work_orders", row.id));
      const dependencyRefs = dependencyIdentities.map((row) =>
        inputRef("asset_dependencies", row.id),
      );
      const assetRefs = assetIdentities.map((row) =>
        inputRef("assets", row.id),
      );
      const commonCauseRefs = (graph?.commonCauseGroups ?? []).flatMap(
        (group) => [
          inputRef("common_cause_groups", group.id),
          ...(group.members ?? []).map((member) =>
            inputRef("common_cause_members", `${group.id}:${member}`),
          ),
        ],
      );
      const costRefs = [
        ...costWindowWorkOrders.map((row) => inputRef("work_orders", row.id)),
        ...economicsIdentities.map((row) =>
          inputRef("asset_economics", row.id),
        ),
        ...assetRefs,
      ];
      const rbdRefusals = [
        ...(analysis.rbd.result.computable ? [] : [analysis.rbd.result.reason]),
        ...(analysis.rbd.result.groupsWithUnquantifiedCommonCause.length > 0
          ? [
              `${analysis.rbd.result.groupsWithUnquantifiedCommonCause.length} redundancy group(s) have unquantified common cause; the reported figure is an upper bound.`,
            ]
          : []),
      ];
      const [rbdRunId, simulationRunId, forecastRunId] = await Promise.all([
        recordModelRun({
          subjectType: "organization",
          subjectRef: organizationId,
          key: "organization_rbd",
          method:
            "Compile the tenant asset-dependency graph into k-out-of-n groups and evaluate the series system from observed corrective-history availability using the shared RBD kernel.",
          inputs: {
            graph,
            correctiveWorkOrderCount: history.length,
          },
          refs: [
            ...dependencyRefs,
            ...historyRefs,
            ...assetRefs,
            ...commonCauseRefs,
          ],
          outputs: analysis.rbd as unknown as Record<string, unknown>,
          refusals: rbdRefusals,
        }),
        recordModelRun({
          subjectType: "organization",
          subjectRef: organizationId,
          key: "fleet_production_simulation",
          method:
            "Select a deterministic Weibull estimator from corrective interarrival history, pair it with observed median repair time, and run 300 seeded one-year fleet-availability simulations.",
          inputs: {
            correctiveWorkOrderCount: history.length,
            horizonHours: 8760,
            iterations: 300,
            seed: 20260824,
            capacityBasis: "unweighted",
          },
          refs: historyRefs,
          outputs: analysis.simulation as unknown as Record<string, unknown>,
          refusals: analysis.simulation.simulable
            ? []
            : [analysis.simulation.reason],
        }),
        recordModelRun({
          subjectType: "organization",
          subjectRef: organizationId,
          key: "maintenance_cost_forecast",
          method:
            "Forecast one period from the canonical downtime-cost proxy: trend planned history only with at least four periods and use empirical P50/P90 unplanned quantiles.",
          inputs: {
            periods: source.cost,
            posture: source.posture,
            horizonPeriods: 1,
          },
          refs: costRefs,
          outputs: analysis.forecast as unknown as Record<string, unknown>,
          refusals: analysis.forecast.forecastable
            ? []
            : [analysis.forecast.reason],
        }),
      ]);

      return json({
        ...analysis,
        posture: source.posture,
        lineage: {
          trees: analysis.trees.map((tree, index) => ({
            subjectId: tree.id,
            runId: treeRunIds[index],
          })),
          schedules: analysis.schedules.map((schedule, index) => ({
            subjectId: schedule.id,
            runId: scheduleRunIds[index],
          })),
          rbdRunId,
          simulationRunId,
          forecastRunId,
        },
        governance: {
          advisory: true,
          operationalAuthorization: false,
          humanApprovalRequired: true,
          note: "These model results support engineering decisions; they do not approve work, change a maintenance strategy, or authorize an outage.",
        },
      });
    } catch (error) {
      console.error("modelling studio calculation failed", error);
      return json({ error: "modelling_studio_calculation_failed" }, 422);
    }
  }

  if (body.action !== "value_management")
    return json({ error: "unsupported_action" }, 400);
  const budget = finiteNumber(body.budget);
  if (budget === null || budget < 0 || budget > MAX_BUDGET)
    return json(
      { error: "budget_must_be_finite_nonnegative_and_bounded" },
      400,
    );

  async function recordRun(input: {
    subjectType: "organization" | "business_case" | "capital_plan_year";
    subjectRef: string;
    key: "business_case_option_comparison" | "capital_plan_prioritisation";
    method: string;
    inputs: Record<string, unknown>;
    inputRefs: { table: string; id: string }[];
    outputs: Record<string, unknown> | null;
    refusals: string[];
  }): Promise<string> {
    const { data, error } = await service.rpc("record_calculation_run", {
      p_organization_id: organizationId,
      p_actor_id: actorId,
      p_subject_type: input.subjectType,
      p_subject_ref: input.subjectRef,
      p_key: input.key,
      p_method: input.method,
      p_inputs: input.inputs,
      p_input_refs: input.inputRefs,
      p_outputs: input.outputs,
      p_refusals: input.refusals,
    });
    if (error) throw new Error(error.message);
    if (typeof data !== "string" || !data)
      throw new Error("calculation ledger returned no run identity");
    return data;
  }

  try {
    const [postureResult, businessCaseResult, planYearResult] =
      await Promise.all([
        userClient.rpc("get_value_posture"),
        service
          .from("business_cases")
          .select(
            "id,case_ref,title,driver,discount_rate,discount_rate_source,status",
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        service
          .from("capital_plan_items")
          .select("plan_year")
          .eq("organization_id", organizationId)
          .order("plan_year", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    if (postureResult.error) throw new Error(postureResult.error.message);
    if (businessCaseResult.error)
      throw new Error(businessCaseResult.error.message);
    if (planYearResult.error) throw new Error(planYearResult.error.message);

    const businessCase = businessCaseResult.data as BusinessCaseRow | null;
    const planYear = (planYearResult.data as { plan_year: number } | null)
      ?.plan_year;

    const [optionsResult, planResult] = await Promise.all([
      businessCase
        ? service
            .from("business_case_options")
            .select(
              "id,label,life_periods,cash_flows,benefit_probability,is_do_nothing,notes",
            )
            .eq("organization_id", organizationId)
            .eq("case_id", businessCase.id)
            .order("label")
        : Promise.resolve({ data: [], error: null }),
      planYear == null
        ? Promise.resolve({ data: [], error: null })
        : service
            .from("capital_plan_items")
            .select(
              "id,plan_year,label,cost,benefit_present_value,mandatory,mandatory_basis,case_id",
            )
            .eq("organization_id", organizationId)
            .eq("plan_year", planYear)
            .order("label"),
    ]);
    if (optionsResult.error) throw new Error(optionsResult.error.message);
    if (planResult.error) throw new Error(planResult.error.message);

    const optionRows = (optionsResult.data ?? []) as BusinessCaseOptionRow[];
    const planRows = (planResult.data ?? []) as CapitalPlanRow[];

    const comparisonRefusals: string[] = [];
    const discountRate = finiteNumber(businessCase?.discount_rate);
    const duplicateOptionLabels = optionRows.filter(
      (row, index) =>
        optionRows.findIndex((candidate) => candidate.label === row.label) !==
        index,
    );
    if (duplicateOptionLabels.length > 0)
      comparisonRefusals.push(
        "Business-case option labels are not unique, so a ranked label could not identify one canonical option.",
      );
    const options = optionRows.map((row) => {
      const flows = Array.isArray(row.cash_flows)
        ? (row.cash_flows as CashFlow[])
        : [];
      const defect = cashFlowsDefect(flows);
      if (!Array.isArray(row.cash_flows) || defect)
        comparisonRefusals.push(
          `${row.label}: ${defect ?? "cash flows are not an array"}`,
        );
      if (!Number.isInteger(row.life_periods) || Number(row.life_periods) <= 0)
        comparisonRefusals.push(
          `${row.label}: service life is not a positive whole number of periods.`,
        );
      return {
        label: row.label,
        lifePeriods: Number(row.life_periods),
        cashFlows: flows,
      };
    });
    if (!businessCase)
      comparisonRefusals.push(
        "No business case is recorded for this organization.",
      );
    if (businessCase && optionRows.length === 0)
      comparisonRefusals.push(
        "The latest business case has no options to compare.",
      );
    if (
      businessCase &&
      (discountRate === null || discountRate < 0 || discountRate >= 1)
    )
      comparisonRefusals.push(
        "The business-case discount rate is not a valid finite rate in [0,1).",
      );

    const comparison =
      businessCase &&
      options.length > 0 &&
      discountRate !== null &&
      discountRate >= 0 &&
      discountRate < 1 &&
      comparisonRefusals.length === 0
        ? compareOptions(options, discountRate)
        : null;
    const optionRunId = await recordRun({
      subjectType: businessCase ? "business_case" : "organization",
      subjectRef: businessCase ? String(businessCase.id) : organizationId,
      key: "business_case_option_comparison",
      method:
        "Discount each recorded option cash flow at the business case rate; rank equal-life options by NPV and mixed-life options by equivalent annual value using the shared value kernel.",
      inputs: {
        businessCaseId: businessCase?.id ?? null,
        caseRef: businessCase?.case_ref ?? null,
        discountRate,
        discountRateSource: businessCase?.discount_rate_source ?? null,
        optionCount: optionRows.length,
        options: optionRows.map((row) => ({
          id: row.id,
          label: row.label,
          lifePeriods: row.life_periods,
          cashFlows: row.cash_flows,
        })),
      },
      inputRefs: [
        ...(businessCase ? [inputRef("business_cases", businessCase.id)] : []),
        ...optionRows.map((row) => inputRef("business_case_options", row.id)),
      ],
      outputs: comparison as unknown as Record<string, unknown> | null,
      refusals: comparisonRefusals,
    });

    const planRefusals: string[] = [];
    const plan = planRows.map((row) => {
      const cost = finiteNumber(row.cost);
      const benefit =
        row.benefit_present_value == null
          ? null
          : finiteNumber(row.benefit_present_value);
      if (cost === null || cost < 0)
        planRefusals.push(
          `${row.label}: recorded cost is not a finite non-negative number.`,
        );
      if (row.benefit_present_value != null && benefit === null)
        planRefusals.push(
          `${row.label}: recorded benefit is not a finite number.`,
        );
      return {
        id: row.id,
        label: row.label,
        cost: cost ?? 0,
        costValid: cost !== null && cost >= 0,
        benefit: benefit ?? 0,
        benefitRecorded: row.benefit_present_value != null && benefit !== null,
        prioritisationEligible:
          !row.mandatory &&
          cost !== null &&
          cost > 0 &&
          benefit !== null &&
          benefit > 0,
        mandatory: row.mandatory,
        mandatoryBasis: row.mandatory_basis,
      };
    });
    const duplicatePlanLabels = plan.filter(
      (item, index) =>
        plan.findIndex((candidate) => candidate.label === item.label) !== index,
    );
    if (duplicatePlanLabels.length > 0)
      planRefusals.push(
        "Capital-plan labels are not unique, so a funded label could not identify one canonical plan item.",
      );
    const mandatory = plan.filter((item) => item.mandatory);
    const mandatoryCost = mandatory.reduce((sum, item) => sum + item.cost, 0);
    const discretionary = plan
      .filter((item) => item.prioritisationEligible)
      .map((item) => ({
        label: item.label,
        cost: item.cost,
        benefit: item.benefit,
      }));
    if (planRows.length === 0)
      planRefusals.push("No capital plan is recorded for this organization.");
    const ineligibleBenefits = plan.filter(
      (item) => !item.mandatory && (!item.benefitRecorded || item.benefit <= 0),
    );
    if (ineligibleBenefits.length > 0)
      planRefusals.push(
        `${ineligibleBenefits.length} non-mandatory plan item(s) have no finite positive recorded benefit and were excluded from benefit-cost prioritisation.`,
      );
    const zeroCostDiscretionary = plan.filter(
      (item) => !item.mandatory && item.costValid && item.cost === 0,
    );
    if (zeroCostDiscretionary.length > 0)
      planRefusals.push(
        `${zeroCostDiscretionary.length} non-mandatory plan item(s) have zero recorded cost, so benefit per unit cost is undefined and they were excluded.`,
      );
    if (mandatoryCost > budget)
      planRefusals.push(
        `Mandatory commitments exceed the stated budget by ${mandatoryCost - budget}; no discretionary budget remains.`,
      );
    const prioritisation =
      planRows.length === 0 ||
      plan.some((item) => !item.costValid) ||
      duplicatePlanLabels.length > 0
        ? null
        : prioritiseUnderBudget(
            discretionary,
            Math.max(0, budget - mandatoryCost),
          );
    const planRunId = await recordRun({
      subjectType: planYear == null ? "organization" : "capital_plan_year",
      subjectRef: planYear == null ? organizationId : String(planYear),
      key: "capital_plan_prioritisation",
      method:
        "Fund mandatory recorded commitments first, then select discretionary capital items by recorded benefit per unit cost within the remaining user-stated budget using the shared value kernel.",
      inputs: {
        planYear: planYear ?? null,
        statedBudget: budget,
        mandatoryCost,
        discretionaryBudget: Math.max(0, budget - mandatoryCost),
        itemCount: planRows.length,
        items: planRows.map((row) => ({
          id: row.id,
          caseId: row.case_id,
          label: row.label,
          cost: row.cost,
          benefitPresentValue: row.benefit_present_value,
          mandatory: row.mandatory,
          mandatoryBasis: row.mandatory_basis,
        })),
      },
      inputRefs: planRows.map((row) => inputRef("capital_plan_items", row.id)),
      outputs:
        prioritisation == null
          ? null
          : ({
              mandatory: mandatory.map((item) => item.label),
              mandatoryCost,
              discretionaryBudget: Math.max(0, budget - mandatoryCost),
              ...prioritisation,
            } as Record<string, unknown>),
      refusals: planRefusals,
    });

    return json({
      posture: Array.isArray(postureResult.data)
        ? (postureResult.data[0] ?? null)
        : (postureResult.data ?? null),
      businessCase: businessCase
        ? {
            caseRef: businessCase.case_ref,
            title: businessCase.title,
            driver: businessCase.driver,
            discountRate,
            discountRateSource: businessCase.discount_rate_source,
            status: businessCase.status,
            options: optionRows.map((row) => ({
              label: row.label,
              lifePeriods: Number(row.life_periods),
              cashFlows: row.cash_flows,
              benefitProbability:
                row.benefit_probability == null
                  ? null
                  : Number(row.benefit_probability),
              isDoNothing: row.is_do_nothing,
              notes: row.notes,
            })),
          }
        : null,
      comparison,
      planYear: planYear ?? null,
      plan: plan.map((item) => ({
        id: item.id,
        label: item.label,
        cost: item.cost,
        benefit: item.benefit,
        benefitRecorded: item.benefitRecorded,
        mandatory: item.mandatory,
        mandatoryBasis: item.mandatoryBasis,
      })),
      prioritisation:
        prioritisation == null
          ? null
          : {
              mandatory: mandatory.map((item) => ({
                id: item.id,
                label: item.label,
                cost: item.cost,
                benefit: item.benefit,
                benefitRecorded: item.benefitRecorded,
                mandatory: item.mandatory,
                mandatoryBasis: item.mandatoryBasis,
              })),
              mandatoryCost,
              result: prioritisation,
            },
      refusals: {
        optionComparison: comparisonRefusals,
        capitalPlan: planRefusals,
      },
      lineage: {
        optionComparisonRunId: optionRunId,
        capitalPlanRunId: planRunId,
      },
      governance: {
        advisory: true,
        operationalAuthorization: false,
        humanApprovalRequired: true,
        note: "These calculations support a decision; they do not approve a business case or authorize capital spending.",
      },
    });
  } catch (error) {
    console.error("calculation-service failed", error);
    return json({ error: "calculation_failed" }, 422);
  }
});

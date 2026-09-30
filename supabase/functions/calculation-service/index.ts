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

  let body: { action?: unknown; budget?: unknown; component?: unknown };
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

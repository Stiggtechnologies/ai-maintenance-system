import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103040001_ai_commercial_cost_controls.sql",
  "utf8",
).toLowerCase();
const processor = readFileSync(
  "supabase/functions/ai-agent-processor/index.ts",
  "utf8",
);
const investigation = readFileSync(
  "supabase/functions/sync-investigation-runtime/index.ts",
  "utf8",
);
const realtime = readFileSync(
  "supabase/functions/sync-realtime-session/index.ts",
  "utf8",
);
const agentLoopEnrich = readFileSync(
  "supabase/functions/agent-loop-enrich/index.ts",
  "utf8",
);
const onboardingEnrich = readFileSync(
  "supabase/functions/onboarding-enrich/index.ts",
  "utf8",
);
const commercialUsageBoundary = readFileSync(
  "supabase/functions/_shared/llm-commercial-usage.ts",
  "utf8",
);
const developPaidRuntimeNames = [
  "develop-evidence-agent",
  "develop-change-impact-agent",
  "develop-contract-strategy-agent",
  "develop-gate-agent",
  "develop-methodology-agent",
  "develop-requirements-agent",
  "develop-risk-agent",
] as const;
const developPaidRuntimes = developPaidRuntimeNames.map((name) => ({
  name,
  source: readFileSync(`supabase/functions/${name}/index.ts`, "utf8"),
}));
const marketplaceSmokes = [
  "scripts/ci-azure-marketplace-fulfillment-smoke.sh",
  "scripts/ci-azure-marketplace-lifecycle-smoke.sh",
  "scripts/ci-azure-marketplace-metering-smoke.sh",
  "scripts/ci-azure-marketplace-preview-certification-smoke.sh",
].map((path) => readFileSync(path, "utf8").toLowerCase());

describe("AI commercial cost controls", () => {
  it("extends the canonical usage and quota records instead of creating a parallel ledger", () => {
    expect(migration).toContain("alter table private.llm_usage");
    expect(migration).toContain("alter table private.llm_org_quotas");
    expect(migration).not.toMatch(
      /create table if not exists private\.(?:ai_usage|ai_quotas|token_usage)/,
    );
    for (const column of [
      "cost_object_type",
      "cost_object_id",
      "billing_subscription_id",
      "service_tier",
      "pricing_mode_status",
      "inference_cost_cad",
      "cost_status",
    ]) {
      expect(migration).toContain(column);
    }
  });

  it("contains no invented commercial-policy seed", () => {
    const beforeConfigurator = migration.slice(
      0,
      migration.indexOf(
        "create or replace function public.configure_ai_commercial_plan_policy",
      ),
    );
    expect(beforeConfigurator).not.toContain(
      "insert into private.ai_commercial_plan_policies",
    );
    expect(migration).toContain("status text not null default 'draft'");
  });

  it("makes per-user usage a hard-stop and reserves metered overage for flat-rate plans", () => {
    expect(migration).toContain(
      "check (pricing_model<>'per_user' or allowance_mode='hard_stop')",
    );
    expect(migration).toContain("per-user plans cannot use metered overage");
    expect(migration).toContain(
      "hard-stop plans cannot contain unpriced overage capacity",
    );
    expect(migration).toContain(
      "marketplace meter does not match approved ai policy",
    );
  });

  it("gates approval on provider-stressed worst-model COGS plus explicit non-inference cost", () => {
    expect(migration).toContain(
      "max(greatest(pr.input_cad_per_mtok,pr.output_cad_per_mtok))",
    );
    expect(migration).toContain("provider_cost_multiplier numeric not null");
    expect(migration).toContain("check (provider_cost_multiplier>=1)");
    expect(migration).toContain(
      "v_max_token_rate*v_policy.provider_cost_multiplier",
    );
    expect(migration).toContain(
      "'providercostmultiplier',v_policy.provider_cost_multiplier",
    );
    expect(migration).toContain(
      "'modeledworstcasecadpermilliontokens',v_modeled_max_token_rate",
    );
    expect(migration).toContain("v_policy.non_inference_variable_cost_cad");
    expect(migration).toContain("base_margin_below_threshold");
    expect(migration).toContain("overage_margin_below_threshold");
    expect(migration).toContain("ai gross-margin gate failed");
    expect(migration).toContain(
      "join auth.users identity on identity.id=profile.id",
    );
    expect(migration).toContain(
      "where profile.id=p_approved_by and profile.role in ('admin','ai_admin')",
    );
  });

  it("blocks a Microsoft subscription from activating without an approved boundary", () => {
    expect(migration).toContain(
      "marketplace activation blocked: approved ai commercial policy is absent",
    );
    expect(migration).toContain(
      "create trigger billing_subscription_ai_commercial_gate",
    );
    expect(migration).toContain(
      "perform public.apply_ai_commercial_plan_allowance(new.id)",
    );
  });

  it("scales per-user allowances from authoritative Marketplace quantity", () => {
    expect(migration).toContain("commercial_quantity integer");
    expect(migration).toContain(
      "per-user ai policy requires authoritative purchased quantity",
    );
    expect(migration).toContain(
      "marketplace activation blocked: per-user quantity is absent",
    );
    expect(migration).toContain(
      "v_policy.included_tokens_per_period*v_commercial_quantity",
    );
    expect(migration).toContain(
      "v_policy.max_decisions_per_period*v_commercial_quantity",
    );
    expect(migration).toMatch(
      /update of status,billing_source,marketplace_status,[\s\S]*?marketplace_quantity,plan/,
    );
  });

  it("keeps every Marketplace activation fixture behind an approved commercial policy", () => {
    for (const smoke of marketplaceSmokes) {
      expect(smoke).toContain("configure_ai_commercial_plan_policy");
      expect(smoke).toContain("approve_ai_commercial_plan_policy");
      expect(smoke).toContain("ci-only");
      expect(smoke).toMatch(/,[12]\.00,0\.50,/);
    }
    expect(marketplaceSmokes[2]).toContain("'metered_overage'");
    expect(marketplaceSmokes[2]).toContain("'tokens_1k'");
  });

  it("enforces commercial period calls, tokens, models, and decision count before spend", () => {
    for (const limit of [
      "max_calls_per_commercial_period",
      "max_tokens_per_commercial_period",
      "model_not_approved_for_plan",
      "max_decisions_per_commercial_period",
      "commercial_pricing_mode_breached",
      "commercial_runtime_boundary_unavailable",
    ]) {
      expect(migration).toContain(limit);
    }
    expect(migration).toContain(
      "create or replace function public.check_llm_commercial_quota",
    );
    expect(migration).toContain("delete from private.llm_usage");
    expect(migration).toContain("realtime_usage_settlement_unavailable");
  });

  it("snapshots exact price and exposes measured average, p50, and p95 decision cost", () => {
    expect(migration).toContain("requested_model text");
    expect(migration).toContain("priced_model text");
    expect(migration).toContain("commercial_allowed_models_snapshot text[]");
    expect(migration).toContain(
      "create or replace function private.resolve_priced_llm_model",
    );
    expect(migration).toContain("else 'unapproved_model'");
    expect(migration).toContain("commercial_model_policy_breached");
    expect(migration).toContain(
      "then v_price.input_cad_per_mtok else null end",
    );
    expect(migration).toContain("then v_price.effective_date else null end");
    expect(migration).toContain("cost_status=v_status");
    expect(migration).toContain(
      "create or replace function public.get_ai_unit_economics",
    );
    expect(migration).toContain("percentile_cont(0.5)");
    expect(migration).toContain("percentile_cont(0.95)");
    expect(migration).toContain("unattributedcalls");
    expect(migration).toContain("unknownpricecalls");
    expect(migration).toContain("modelpolicyviolationcalls");
    expect(migration).toContain("pricingmodeviolationcalls");
    expect(migration).toContain("nonstandard_tier");
    expect(migration).toContain("missing_tier");
    expect(marketplaceSmokes[0]).toContain("gpt-4o-mini-2024-07-18");
    expect(marketplaceSmokes[0]).toContain(
      "actual-model mismatch did not freeze later spend",
    );
    expect(marketplaceSmokes[0]).toContain(
      "pricing-mode mismatch did not freeze later spend",
    );
    expect(marketplaceSmokes[0]).toContain(
      "pricing_mode_status='nonstandard_tier'",
    );
  });

  it("enforces the known customer-paid runtime surfaces and attaches their cost subjects", () => {
    expect(processor).toContain('"check_llm_quota"');
    expect(migration).toContain(
      "coalesce(nullif(btrim(p_fn),''),'unknown')='ai-agent-processor'",
    );
    expect(migration).toContain("model_not_approved_for_plan");
    for (const runtime of [
      investigation,
      realtime,
      agentLoopEnrich,
      onboardingEnrich,
    ]) {
      expect(runtime).toContain('"check_llm_commercial_quota"');
    }
    expect(investigation).toContain(
      '{ type: "sync_conversation", id: workspaceId }',
    );
    expect(agentLoopEnrich).toContain('p_cost_object_type: "recommendation"');
    expect(onboardingEnrich).toContain(
      'p_cost_object_type: "asset_onboarding"',
    );
    for (const runtime of [agentLoopEnrich, onboardingEnrich]) {
      expect(runtime).toContain("p_reservation_id: reservationId");
      expect(runtime).toContain('"release_llm_reservation"');
    }
    expect(
      commercialUsageBoundary.indexOf('"check_llm_commercial_quota"'),
    ).toBeLessThan(commercialUsageBoundary.indexOf("callWithResilience("));
    expect(commercialUsageBoundary.indexOf("callWithResilience(")).toBeLessThan(
      commercialUsageBoundary.indexOf('"record_llm_usage"'),
    );
    expect(commercialUsageBoundary).toContain('"release_llm_reservation"');
    expect(commercialUsageBoundary).toContain("paidCommercialProviders(");
    expect(commercialUsageBoundary).toContain(
      'provider.name === "openai-direct"',
    );
    expect(commercialUsageBoundary).toContain(
      "provider.model === requestedModel",
    );
    expect(commercialUsageBoundary).toContain(
      "PAID_STANDARD_RATE_MAX_OUTPUT_TOKENS = 8_192",
    );
    expect(commercialUsageBoundary).toContain(
      "PAID_STANDARD_RATE_MAX_TOKEN_UPPER_BOUND = 100_000",
    );
    expect(commercialUsageBoundary).toContain(
      'limit: "commercial_standard_rate_envelope_exceeded"',
    );
    expect(commercialUsageBoundary).toContain(
      'payload.service_tier = "default"',
    );
    expect(commercialUsageBoundary).toContain(
      'payload.prompt_cache_options = { mode: "explicit" }',
    );
    expect(commercialUsageBoundary).toContain(
      'error: "commercial_service_tier_mismatch"',
    );
    expect(commercialUsageBoundary).toContain("reservationTokenUpperBound");
    expect(commercialUsageBoundary).toContain("p_service_tier:");
    for (const runtime of developPaidRuntimes) {
      expect(runtime.source).toContain("callWithCommercialBoundary(");
      expect(runtime.source).toContain(`functionName: "${runtime.name}"`);
      expect(runtime.source).toContain("estimatedTokens:");
      expect(runtime.source).not.toContain("callWithResilience(");
    }
    for (const runtime of developPaidRuntimes.filter(({ name }) =>
      [
        "develop-evidence-agent",
        "develop-change-impact-agent",
        "develop-contract-strategy-agent",
        "develop-gate-agent",
        "develop-requirements-agent",
      ].includes(name),
    )) {
      expect(runtime.source).toContain(
        'costObject: { type: "development_case", id: caseId }',
      );
    }
  });

  it("keeps every policy and reporting RPC service-only", () => {
    for (const fn of [
      "evaluate_ai_commercial_plan_policy",
      "configure_ai_commercial_plan_policy",
      "apply_ai_commercial_plan_allowance",
      "approve_ai_commercial_plan_policy",
      "check_llm_commercial_quota",
      "get_ai_unit_economics",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([\\s\\S]*?from public,anon,authenticated`,
        ),
      );
    }
  });
});

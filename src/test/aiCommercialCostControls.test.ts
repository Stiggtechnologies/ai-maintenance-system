import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103020000_ai_commercial_cost_controls.sql",
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

  it("gates approval on worst-model inference COGS plus explicit non-inference cost", () => {
    expect(migration).toContain(
      "max(greatest(pr.input_cad_per_mtok,pr.output_cad_per_mtok))",
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

  it("enforces commercial period calls, tokens, models, and decision count before spend", () => {
    for (const limit of [
      "max_calls_per_commercial_period",
      "max_tokens_per_commercial_period",
      "model_not_approved_for_plan",
      "max_decisions_per_commercial_period",
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
    expect(migration).toContain(
      "input_cad_per_mtok=v_price.input_cad_per_mtok",
    );
    expect(migration).toContain("price_effective_date=v_price.effective_date");
    expect(migration).toContain("cost_status=v_status");
    expect(migration).toContain(
      "create or replace function public.get_ai_unit_economics",
    );
    expect(migration).toContain("percentile_cont(0.5)");
    expect(migration).toContain("percentile_cont(0.95)");
    expect(migration).toContain("unattributedcalls");
    expect(migration).toContain("unknownpricecalls");
  });

  it("enforces every paid runtime and attaches cost subjects where the runtime exposes one", () => {
    expect(processor).toContain('"check_llm_quota"');
    expect(migration).toContain("model_not_approved_for_plan");
    for (const runtime of [investigation, realtime]) {
      expect(runtime).toContain('"check_llm_commercial_quota"');
    }
    expect(investigation).toContain(
      '{ type: "sync_conversation", id: workspaceId }',
    );
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

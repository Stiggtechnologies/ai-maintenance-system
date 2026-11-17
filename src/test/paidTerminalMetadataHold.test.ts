import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settlement = readFileSync(
  "supabase/migrations/20270105110600_paid_terminal_usage_settlement.sql",
  "utf8",
);
const boundary = readFileSync(
  "supabase/functions/_shared/llm-commercial-usage.ts",
  "utf8",
);
const investigation = readFileSync(
  "supabase/functions/sync-investigation-runtime/index.ts",
  "utf8",
);
const processor = readFileSync(
  "supabase/functions/ai-agent-processor/index.ts",
  "utf8",
);
const realtime = readFileSync(
  "supabase/functions/sync-realtime-session/index.ts",
  "utf8",
);

describe("paid commercial route hold", () => {
  it("refuses a priced success when terminal usage or model metadata is missing", () => {
    expect(settlement).toContain("v_terminal_metadata_missing");
    expect(settlement).toContain("p_prompt_tokens is null");
    expect(settlement).toContain("p_completion_tokens is null");
    expect(settlement).toContain("v_prompt = 0 and v_completion = 0");
    expect(settlement).toContain("v_actual_model in ('unknown','pending')");
    expect(settlement).toContain("v_status := 'unknown_price'");
    expect(settlement).toContain("v_pricing_mode_status := 'missing_tier'");
    expect(settlement).not.toMatch(/insert into private\.llm_prices/i);
    expect(settlement).not.toMatch(
      /insert into private\.ai_commercial_plan_policies/i,
    );
    expect(boundary).toContain("commercial_terminal_metadata_missing");
    expect(boundary.indexOf("terminalMetadataMissing")).toBeLessThan(
      boundary.lastIndexOf('status: "ok"'),
    );
  });

  it("makes every paid caller use or explicitly refuse the qualified route", () => {
    expect(investigation).toContain("commercial_route_refused");
    expect(realtime).toContain('"check_llm_commercial_quota"');
    expect(processor).toContain('"check_llm_quota"');
    const quota = readFileSync(
      "supabase/migrations/20270105110300_ai_commercial_cost_controls.sql",
      "utf8",
    );
    expect(quota).toContain("commercial_runtime_boundary_unavailable");
    expect(quota).toContain("realtime_usage_settlement_unavailable");
    for (const name of [
      "develop-evidence-agent",
      "develop-change-impact-agent",
      "develop-contract-strategy-agent",
      "develop-gate-agent",
      "develop-methodology-agent",
      "develop-requirements-agent",
      "develop-risk-agent",
      "agent-loop-enrich",
      "onboarding-enrich",
    ]) {
      const source = readFileSync(
        `supabase/functions/${name}/index.ts`,
        "utf8",
      );
      expect(source, name).toContain("callWithCommercialBoundary(");
    }
  });
});

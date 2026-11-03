import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271108140000_long_horizon_value_plan.sql",
  "utf8",
);
const page = readFileSync("src/pages/DevelopmentPortfolioPage.tsx", "utf8");
const service = readFileSync(
  "src/services/longHorizonValuePlanService.ts",
  "utf8",
);

describe("A1.05 long-horizon value plan contract", () => {
  it("reuses the canonical stores and withholds unsafe totals", () => {
    for (const table of [
      "capital_plan_items",
      "budget_lines",
      "asset_economics",
      "lifecycle_evaluations",
      "risks",
      "production_records",
      "threat_scenarios",
      "climate_resilience_assessments",
      "evidence_items",
      "calculation_runs",
      "audit_events",
    ]) {
      expect(migration).toContain(table);
    }
    expect(migration).toContain("budget lines record no currency");
    expect(migration).toContain("missing capital is not zero");
    expect(migration).not.toContain("horizonMultiplication', true");
    expect(migration).toContain("'horizonMultiplication', false");
    expect(migration).toContain("'expenditureAuthorized', false");
    expect(migration).toContain("AI operator is refused");
    expect(migration).toContain("app_current_aal() <> 'aal2'");
    expect(migration).toContain("verified_by is distinct from v_actor");
    expect(migration).toContain(
      "the author cannot adopt their own long-horizon plan",
    );
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("public.app_current_org()");
  });

  it("locks direct writes and exposes only the governed doors", () => {
    expect(migration).toContain(
      "revoke all on table public.long_horizon_plans from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant select on table public.long_horizon_plans to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.record_long_horizon_plan(jsonb) from public, anon, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.record_long_horizon_plan(jsonb) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.compose_long_horizon_value(uuid)",
    );
    expect(migration).not.toContain(
      "grant execute on function public.compose_long_horizon_value(uuid) to authenticated",
    );
  });

  it("is reachable from the capital-planning portfolio", () => {
    expect(page).toContain("<LongHorizonValuePlan");
    expect(service).toContain('"get_long_horizon_value_plan"');
    expect(service).toContain('"record_long_horizon_plan"');
    expect(service).toContain('"adopt_long_horizon_plan"');
  });
});

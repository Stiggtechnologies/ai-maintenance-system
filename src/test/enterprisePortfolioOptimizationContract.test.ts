import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219420000_enterprise_portfolio_optimization.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/enterprisePortfolioOptimizationService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/EnterprisePortfolioOptimizationPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/DevelopmentPortfolioPage.tsx", "utf8");

describe("U11.01 enterprise portfolio optimization contract", () => {
  it("covers every named portfolio category without creating a second project store", () => {
    for (const category of [
      "sustaining_capital",
      "growth_capital",
      "regulatory_capital",
      "reliability",
      "obsolescence",
      "decarbonization",
      "safety_risk",
      "life_extension",
      "modernization",
      "capacity",
      "decommissioning",
    ]) {
      expect(migration).toContain(`'${category}'`);
    }
    expect(migration).toContain("alter table public.capital_plan_items");
    expect(migration).not.toMatch(/create table.*portfolio_(project|risk|approval|work)/i);
  });

  it("requires independent verified evidence and records immutable calculation lineage", () => {
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("verified_by is distinct from auth.uid()");
    expect(migration).toContain("insert into public.calculation_runs");
    expect(migration).toContain("input_refs");
    expect(migration).toContain("computed_with_refusals");
  });

  it("makes uncertainty, timing, budget and mandatory infeasibility explicit", () => {
    for (const field of [
      "cost_low",
      "cost_high",
      "benefit_low",
      "benefit_high",
      "benefit_probability",
      "earliest_start",
      "latest_start",
      "duration_months",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("mandatory candidate exceeds remaining budget — portfolio is infeasible");
    expect(migration).toContain("globallyOptimal',false");
  });

  it("keeps the output recommendation-only and all consequential authority human", () => {
    expect(migration).toContain("insert into public.recommendations");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).toContain("recommendations_portfolio_run_unique");
    expect(migration).toContain("already has a governed recommendation");
    expect(migration).toContain("'pending_human_review'");
    expect(migration).toContain("'fundsCommitted',false");
    expect(migration).toContain("'projectsSanctioned',false");
    expect(migration).toContain("'operationalAuthorization',false");
  });

  it("is customer reachable through the existing development portfolio", () => {
    expect(service).toContain('"get_enterprise_portfolio_workspace"');
    expect(service).toContain('"configure_portfolio_candidate"');
    expect(service).toContain('"run_enterprise_portfolio_optimization"');
    expect(service).toContain('"propose_enterprise_portfolio_plan"');
    expect(panel).toContain("Enterprise portfolio optimization");
    expect(panel).toContain("Not a funding decision");
    expect(page).toContain("<EnterprisePortfolioOptimizationPanel");
  });
});

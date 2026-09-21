import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219460000_develop_portfolio_efficient_frontier.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/enterprisePortfolioOptimizationService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/EnterprisePortfolioOptimizationPanel.tsx",
  "utf8",
);

describe("D10.04 evidence-backed portfolio efficient frontier", () => {
  it("models the exact nine decision dimensions", () => {
    for (const dimension of [
      "regulatory_necessity",
      "safety_risk",
      "production_benefit",
      "reliability",
      "npv",
      "asset_life",
      "sustainability",
      "resource_demand",
      "execution_risk",
    ]) {
      expect(migration).toContain(`'${dimension}'`);
    }
    expect(migration).toContain("exactly the nine governed decision dimensions");
  });

  it("keeps every dimension evidence-backed and named-human controlled", () => {
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("verified_by is distinct from auth.uid()");
    expect(migration).toContain("u.id=auth.uid()");
    expect(migration).toContain("u.role<>'ai_admin'");
    expect(migration).toContain("dimension calibration basis");
  });

  it("records multiple feasible non-dominated portfolios without claiming exhaustive optimality", () => {
    expect(migration).toContain("enterprise_portfolio_frontier");
    expect(migration).toContain("insert into public.calculation_runs");
    expect(migration).toContain("frontierexhaustive',false");
    expect(migration).toContain("globallyoptimal',false");
    expect(migration).toContain("fewer than two distinct non-dominated feasible portfolios");
    expect(migration).toContain("not exists");
  });

  it("reuses canonical candidates, evidence, recommendations and approvals", () => {
    expect(migration).toContain("alter table public.capital_plan_items");
    expect(migration).toContain("public.evidence_items");
    expect(migration).toContain("insert into public.recommendations");
    expect(migration).toContain("insert into public.approvals");
    expect(migration).not.toMatch(/create table[^;]+(project|evidence|recommendation|approval)/);
  });

  it("is reachable in the existing Sync Portfolio surface with a human scenario choice", () => {
    expect(service).toContain('"configure_portfolio_candidate_dimensions"');
    expect(service).toContain('"run_enterprise_portfolio_frontier"');
    expect(service).toContain('"propose_enterprise_portfolio_frontier"');
    expect(panel).toContain("Nine-dimension efficient frontier");
    expect(panel).toContain("Choose this portfolio for human review");
    expect(panel).toContain("No funding, sanction, risk acceptance or work authorization");
  });
});

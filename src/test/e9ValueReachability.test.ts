import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const finance = readFileSync(
  "supabase/migrations/20261115090200_develop_finance_model.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const valuation = readFileSync(
  "src/services/valueGovernanceService.ts",
  "utf8",
);
const panels = readFileSync("src/components/ValueGovernancePanels.tsx", "utf8");
const workspace = readFileSync(
  "src/components/develop/ValueSpinePanels.tsx",
  "utf8",
);
const executive = readFileSync("src/pages/ExecutiveIntelligence.tsx", "utf8");

function body(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf("create or replace function", start + 10);
  return sql.slice(start, next === -1 ? undefined : next);
}

describe("E9 value reachability", () => {
  it("keeps lifecycle cost on the existing business-case option writer", () => {
    const option = body(finance, "add_business_case_option");
    expect(option).toMatch(/security definer/i);
    expect(option).toContain("app_current_org()");
    expect(option).toContain("insert into business_case_options");
    expect(option).toContain("insert into audit_events");
    expect(service).toContain('"add_business_case_option"');
    expect(workspace).toContain("addBusinessCaseOption");
    expect(workspace).toContain("Lifecycle cost — dated cash flows");
    expect(workspace).not.toMatch(
      /from\(\s*["']business_case_options["']\s*\)[\s\S]{0,240}\.(insert|upsert|update|delete)\s*\(/,
    );
  });

  it("prices production loss through the existing financial-assumption writer", () => {
    const assumption = body(finance, "upsert_financial_assumption");
    expect(assumption).toMatch(/security definer/i);
    expect(assumption).toContain("app_current_org()");
    expect(assumption).toContain("insert into financial_assumptions");
    expect(assumption).toContain("insert into audit_events");
    expect(valuation).toContain('"upsert_financial_assumption"');
    expect(valuation).toContain('.from("financial_assumptions")');
    expect(valuation).not.toMatch(/\.(insert|upsert|update|delete)\s*\(/);
    expect(panels).toContain("getProductionLossReconciliation");
    expect(panels).toContain("recordProductionLossUnitValue");
    expect(executive).toContain("<ValueGovernancePanels />");
  });

  it("calls costOfRisk from the executive value surface", () => {
    expect(panels).toContain("costOfRisk(");
    expect(panels).toContain("does not accept the risk");
    expect(panels).not.toContain("supabase.rpc");
  });
});

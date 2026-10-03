import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migrationPath =
  "supabase/migrations/20270101910000_develop_finance_intelligence_completion.sql";
const rawMigration = readFileSync(migrationPath, "utf8");
const migration = stripComments(rawMigration);
const service = readFileSync("src/services/developService.ts", "utf8");
const surface = readFileSync(
  "src/components/develop/ValueSpinePanels.tsx",
  "utf8",
);

function body(source: string, name: string): string {
  const at = source.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("\n$$;", at);
  return source.slice(at, end === -1 ? undefined : end);
}

describe("D2.04 finance intelligence completion", () => {
  it("extends the canonical option family without creating another finance store", () => {
    expect(migration).toContain("alter table public.business_case_options");
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("source_currency");
    expect(migration).toContain("escalation_assumption_key");
    expect(migration).toContain("fx_assumption_key");
    expect(migration).toContain("economic_adjustment_basis");
  });

  it("makes the existing cash-flow shape helper reachable through a trigger", () => {
    const trigger = body(migration, "enforce_business_case_cash_flow_shape");
    expect(trigger).toContain("cash_flows_well_formed(new.cash_flows)");
    expect(trigger).toContain("business_case_options_cash_flows_shape");
    expect(migration).toContain("trg_business_case_cash_flow_shape");
    expect(migration).toContain("before insert or update of cash_flows");
  });

  it("binds only operative typed assumptions with explicit units and conversion direction", () => {
    const configure = body(
      migration,
      "configure_business_case_option_economics",
    );
    expect(configure).toContain("kind = 'escalation'");
    expect(configure).toContain("kind = 'fx'");
    expect(configure).toContain("fraction_per_period");
    expect(configure).toContain("'_per_'");
    expect(configure).toContain("effective_from <= current_date");
    expect(configure).toContain("an exchange rate is never invented");
    expect(configure).toContain("never silently cleared");
  });

  it("keeps the economic binding human, tenant-scoped and audited without granting approval", () => {
    const configure = body(
      migration,
      "configure_business_case_option_economics",
    );
    expect(configure).toContain("organization_id = v_org");
    expect(configure).toContain("AI-operator identity");
    expect(configure).toContain("insert into audit_events");
    expect(configure).toContain("no option approval, sanction, baseline change");
    expect(configure).not.toMatch(/insert into approvals|record_case_gate_review/);
  });

  it("composes canonical finance, EVM, forecast and sanction reads instead of recomputing them", () => {
    const read = body(migration, "get_case_finance_intelligence");
    expect(read).toContain("get_case_finance_model(c.id)");
    expect(read).toContain("get_case_earned_value(c.id)");
    expect(read).toContain("get_case_forecast_confidence(c.id)");
    expect(read).toContain("get_since_sanction_delta(c.id)");
    expect(read).not.toMatch(/power\s*\(\s*1\s*\+/i);
    expect(read).not.toMatch(/\bnpv\s*:=|\birr\s*:=|\bpayback\s*:=/i);
  });

  it("names all and only the thirteen spec I.11 dimensions", () => {
    const read = body(migration, "get_case_finance_intelligence");
    const keys = [
      "capital_cost",
      "operating_cost",
      "lifecycle_cost",
      "npv",
      "irr",
      "payback",
      "cash_flow",
      "escalation",
      "contingency",
      "economic_assumptions",
      "foreign_exchange",
      "commodity_sensitivity",
      "funding_constraints",
    ];
    for (const key of keys) {
      expect(read, `missing dimension ${key}`).toContain(`'key','${key}'`);
    }
    expect(new Set(keys).size).toBe(13);
    expect(read).toContain("'recorded_unbound'");
    expect(read).toContain("'refused'");
    expect(read).toContain("'missing'");
    expect(read).toContain(
      "then to_jsonb('The one value kernel has complete recorded inputs.'::text)",
    );
    expect(read).toContain(
      "else coalesce(v_model->'refusals', '[]'::jsonb) end",
    );
  });

  it("routes the live service and surface through the composed read and pure adjustment kernel", () => {
    expect(service).toContain('supabase.rpc("get_case_finance_intelligence"');
    expect(service).toMatch(
      /supabase\.rpc\(\s*"configure_business_case_option_economics"/,
    );
    expect(surface).toContain("applyEconomicAdjustments");
    expect(surface).toContain("Execution economics");
    expect(surface).toContain("All thirteen finance dimensions");
    expect(surface).toContain("Configure sourced escalation / FX");
  });

  it("adds a live migration smoke to the required CI chain", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const smoke = readFileSync(
      "scripts/ci-develop-finance-intelligence-smoke.sh",
      "utf8",
    );
    expect(ci).toContain("Smoke — thirteen-dimension finance intelligence");
    expect(ci).toContain("ci-develop-finance-intelligence-smoke.sh");
    expect(smoke).toContain("configure_business_case_option_economics");
    expect(smoke).toContain("get_case_finance_intelligence");
    expect(smoke).toContain("dimensions");
    expect(smoke).toContain("cash_flows_well_formed");
  });
});

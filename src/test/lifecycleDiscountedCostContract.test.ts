import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migrationPath =
  "supabase/migrations/20271107120000_lifecycle_discounted_cost_decision.sql";
const raw = readFileSync(migrationPath, "utf8");
const migration = stripComments(raw);
const component = readFileSync("src/components/LifecycleDecisions.tsx", "utf8");
const builder = readFileSync(
  "src/lib/lifecycle/discounted-evaluation.ts",
  "utf8",
);
const kernel = readFileSync("src/lib/lifecycle/discounted-lcc.ts", "utf8");

function body(name: string, until: string) {
  const start = migration.indexOf(`function public.${name}`);
  const end = migration.indexOf(until, start);
  return migration.slice(start, end);
}

describe("C8.09 discounted lifecycle decision contract", () => {
  it("keeps the discount rate in the canonical assumption series and refuses other writers", () => {
    expect(migration).toContain("'lifecycle.real_discount_rate'");
    expect(migration).toContain("insert into financial_assumptions");
    expect(migration).toContain("'discount_rate'");
    expect(migration).toContain("app.lifecycle_discount_writer");
    expect(migration).toContain(
      "The lifecycle discount rate can change only through record_lifecycle_discount_policy",
    );
    expect(migration).not.toMatch(
      /create table(?: if not exists)? (?:public\.)?lifecycle_discount/,
    );
  });

  it("fails closed for AI, non-finance roles, missing MFA and an unowned rate", () => {
    const writer = body(
      "record_lifecycle_discount_policy",
      "revoke all on function public.record_lifecycle_discount_policy",
    );
    expect(writer).toContain("v_role = 'ai_admin'");
    expect(writer).toContain("v_role not in ('executive', 'admin')");
    expect(writer).toContain("app_actor_has_verified_mfa");
    expect(writer).toContain("app_current_aal() <> 'aal2'");
    expect(writer).toContain("public.app_current_org()");
    expect(writer).toContain("auth.uid() is null");
    expect(writer).toContain("sync_is_finite_numeric");
    expect(writer).toContain("length(v_basis) < 15");
    expect(writer).toContain("organization_id = v_org");
    expect(migration).toMatch(
      /revoke all on function public\.record_lifecycle_discount_policy\(numeric, text, text, date, date\)\s+from public, anon/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.record_lifecycle_discount_policy\(numeric, text, text, date, date\)\s+to authenticated/,
    );
  });

  it("binds a recommendation to the current tenant policy and audits both acts", () => {
    const recorder = body(
      "record_lifecycle_evaluation",
      "revoke all on function public.record_lifecycle_evaluation",
    );
    expect(recorder).toContain("public.get_lifecycle_discount_policy()");
    expect(recorder).toContain("organization_id = v_org");
    expect(recorder).toContain(
      "a lifecycle-cost recommendation requires a current governed discount rate",
    );
    expect(recorder).toContain(
      "priced on a different discount policy than the one now in force",
    );
    expect(recorder).toContain("'lifecycle_evaluation'");
    expect(recorder).toContain("'execution', 'none'");
    expect(recorder).toContain("'lifecycle/2-discounted'");

    const decision = body(
      "decide_lifecycle_evaluation",
      "revoke all on function public.decide_lifecycle_evaluation",
    );
    expect(decision).toContain("v_role = 'ai_admin'");
    expect(decision).toMatch(
      /v_role not in \(\s*'maintenance_manager',\s*'reliability_engineer',\s*'executive',\s*'admin'\s*\)/,
    );
    expect(decision).toContain("where id = p_id and organization_id = v_org");
    expect(decision).toContain("'lifecycle_decision'");
    expect(decision).toContain("discount_assumption_id");
    expect(decision).not.toMatch(
      /insert\s+into\s+(?:public\.)?(work_orders|approvals|capital_plan_items|recommendations)\b/,
    );
  });

  it("reaches the discounted kernel from the customer surface and does not call SAP", () => {
    expect(component).toContain("buildDiscountedLifecycleComparison");
    expect(component).toContain('"get_lifecycle_discount_policy"');
    expect(component).toContain('"record_lifecycle_discount_policy"');
    expect(component).toContain('"record_lifecycle_evaluation"');
    expect(component).toContain('"decide_lifecycle_evaluation"');
    expect(builder).toContain("compareLifeCycleOptions");
    expect(builder).toContain("BOK-07");
    expect(kernel).not.toMatch(/supabase|fetch\(|sap/i);
    for (const source of [migration, component, builder]) {
      expect(source.toLowerCase()).not.toContain("sap");
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

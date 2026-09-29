import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const rawMigration = readFileSync(
  "supabase/migrations/20261226090000_value_calculation_lineage.sql",
  "utf8",
);
const migration = stripComments(rawMigration);
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const surface = readFileSync("src/components/ValueManagement.tsx", "utf8");
const service = readFileSync("src/services/valueCalculationService.ts", "utf8");
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-value-calculation-lineage-smoke.sh",
  "utf8",
);
const boundary = JSON.parse(
  readFileSync("config/edge-function-boundary.json", "utf8"),
) as { activeFunctions: string[]; allowedNoVerifyJwt: string[] };

describe("D11.29 value calculation lineage", () => {
  it("extends the one immutable ledger with an explicit canonical subject", () => {
    expect(migration).toContain("alter table public.calculation_runs");
    expect(migration).toContain("add column if not exists subject_type text");
    expect(migration).toContain("add column if not exists subject_ref text");
    expect(migration).toContain("create trigger trg_calculation_run_subject");
    expect(migration).not.toMatch(/create table[^;]+calculation/i);
    expect(migration).not.toMatch(/create table[^;]+lineage/i);
  });

  it("keeps every existing calculation key pinned and adds only recorded value keys", () => {
    for (const key of [
      "case_scope_growth",
      "case_cost_reconciliation",
      "case_earned_value",
      "case_performance_trend",
      "case_progress_integrity",
      "case_estimate_confidence",
      "case_forecast_confidence",
      "case_schedule_quality",
      "case_schedule_simulation",
      "case_risk_schedule_economics",
      "case_contingency_consumption",
      "case_change_control",
      "case_decision_latency",
      "case_decision_debt",
      "case_requirement_traceability",
      "case_design_scorecard",
      "case_ram_profile",
      "case_procurement_position",
      "package_constraint_burndown",
      "package_field_readiness",
      "case_resource_balance",
      "competency_readiness",
      "constraint_free_work_index",
      "workface_execution_metrics",
      "business_case_option_comparison",
      "capital_plan_prioritisation",
    ]) {
      expect(migration).toContain(`('${key}',`);
    }
    expect(edge).toContain('key: "business_case_option_comparison"');
    expect(edge).toContain('key: "capital_plan_prioritisation"');
  });

  it("makes the non-case recorder service-only and tenant-binds actor and subject", () => {
    expect(migration).toContain(
      "if coalesce(auth.role(),'') <> 'service_role'",
    );
    expect(migration).toContain(
      "where id=p_actor_id and organization_id=p_organization_id",
    );
    expect(migration).toContain("b.organization_id=p_organization_id");
    expect(migration).toContain("i.organization_id=p_organization_id");
    expect(rawMigration).toMatch(
      /revoke all on function public\.record_calculation_run\([\s\S]{0,180}from public, anon, authenticated;/,
    );
    expect(rawMigration).toMatch(
      /grant execute on function public\.record_calculation_run\([\s\S]{0,180}to service_role;/,
    );
  });

  it("recomputes from canonical tenant rows with the shared kernels", () => {
    expect(edge).toContain("compareOptions(options, discountRate)");
    expect(edge).toContain("prioritiseUnderBudget(");
    expect(edge).toMatch(/service\s*\.from\("business_cases"\)/);
    expect(edge).toMatch(/service\s*\.from\("business_case_options"\)/);
    expect(edge).toMatch(/service\s*\.from\("capital_plan_items"\)/);
    expect(edge).toContain('.eq("organization_id", organizationId)');
    expect(edge).toContain('service.rpc("record_calculation_run"');
    expect(edge).toContain('typeof value !== "number"');
    expect(edge).toContain('value.trim() === ""');
    expect(edge).not.toContain("body.outputs");
    expect(edge).not.toContain("body.result");
  });

  it("routes the customer surface through the authenticated service and displays run identity", () => {
    expect(surface).toContain("runValueCalculations(appliedBudget)");
    expect(surface).toContain("optionComparisonRunId.slice(0, 8)");
    expect(surface).toContain("capitalPlanRunId.slice(0, 8)");
    expect(surface).toContain("Record scenario");
    expect(surface).toContain("Option comparison limits");
    expect(surface).toContain("Capital-plan limits");
    expect(surface).not.toContain("compareOptions(");
    expect(surface).not.toContain("prioritiseUnderBudget(");
    expect(service).toContain('"calculation-service"');
    expect(service).toContain('action: "value_management"');
  });

  it("deploys the authenticated function through the explicit production allowlist", () => {
    expect(boundary.activeFunctions).toContain("calculation-service");
    expect(boundary.allowedNoVerifyJwt).not.toContain("calculation-service");
    expect(workflow).toContain('"supabase/functions/calculation-service/**"');
    expect(workflow).toContain('"src/lib/value/**"');
    expect(workflow).toContain("supabase functions deploy calculation-service");
    expect(workflow).toContain("functions/v1/calculation-service");
    expect(workflow).toContain(
      "Calculation Service is deployed and JWT-protected",
    );
    expect(workflow).not.toContain(
      "supabase functions deploy calculation-service --no-verify-jwt",
    );
  });

  it("proves the authenticated runtime, tenant wall and no-authority boundary on the full chain", () => {
    expect(ciWorkflow).toContain(
      "bash scripts/ci-value-calculation-lineage-smoke.sh",
    );
    expect(smoke).toContain("functions/v1/calculation-service");
    expect(smoke).toContain("INVALID_BUDGET");
    expect(smoke).toContain("BEFORE + 2");
    expect(smoke).toContain("approvals_created=0");
    expect(smoke).toContain("CLIENT_RECORD");
    expect(smoke).toContain("FOREIGN");
  });

  it("keeps every value answer advisory and human-final", () => {
    expect(edge).toContain("operationalAuthorization: false");
    expect(edge).toContain("humanApprovalRequired: true");
    expect(edge).toContain("do not approve a business case");
    expect(migration).not.toMatch(/insert into public\.approvals/i);
    expect(migration).not.toMatch(/update public\.business_cases/i);
    expect(migration).not.toMatch(/update public\.capital_plan_items/i);
  });
});

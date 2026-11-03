import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271108161500_pm_policy_optimization.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const service = readFileSync(
  "src/services/pmPolicyOptimizationService.ts",
  "utf8",
);
const panel = readFileSync("src/components/PmPolicyOptimization.tsx", "utf8");
const page = readFileSync("src/pages/IntervalDecisionsPage.tsx", "utf8");

describe("C7.08 preventive-maintenance policy optimization", () => {
  it("reuses canonical life events and maintenance-plan costs", () => {
    expect(migration).toContain("public.component_life_events");
    expect(migration).toContain("public.maintenance_plans");
    expect(migration).toContain("public.component_instances");
    expect(migration).toContain("public.asset_meter_readings");
    expect(migration).not.toContain("public.asset_economics");
    expect(migration).not.toContain(
      "create table if not exists public.maintenance_plans",
    );
    expect(migration).not.toContain("weibull");
    expect(edge).toContain('body.action === "pm_policy"');
    expect(edge).toContain("optimizePmPolicies(components, access)");
    expect(edge).toContain("selectWeibullMethod(failureHours, censoredHours)");
  });

  it("keeps the calculation out of the browser and the interval write behind review", () => {
    expect(service).toContain('"calculation-service"');
    expect(service).toContain('action: "pm_policy"');
    expect(service).toContain('"get_pm_policy_workspace"');
    expect(service).toContain('"record_pm_grouping_basis"');
    expect(service).toContain('"assign_pm_policy_review"');
    expect(service).toContain('"adopt_pm_policy_assessment"');
    expect(panel).not.toContain("optimizePmPolicies");
    expect(panel).not.toContain("optimalBlockReplacement");
    expect(page).toContain("<PmPolicyOptimization");
    expect(migration).toContain("segregation of duties requires adoption");
    expect(migration).toContain(
      "this named human is not assigned to review the assessment",
    );
    expect(migration).toContain("maintenance plan changed after assessment");
    expect(migration).toContain("change_pm_interval");
    expect(migration).toContain(
      "d.required_authority = 'reliability_engineer'",
    );
    expect(migration).toContain(
      "safety or regulatory applicability is true or unknown",
    );
    expect(migration).toContain(
      "from public.assets a\n  where a.id = s.asset_id and a.organization_id = v_org for update",
    );
  });

  it("is tenant scoped, append-only and audited", () => {
    for (const table of [
      "public.pm_grouping_bases",
      "public.pm_policy_assessments",
      "public.pm_policy_review_assignments",
      "public.pm_policy_adoptions",
    ]) {
      expect(migration).toContain(
        `alter table ${table} enable row level security`,
      );
      expect(migration).toContain(`organization_id = public.app_current_org()`);
    }
    expect(migration).toContain(
      "PM policy bases, assessments, reviews and adoptions are append-only",
    );
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'pm_policy_assessment'");
    expect(migration).toContain("'pm_grouping_basis'");
    expect(migration).toContain("'pm_policy_adoption'");
    expect(migration).toContain(
      "revoke all on function public.record_pm_policy_assessment",
    );
    expect(migration).toContain("to service_role");
    expect(migration).toContain(
      "grant execute on function public.get_pm_policy_workspace() to authenticated",
    );
    expect(migration).toContain("app.pm_policy_record_write");
    expect(migration).not.toContain("may_change_pm_interval', true");
    expect(migration).toContain("'may_change_pm_interval', false");
  });
});

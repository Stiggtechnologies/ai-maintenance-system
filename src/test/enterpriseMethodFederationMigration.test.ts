import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219180000_enterprise_method_federation.sql",
  "utf8",
).toLowerCase();
const page = readFileSync("src/pages/DecisionGovernance.tsx", "utf8");
const component = readFileSync(
  "src/components/EnterpriseMethodFederation.tsx",
  "utf8",
);

describe("C9.06 enterprise method federation contract", () => {
  it("extends the canonical standard, variance, site and job-plan models", () => {
    expect(migration).toContain("alter table public.governance_standards");
    expect(migration).toContain("references public.governance_standards");
    expect(migration).toContain("references public.sites");
    expect(migration).toContain("references public.job_plans");
    expect(migration).toContain("references public.standard_site_variances");
    expect(migration).not.toContain("create table public.enterprise_standards");
    expect(migration).not.toContain("create table public.site_variances");
    expect(migration).not.toContain("create table public.job_plan_templates");
  });

  it("makes central adoption and site adoption named-human acts", () => {
    expect(migration).toContain("adopt_enterprise_reliability_method");
    expect(migration).toContain("adopt_site_standard_strategy");
    expect(migration).toContain(
      "the ai-operator identity cannot adopt an enterprise method",
    );
    expect(migration).toContain(
      "the ai-operator identity cannot adopt a site strategy",
    );
    expect(migration).toContain("adopted_by=auth.uid()");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("fails closed when a local strategy departs from the standard", () => {
    expect(migration).toContain(
      "a non-conforming site strategy requires an approved variance",
    );
    expect(migration).toContain(
      "the variance does not cover this standard and site",
    );
    expect(migration).toContain(
      "v.status <> 'approved' or v.expires_at <= now()",
    );
    expect(migration).toContain(
      "an aligned strategy cannot claim variance coverage",
    );
    expect(migration).toContain(
      "a site strategy cannot rely on a non-adopted job plan",
    );
    expect(migration).toContain(
      "cover.status='approved' and cover.expires_at>now()",
    );
    expect(migration).toContain("'blocked_site_strategies'");
    expect(migration).toContain("enterprise method applies");
    expect(migration).toContain("idx_one_adopted_site_standard_strategy");
    expect(migration).toContain("and status='adopted'");
  });

  it("enforces tenant-scoped read access and guarded RPC writes", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("organization_id = public.app_current_org()");
    expect(migration).toContain(
      "revoke all on function public.author_site_standard_strategy(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.get_enterprise_method_federation() to authenticated",
    );
    expect(migration).toContain(
      "standard, site and strategy must belong to the same organization",
    );
  });

  it("resolves enterprise inheritance without changing operational authority", () => {
    expect(migration).toContain("'enterprise_standard' else 'site_strategy'");
    expect(migration).toContain(
      "an adopted enterprise method applies until a site strategy is adopted",
    );
    expect(migration).toContain("cannot approve or release work");
    expect(component).toContain("not permission to execute");
  });

  it("is customer reachable from Decision Governance", () => {
    expect(page).toContain("import { EnterpriseMethodFederation }");
    expect(page).toContain("<EnterpriseMethodFederation />");
    expect(component).toContain('aria-label="Author enterprise method"');
    expect(component).toContain('aria-label="Author site strategy"');
    expect(component).toContain('aria-label="Adoption review"');
  });
});

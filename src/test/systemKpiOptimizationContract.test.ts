import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20271111120000_system_kpi_optimization.sql",
  "utf8",
);

describe("system KPI optimization contract", () => {
  it("reuses the catalog, recommendation subject and audit log", () => {
    expect(sql).toContain("references public.kpi_catalog(kpi_key)");
    expect(sql).toContain(
      "references public.recommendations(id) on delete restrict",
    );
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("system_kpi_optimization_proposed");
    expect(sql).toContain("system_kpi_optimization_decided");
    expect(sql).not.toMatch(/insert\s+into\s+public\.work_orders/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.approvals/i);
    expect(sql).not.toMatch(/update\s+public\.recommendations/i);
    expect(sql).not.toMatch(/weighted_score|objective_weight/i);
  });

  it("is tenant scoped, revoked from direct clients, and refuses the AI operator", () => {
    for (const table of [
      "system_kpi_optimizations",
      "system_kpi_optimization_effects",
    ]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `on public.${table} for select to authenticated\n  using (organization_id = public.app_current_org())`,
      );
      expect(sql).toContain(
        `revoke all on table public.${table} from public, anon, authenticated`,
      );
      expect(sql).toContain(
        `grant select on table public.${table} to authenticated`,
      );
    }
    const policies = sql.match(/create policy[\s\S]*?;/g) ?? [];
    expect(policies).toHaveLength(2);
    for (const policy of policies) {
      expect(policy).toMatch(/for select to authenticated/i);
      expect(policy).not.toMatch(/for\s+(all|insert|update|delete)/i);
    }
    expect(sql).toContain("v_org uuid := public.app_current_org()");
    expect(sql).toContain("recommendation is not in this organization");
    expect(sql).toContain("optimization not found in this organization");
    expect(sql).toContain("ai_admin cannot propose a system KPI optimization");
    expect(sql).toContain("ai_admin cannot decide a system KPI optimization");
    expect(sql).toContain(
      "revoke all on function public.propose_system_kpi_optimization(text, text, jsonb, uuid)",
    );
    expect(sql).toContain(
      "grant execute on function public.propose_system_kpi_optimization(text, text, jsonb, uuid)",
    );
  });

  it("refuses a single KPI, keeps effects unnetted, and separates the decision", () => {
    expect(sql).toContain("single-KPI optimization refused");
    expect(sql).toContain(
      "single-KPI optimization refused: record an effect for every other KPI catalog page",
    );
    expect(sql).toContain("effects are not overwritten or netted");
    expect(sql).toContain("unknown is labeled, not invented");
    expect(sql).toContain(
      "the proposer cannot decide their own system assessment",
    );
    expect(sql).toContain("a decided system KPI optimization is immutable");
    expect(sql).toContain(
      "a worsening safety or risk KPI requires a substantive escalation note",
    );
    expect(sql).toContain(
      "accepting a worsening safety or risk KPI requires an executive or administrator",
    );
    expect(sql).toContain("'authority', 'assessment_only'");
    expect(sql).toContain("'operationalAuthorization', false");
  });
});

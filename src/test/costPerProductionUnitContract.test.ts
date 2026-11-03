/**
 * C6.03 — the enterprise cost-per-unit reader must not publish a partial or
 * double-counted ratio, and only a named human may append the KPI fact.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271108180000_cost_per_production_unit.sql",
  "utf8",
);

function body(name: string): string {
  const match = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\$cost\\$([\\s\\S]*?)\\$cost\\$`,
    ),
  );
  expect(match, name).not.toBeNull();
  return match?.[1] ?? "";
}

describe("C6.03 cost per production unit", () => {
  const reader = body("get_cost_per_production_unit");
  const publisher = body("publish_maintenance_cost_per_unit");

  it("stays inside the caller organization and refuses an unbound session", () => {
    expect(reader).toContain("auth.uid() is null");
    expect(reader).toContain("public.app_current_org()");
    expect(reader).toContain("pr.organization_id = v_org");
    expect(reader).toContain("a.organization_id = v_org");
    expect(reader).toContain("e.organization_id = v_org");
    expect(reader).not.toMatch(/p_org|p_organization/);
  });

  it("refuses the figures that would flatter or invent a ratio", () => {
    expect(reader).toContain("count(distinct unit_of_measure)");
    expect(reader).toContain("mixed units would be meaningless");
    expect(reader).toContain("asset_id is null");
    expect(reader).toContain("site total with no asset");
    expect(reader).toContain("review_due < current_date");
    expect(reader).toContain("partial numerator understates the ratio");
    expect(reader).toContain("class snapshot is not spread across members");
    expect(reader).not.toContain("e.asset_id is null and e.asset_class");
    expect(reader).toContain("e.asset_id = a.id");
  });

  it("prorates stated annual cost and does not treat that as captured spend", () => {
    expect(reader).toContain("v_annual * (v_days / 365.0)");
    expect(reader).toContain("stated_annual_maintenance_cost_prorated");
    expect(reader).toContain("not captured work-order or ERP spend");
    expect(reader).toContain("'class_cost_used', false");
  });

  it("publishes only an available figure, without assessing a target", () => {
    expect(publisher).toContain("public.get_cost_per_production_unit");
    expect(publisher).toContain("v_role = 'ai_admin'");
    expect(publisher).toContain(
      "v_role not in ('admin', 'executive', 'maintenance_manager')",
    );
    expect(publisher).toContain("insert into public.kpi_values");
    expect(publisher).toContain("'not_assessed'");
    expect(publisher).toContain("insert into public.audit_events");
    expect(publisher).toContain("'publication_refused'");
    const publishAt = publisher.indexOf("insert into public.kpi_values");
    const refuseAt = publisher.indexOf(
      "coalesce((v_figure->>'available')::boolean, false) is not true",
    );
    expect(refuseAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(refuseAt);
    expect(publisher).toContain("'expenditureAuthorized', false");
    expect(publisher).not.toContain("on_target");
  });

  it("revokes the definer doors from public and anon", () => {
    expect(migration).toContain(
      "revoke all on function public.get_cost_per_production_unit(int) from public, anon",
    );
    expect(migration).toContain(
      "revoke all on function public.publish_maintenance_cost_per_unit(int) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.get_cost_per_production_unit(int) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.publish_maintenance_cost_per_unit(int) to authenticated",
    );
  });

  it("keeps the canonical KPI key and does not mark the hourly job as its computer", () => {
    expect(migration).toContain("where kpi_key = 'maintenance_cost_per_unit'");
    expect(migration).toContain("computable = false");
    expect(migration).not.toMatch(/create table/i);
  });
});

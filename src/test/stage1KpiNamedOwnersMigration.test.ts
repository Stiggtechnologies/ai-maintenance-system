import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/20261219120000_stage1_kpi_named_owners.sql";
const sql = readFileSync(FILE, "utf8");

describe("Stage-1 KPI named owners (Item 5)", () => {
  it("extends raci_assignments and the ISO 55000 catalog — no parallel store", () => {
    expect(sql).toContain("alter table public.raci_assignments");
    expect(sql).toContain("decision_type like 'iso55000_kpi:%'");
    expect(sql).toContain("from kpi_catalog");
    expect(sql).not.toMatch(/create table\s+.*kpi_named/);
    expect(sql).not.toMatch(/create table\s+.*kpi_owner/);
    expect(sql).toContain("insert into audit_events");
  });

  it("binds writes to the caller org and refuses AI adoption", () => {
    expect(sql).toContain("v_org uuid := app_current_org()");
    expect(sql).toContain("if auth.uid() is null");
    expect(sql).toContain("if coalesce(v_role, '') = 'ai_admin'");
    expect(sql).toContain("name_kpi_owner");
    expect(sql).toContain("get_kpi_named_owners");
    expect(sql).not.toMatch(/p_organization_id|p_org\b/);
  });

  it("refuses direct client writes of KPI-prefixed RACI rows", () => {
    expect(sql).toContain("enforce_kpi_named_owner_wall");
    expect(sql).toContain("sync.stage1_kpi_owner_write");
    expect(sql).toContain("trg_kpi_named_owner_wall");
    expect(sql).toContain(
      "ISO 55000 KPI named owners are written only through name_kpi_owner",
    );
  });

  it("grants only authenticated and revokes broader roles", () => {
    expect(sql).toMatch(
      /revoke all on function public\.name_kpi_owner\(text, text, text, text\)\s+from public, anon, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.name_kpi_owner\(text, text, text, text\)\s+to authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.get_kpi_named_owners\(\)\s+from public, anon, service_role/,
    );
  });
});

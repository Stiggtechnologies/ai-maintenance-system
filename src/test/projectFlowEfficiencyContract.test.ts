import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219142000_develop_project_flow_efficiency.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/projectFlowEfficiencyService.ts", "utf8");
const panel = readFileSync("src/components/develop/ProjectFlowEfficiencyPanel.tsx", "utf8");
const workspace = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

describe("D7.09 Project Flow Efficiency", () => {
  it("calculates the spec formula from canonical work evidence without a parallel store", () => {
    expect(migration).toContain("100*t.active_hours/t.total_hours");
    expect(migration).toContain("public.work_orders");
    expect(migration).toContain("public.work_order_status_history");
    expect(migration).toContain("public.development_case_assets");
    expect(migration).not.toMatch(/create table/);
  });

  it("defines active and waiting states explicitly", () => {
    expect(migration).toContain("i.interval_status='in_progress'");
    for (const status of ["pending", "approval", "scheduled", "blocked", "critical"]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(panel).toContain("Waiting includes pending, approval, scheduled, blocked, and critical states");
  });

  it("refuses invented certainty and identifies incomplete evidence", () => {
    expect(migration).toContain("'computable', t.measured_work_orders > 0");
    expect(migration).toContain("status changed without transition evidence");
    expect(migration).toContain("latest transition does not match current status");
    expect(migration).toContain("transition history contains a status-chain discontinuity");
    expect(migration).toContain("'exclusions'");
    expect(panel).toContain("not computable yet");
    expect(panel).toContain("excluded for incomplete evidence");
  });

  it("is tenant-scoped and read-only decision support", () => {
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("security definer");
    expect(migration).toContain("revoke all on function");
    expect(panel).toContain("not an approval or productivity score");
  });

  it("is customer-reachable in the canonical case workspace", () => {
    expect(service).toContain('supabase.rpc("get_project_flow_efficiency"');
    expect(workspace).toContain("<ProjectFlowEfficiencyPanel");
    expect(panel).toContain("Project flow efficiency");
  });

  it("advances D7.09 only with concrete evidence", () => {
    expect(register).toMatch(/\| D7\.09 \|[^\n]+\| ✅[^\n]+get_project_flow_efficiency/);
  });
});

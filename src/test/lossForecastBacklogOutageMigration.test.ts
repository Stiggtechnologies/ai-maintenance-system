import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219170000_loss_forecasting_backlog_outage_optimization.sql",
  "utf8",
);
const component = readFileSync("src/components/MaintenanceOptimization.tsx", "utf8");
const outage = readFileSync("src/components/OutagePlanning.tsx", "utf8");
const page = readFileSync("src/pages/TurnaroundsPage.tsx", "utf8");
const shell = readFileSync("src/components/AppShell.tsx", "utf8");
const search = readFileSync("src/components/CommandSearch.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync("scripts/ci-loss-forecast-backlog-outage-smoke.sh", "utf8");

describe("C9.05 loss, backlog and outage optimization contract", () => {
  it("persists one tenant-scoped governed planning run", () => {
    expect(migration).toContain("create table if not exists public.maintenance_optimization_runs");
    expect(migration).toContain("organization_id uuid not null");
    expect(migration).toContain("generated_by uuid not null");
    expect(migration).toContain("status text not null default 'draft'");
    expect(migration).toContain("organization_id = public.app_current_org()");
  });

  it("uses demonstrated history and refuses weak or conflicting forecast evidence", () => {
    expect(migration).toContain("from public.operating_states s");
    expect(migration).toContain("from public.production_records p");
    expect(migration).toContain("x.coverage<0.25");
    expect(migration).toContain("coalesce(x.records,0)<2");
    expect(migration).toContain("coalesce(x.unit_count,0)<>1");
    expect(migration).toContain("x.unplanned_events<2");
    expect(migration).toContain("Not nameplate");
  });

  it("does not disguise a priority proxy as governed risk", () => {
    expect(migration).toContain("linked_iso31000_risk");
    expect(migration).toContain("priority_criticality_proxy_not_a_risk_score");
    expect(migration).toContain("left join public.risks r");
  });

  it("keeps outage optimization constrained and recommendation-only", () => {
    expect(migration).toContain("from public.outage_windows w");
    expect(migration).toContain("from public.work_order_materials m");
    expect(migration).toContain("from public.approvals ap");
    expect(migration).toContain("rs.requires_gatekeeper");
    expect(migration).toContain("candidate options only; no scope release");
    expect(migration).not.toContain("insert into public.outage_work");
    const createWindow = migration.slice(
      migration.indexOf("function public.create_outage_window("),
      migration.indexOf("function public.generate_maintenance_optimization_run("),
    );
    expect(createWindow).not.toContain("'ai_admin'");
  });

  it("is authenticated-only and customer-reachable with a runtime gate", () => {
    expect(migration.match(/from public, anon/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(3);
    expect(component).toContain('"generate_maintenance_optimization_run"');
    expect(component).toContain('"get_latest_maintenance_optimization_run"');
    expect(outage).toContain('"create_outage_window"');
    expect(page).toContain("<MaintenanceOptimization />");
    expect(shell).toContain('path: "/turnarounds"');
    expect(search).toContain('path: "/turnarounds"');
    expect(workflow).toContain("bash scripts/ci-loss-forecast-backlog-outage-smoke.sh");
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("no_auto_release=true");
  });
});

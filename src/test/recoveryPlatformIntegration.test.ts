import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260921120000_recovery_platform_context.sql";
const sql = readFileSync(MIGRATION, "utf8");
const lower = sql.toLowerCase().replace(/\s+/g, " ");
const service = readFileSync(
  "src/services/recoveryPlatformContextService.ts",
  "utf8",
);
const panel = readFileSync("src/components/RecoveryContextPanel.tsx", "utf8");
const wrapper = readFileSync("src/components/RecoveryAwarePage.tsx", "utf8");
const docs = readFileSync(
  "docs/sync-recovery/platform-integration.md",
  "utf8",
);

function functionBody(name: string): string {
  const start = lower.indexOf(`function public.${name.toLowerCase()}(`);
  expect(start, `${name} function not found`).toBeGreaterThan(-1);
  const next = lower.indexOf("create or replace function", start + 20);
  return lower.slice(start, next === -1 ? lower.length : next);
}

describe("Recovery platform context preserves canonical ownership", () => {
  it("adds no parallel operational store", () => {
    expect(lower).not.toContain("create table");
    const context = functionBody("get_recovery_platform_context");
    for (const canonical of [
      "from restoration_events",
      "restoration_event_work",
      "work_orders",
      "work_order_materials",
      "equipment_releases",
      "restoration_plan_versions",
      "restoration_blockers",
    ]) {
      expect(context).toContain(canonical);
    }
  });

  it("keeps the shared read contract tenant scoped and non-anonymous", () => {
    const context = functionBody("get_recovery_platform_context");
    expect(context).toContain("v_org uuid := public.app_current_org()");
    expect(context).toContain("organization_id = v_org");
    expect(lower).toContain(
      "revoke all on function public.get_recovery_platform_context(text,uuid,uuid) from public, anon",
    );
    expect(lower).toContain(
      "revoke all on function public.get_sync_recovery_context(uuid,uuid) from public, anon",
    );
  });

  it("exposes Sync through the same Recovery context instead of a parallel assistant store", () => {
    const sync = functionBody("get_sync_recovery_context");
    expect(sync).toContain("public.get_recovery_platform_context");
    expect(sync).toContain("'sync'");
    expect(docs).toContain("platform-wide **Sync** interaction layer");
    expect(service).toContain('"get_recovery_platform_context"');
    expect(`${sql}\n${service}\n${panel}\n${wrapper}`).not.toMatch(/JARVIS/i);
  });

  it("never fabricates material RTS consequence", () => {
    const context = functionBody("get_recovery_platform_context");
    expect(context).toContain("forecast_rts_impact_hours is not null");
    expect(panel).toContain('RTS impact: {impact.recorded_rts_impact_hours == null ? "not quantified"');
  });
});

describe("weekly scheduling acknowledges Recovery without becoming a second solver", () => {
  it("adds active Recovery commitments as a soft feasibility warning", () => {
    const feasibility = functionBody("evaluate_schedule_feasibility");
    expect(feasibility).toContain("'active recovery commitments'");
    expect(feasibility).toContain("'severity', 'warning'");
    expect(feasibility).toContain("v_recovery_omitted");
    expect(feasibility).toContain(
      "recovery event plan remains authoritative for restoration sequence and execution",
    );
  });

  it("does not let Recovery rewrite weekly schedule options", () => {
    const context = functionBody("get_recovery_platform_context");
    expect(context).not.toContain("insert into schedule_options");
    expect(context).not.toContain("update schedule_options");
    expect(context).not.toContain("delete from schedule_options");
  });
});

describe("cross-module UI is context, not authority", () => {
  it("links users back to Sync Recovery and fails without a shadow write path", () => {
    expect(panel).toContain('navigate("/recovery")');
    expect(panel).toContain("no fallback write path is used");
    expect(wrapper).toContain("RecoveryContextPanel");
  });

  it("states the module ownership boundary in the product surface", () => {
    expect(panel).toContain(
      "this module remains the authority for its own operational truth",
    );
    expect(docs).toContain("No Sync-only execution shortcut");
  });
});

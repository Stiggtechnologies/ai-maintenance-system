/**
 * C6.11, C6.15 and C8.08 — the work-health cards and the weekly/outage
 * placement must say what they measure, and must not invent the missing
 * sample or a crew.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271105120000_ready_backlog_wait_material_constrained_schedule.sql",
  "utf8",
);

function body(name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, name).toBeGreaterThan(-1);
  const next = migration.indexOf(
    "\ncreate or replace function ",
    start + marker.length,
  );
  const end = next === -1 ? migration.length : next;
  return migration.slice(start, end);
}

describe("C6.11 ready backlog", () => {
  const health = body("get_work_management_health");

  it("measures stock-backed human acts and withholds an empty sample", () => {
    expect(health).not.toContain("parts_ready");
    expect(health).toContain("from public.material_stock s");
    expect(health).toContain("e.actor is not null");
    expect(health).toContain(
      "'reserved', 'kitted', 'issued', 'shortage_declared'",
    );
    expect(health).toContain("'available', v_assessable > 0");
    expect(health).toContain("then round(100.0 * v_ready / v_assessable, 1)");
    expect(health).toContain("This is not 0%% and not 100%%");
    expect(health).toContain("no stock record");
  });

  it("keeps the previous health function internal", () => {
    expect(migration).toContain("rename to get_work_management_health_base4");
    expect(migration).toContain(
      "revoke all on function public.get_work_management_health_base4(int)",
    );
  });
});

describe("C6.15 waiting-on-material time", () => {
  const health = body("get_work_management_health");

  it("keeps the platform event stream separate from source-system delays", () => {
    expect(health).toContain("'key', 'waiting_on_material'");
    expect(health).toContain("'key', 'waiting_on_material_source_delay'");
    expect(health).toContain("from public.material_events");
    expect(health).toContain("event_type in ('reserved', 'kitted', 'issued')");
    expect(health).toContain("from public.operating_states s");
    expect(health).toContain("label_kind = 'delay_reason'");
    expect(health).toContain("s.reason_code ~* '(wait|waiting|await)'");
    expect(health).toContain("s.reason_code ~* '(part|material|spare|stores)'");
    expect(health).toContain("not added to the platform mean");
    expect(health).toContain("they are not invented here");
  });
});

describe("C8.08 constrained weekly and outage placement", () => {
  const weekly = body("generate_schedule_options");
  const outage = body("propose_constrained_outage_schedule");
  const production = body("schedule_work_production_states");

  it("places weekly work inside the existing constraint doors", () => {
    expect(weekly).toContain("public.schedule_work_production_states");
    expect(weekly).toContain("public.sync_resource_capacity_hours");
    expect(weekly).toContain("public.sync_portfolio_resource_conflicts");
    expect(weekly).toContain("'safety_gate'");
    expect(weekly).toContain("'approval_outstanding'");
    expect(weekly).toContain("'material_no_demand'");
    expect(weekly).toContain("'material_unassessable'");
    expect(weekly).toContain("'material_short'");
    expect(weekly).toContain("'committed_to_outage'");
    expect(weekly).toContain("'production_unavailable'");
    expect(weekly).toContain("'labour_not_assessable'");
    expect(weekly).toContain("'skilled_trades'");
    expect(weekly).not.toContain("coalesce(w.estimated_hours, 4)");
    expect(weekly).not.toContain("default 24");
    expect(weekly).toContain("p_capacity_hours_per_day numeric default null");
    expect(weekly).not.toContain("insert into public.outage_work");
    expect(weekly).toContain("and status = 'released'");
    expect(weekly).not.toContain("set status = 'released'");
    expect(weekly).toContain("refuses the AI-operator identity by name");
  });

  it("does not treat a missing production week as clearance", () => {
    expect(production).toContain("public.schedule_production_window_check");
    expect(production).toContain("to_jsonb('unseen'::text)");
    expect(production).toContain("v_cur = 'unseen'");
    expect(production).toContain(
      "A week that omits a work order is not a clearance.",
    );
    expect(migration).toMatch(
      /revoke all on function public\.schedule_work_production_states\(uuid\[\], timestamptz, timestamptz\)[\s\S]*?authenticated, service_role/,
    );
  });

  it("proposes an outage sequence without writing scope or releasing it", () => {
    expect(outage).toContain("public.evaluate_turnaround_readiness");
    expect(outage).toContain("public.shutdown_task_dependencies");
    expect(outage).toContain("public.sync_resource_capacity_hours");
    expect(outage).toContain("public.schedule_work_production_states");
    expect(outage).toContain("'production_not_assessable'");
    expect(outage).toContain("No dependency was invented.");
    expect(outage).not.toMatch(/insert\s+into/i);
    expect(outage).not.toMatch(/update\s+public/i);
    expect(outage).not.toMatch(/delete\s+from/i);
    expect(outage).toContain(
      "This does not add work, freeze scope, release execution",
    );
    expect(migration).toMatch(
      /revoke all on function public\.propose_constrained_outage_schedule\(uuid\)[\s\S]*?service_role/,
    );
    expect(migration).toContain(
      "grant execute on function public.propose_constrained_outage_schedule(uuid)",
    );
  });
});

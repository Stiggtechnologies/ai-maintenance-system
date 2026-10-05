import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20270102360000_schedule_production_window_feasibility.sql",
  ),
  "utf8",
);

describe("C8.08 production-window schedule feasibility contract", () => {
  it("extends the one schedule door over the canonical operating-context feed", () => {
    expect(migration).toContain(
      "create or replace function public.evaluate_schedule_feasibility",
    );
    expect(migration).toMatch(
      /join public\.operational_constraint_signals s/,
    );
    expect(migration).toContain("s.signal_kind = 'production'");
    expect(migration).toContain("from public.work_orders w");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(?:production_window|schedule_constraint)/i,
    );
  });

  it("preserves tenant and exact scheduled-work boundaries", () => {
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(migration).toContain("w.organization_id = v_org");
    expect(migration).toContain("s.organization_id = v_org");
    expect(migration).toContain("o.organization_id = v_org");
    expect(migration).toContain("w.id = any");
  });

  it("uses asset then site then organization evidence specificity", () => {
    expect(migration).toContain("s.asset_id = sw.asset_id then 2");
    expect(migration).toContain("s.site_id = sw.site_id then 1");
    expect(migration).toContain(
      "order by c.scope_rank desc, c.observed_at desc, c.signal_id desc",
    );
    expect(migration).toContain(
      "partition by c.work_order_id, c.signal_key",
    );
  });

  it("never promotes missing, unknown, stale or partial evidence to a pass", () => {
    expect(migration).toContain(
      "x.observed_at <= v_window_start and x.valid_until >= v_window_end",
    );
    expect(migration).toContain(
      "s.signal_state = 'unavailable' and s.overlaps_week",
    );
    expect(migration).toContain(
      "when count(s.signal_id) = 0 then 'not_assessable'",
    );
    expect(migration).toContain(
      "when bool_and(s.signal_state = 'available' and s.covers_week)",
    );
    expect(migration).toContain(
      "Missing, unknown, stale and partial-window evidence are neither a conflict nor a clearance.",
    );
  });

  it("keeps the production decision advisory and human-acknowledged", () => {
    expect(migration).toContain("'mayReleaseSchedule', false");
    expect(migration).toContain(
      "'mayApproveProductionInterruption', false",
    );
    expect(migration).toContain(
      "'requiresHumanWarningAcknowledgement', true",
    );
    expect(migration).toContain(
      "and not p_acknowledge_warnings",
    );
    expect(migration).toContain(
      "grant execute on function public.release_schedule_option(uuid, boolean)",
    );
    expect(migration).toMatch(
      /revoke all on function public\.release_schedule_option\(uuid\)[\s\S]*?authenticated, service_role/,
    );
  });

  it("prevents callers from bypassing the composed production arm", () => {
    expect(migration).toContain(
      "rename to evaluate_schedule_feasibility_core_20261212",
    );
    expect(migration).toMatch(
      /revoke all on function public\.evaluate_schedule_feasibility_core_20261212\(uuid\)[\s\S]*?authenticated, service_role/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.schedule_production_window_check\(uuid\[\], date\)[\s\S]*?authenticated, service_role/,
    );
    expect(migration).toContain(
      "where c.value->>'constraint' <> 'Production window'",
    );
  });
});

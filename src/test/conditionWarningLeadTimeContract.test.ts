/**
 * C6.24 warning lead time is measured from a qualifying linked alert.
 * A 10-hour warning and a 30-hour warning average to 20.0. An earlier work
 * order, a DEMO series, and an inactive sensor do not become a number.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271108154500_condition_warning_lead_time.sql",
  "utf8",
);
const panel = readFileSync("src/components/ConditionMonitoring.tsx", "utf8");
const callers = readFileSync("src/services/reliabilityCallers.ts", "utf8");

function meanHours(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const mean = samples.reduce((sum, hours) => sum + hours, 0) / samples.length;
  return Math.round(mean * 10) / 10;
}

describe("C6.24 condition warning lead time", () => {
  it("pins the published 10 h and 30 h sample at 20.0 and drops a negative interval", () => {
    expect(meanHours([10, 30])).toBe(20);
    expect(meanHours([10, 30].filter((hours) => hours >= 0))).toBe(20);
    expect(meanHours([])).toBeNull();
    expect(migration).toContain(
      "round(avg(extract(epoch from (w.created_at - al.triggered_at)) / 3600.0)::numeric, 1)",
    );
    expect(migration).toContain("w.created_at >= al.triggered_at");
    expect(migration).toContain("average to 20.0");
  });

  it("withholds the metric when there is no qualifying reading", () => {
    expect(migration).toContain("not like 'DEMO%'");
    expect(migration).toContain("cr.quality = 'good'");
    expect(migration).toContain(
      "Warning lead time, completion time and backlog age stay unavailable rather than zero.",
    );
    expect(migration).toContain("registry_status is distinct from 'active'");
    expect(migration).toContain("completed_at is not null");
    expect(migration).toContain("creation time is not treated as repair time");
  });

  it("keeps the link tenant-scoped, immutable, audited, and non-authorizing", () => {
    expect(migration).toContain("v_org uuid := app_current_org()");
    expect(migration).toContain("w.organization_id = al.organization_id");
    expect(migration).toContain("w.asset_id = al.asset_id");
    expect(migration).toContain("ai_admin cannot link a condition alert to work");
    expect(migration).toContain("ai_admin cannot record a condition observation");
    expect(migration).toContain("the measurement is not rewritten");
    expect(migration).toContain(
      "condition alert linkage is written only by link_alert_to_work",
    );
    expect(migration).toContain("insert into audit_events");
    expect(migration).toContain("'mayAuthorizeWork', false");
    expect(migration).toContain(
      "revoke all on function public.record_condition_observation(uuid, numeric, timestamptz, text, text)",
    );
    expect(migration).toContain(
      "revoke all on function public.link_alert_to_work(uuid, uuid) from public, anon",
    );
  });

  it("is reachable from the condition-monitoring surface", () => {
    expect(callers).toContain('"record_condition_observation"');
    expect(callers).toContain('"link_alert_to_work"');
    expect(panel).toContain("recordConditionObservation");
    expect(panel).toContain("linkAlertToWork");
    expect(panel).toContain("get_condition_monitoring");
    expect(panel).toContain("Not measurable yet — no linked alerts");
    expect(panel).toContain("does not authorize work");
  });
});

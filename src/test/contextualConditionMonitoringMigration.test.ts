import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219163000_contextual_condition_monitoring.sql",
  "utf8",
);
const component = readFileSync(
  "src/components/ConditionMonitoring.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-contextual-condition-monitoring-smoke.sh",
  "utf8",
);

describe("C9.04 contextual condition-monitoring contract", () => {
  it("composes canonical readings and operating intervals without a parallel store", () => {
    expect(migration).toContain(
      "function public.get_contextual_condition_monitoring(",
    );
    expect(migration).toContain("from public.condition_readings cr");
    expect(migration).toContain("from public.operating_states x");
    expect(migration).toContain("left join lateral");
    expect(migration).not.toMatch(/create table/i);
  });

  it("keeps tenant scope and an authenticated-only read boundary", () => {
    expect(migration).toContain("v_org uuid := public.app_current_org()");
    expect(
      migration.match(/organization_id = v_org/g)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("to authenticated");
  });

  it("matches exact-time duty and does not infer a nearest operating state", () => {
    expect(migration).toContain("x.started_at <= cr.taken_at");
    expect(migration).toContain(
      "x.ended_at is null or x.ended_at > cr.taken_at",
    );
    expect(migration).toContain(
      "'context_known', q.operating_state_id is not null",
    );
    expect(migration).toContain("Duty remains unknown");
    expect(migration).not.toMatch(/abs\s*\(.*taken_at/is);
  });

  it("labels only the enabled tenant connector as connector-backed evidence", () => {
    expect(migration).toContain("c.connector_type = 'plant_historian'");
    expect(migration).toContain("q.source_system = v_connector_key");
    expect(migration).toContain("'connector_backed'");
    expect(migration).toContain("'seed_sim_or_import'");
  });

  it("is reachable from the Reliability condition-monitoring surface and smoke-tested", () => {
    expect(component).toContain(
      'supabase.rpc("get_contextual_condition_monitoring"',
    );
    expect(component).toContain("Condition evidence in operating context");
    expect(component).toContain("source_posture");
    expect(workflow).toContain(
      "bash scripts/ci-contextual-condition-monitoring-smoke.sh",
    );
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("exact_interval=true");
  });
});

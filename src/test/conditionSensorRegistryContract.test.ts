import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102050000_condition_sensor_registry.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/conditionSensorRegistryService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ConditionSensorRegistry.tsx",
  "utf8",
);
const parent = readFileSync("src/components/ConditionMonitoring.tsx", "utf8");
const ingest = readFileSync("src/lib/ingest-entities.ts", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const smoke = readFileSync(
  "scripts/ci-condition-sensor-registry-smoke.sh",
  "utf8",
);
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("C2.05 governed condition-sensor registry", () => {
  it("extends canonical condition identities and never creates parallel evidence stores", () => {
    expect(migration).toContain("alter table public.sensors");
    expect(migration).toContain("from public.condition_readings cr");
    expect(migration).toContain(
      "from public.condition_monitoring_agent_packs p",
    );
    expect(migration).toContain("from public.instrument_calibrations ic");
    expect(migration).not.toMatch(
      /create table if not exists public\.(condition_readings|condition_monitoring_agent_packs|instrument_calibrations)/,
    );
  });

  it("makes configuration a named-human, tenant-bound and optimistic act", () => {
    expect(migration).toContain("condition_sensor_human_role_allowed");
    expect(migration).toContain(
      "('reliability_engineer','maintenance_manager','admin')",
    );
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("configuration_version=p_expected_version");
    expect(migration).toContain(
      "a sensor cannot be moved between canonical assets",
    );
    expect(migration).toContain(
      "this organization already has that sensor tag",
    );
  });

  it("refuses invented or directionally inconsistent limits", () => {
    expect(migration).toContain("p_warning_limit is not null");
    expect(migration).toContain("p_warning_limit>=p_alarm_limit");
    expect(migration).toContain("p_warning_limit<=p_alarm_limit");
    expect(panel).toContain("SyncAI never invents a threshold");
  });

  it("locks out direct customer writes and retains append-only configuration history", () => {
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.sensors",
    );
    expect(migration).toContain("sensor configuration history is append-only");
    expect(migration).toContain("sensor_configuration_revisions");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("preserves history while decommissioning blocks all new readings", () => {
    expect(migration).toContain("decommission_condition_sensor");
    expect(migration).toContain("reactivate_condition_sensor");
    expect(migration).toContain("trg_condition_reading_active_sensor");
    expect(migration).toContain(
      "condition readings require an active governed sensor",
    );
    expect(migration).not.toContain("delete from public.condition_readings");
    expect(migration).not.toContain(
      "delete from public.condition_monitoring_agent_packs",
    );
  });

  it("is reachable beside existing ingest and diagnostic-report execution", () => {
    expect(service).toContain('"get_condition_sensor_registry"');
    expect(service).toContain('"upsert_condition_sensor"');
    expect(panel).toContain("Condition sensor registry");
    expect(parent).toContain("<ConditionSensorRegistry />");
    expect(parent).toContain("<ConditionMonitoringAgentWorkbench />");
    expect(ingest).toContain("Condition Monitoring → Sensor registry");
  });

  it("has full-chain runtime proof before the register claims green", () => {
    for (const proof of [
      "named_human_registry=true",
      "role_gate=true",
      "tenant_wall=true",
      "direct_write_locked=true",
      "limit_ordering=true",
      "reading_ingest=true",
      "diagnostic_report=true",
      "decommission_blocks_reading=true",
      "history_preserved=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-condition-sensor-registry-smoke.sh",
    );
    expect(register).toMatch(/\| C2\.05 \|[^\n]+\| ✅[^\n]+/i);
  });
});

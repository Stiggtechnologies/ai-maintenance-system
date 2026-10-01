import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101160000_condition_monitoring_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/conditionMonitoringAgentService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ConditionMonitoringAgentWorkbench.tsx",
  "utf8",
);
const parent = readFileSync("src/components/ConditionMonitoring.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-condition-monitoring-agent-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Condition Monitoring Analyst execution", () => {
  it("reuses canonical readings, exact-time duty, alerts and retained agent runs", () => {
    expect(migration).toContain(
      "create or replace function public.run_condition_monitoring_agent",
    );
    expect(migration).toContain("from public.condition_readings cr");
    expect(migration).toContain("from public.operating_states x");
    expect(migration).toContain("'condition_alerts'");
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).not.toContain(
      "create table if not exists public.condition_readings",
    );
  });

  it("covers the five requested modalities with technique-specific evidence plans", () => {
    for (const modality of [
      "vibration",
      "oil_analysis",
      "thermography",
      "motor_current",
      "process_anomaly",
    ])
      expect(migration).toContain(`'${modality}'`);
    expect(migration).toContain("waveform/spectrum evidence");
    expect(migration).toContain("wear-debris morphology");
    expect(migration).toContain("emissivity and environment");
    expect(migration).toContain("current spectrum, voltage quality");
    expect(migration).toContain("upstream/downstream variables");
  });

  it("keeps signal interpretation distinct from diagnosis and execution", () => {
    expect(migration).toContain(
      "this is a signal state, not a failure diagnosis",
    );
    expect(migration).toContain("'maydiagnosefailure',false");
    expect(migration).toContain("'maychangelimits',false");
    expect(migration).toContain("'maycreateorreleasework',false");
    expect(migration).toContain("'maychangemaintenanceinterval',false");
    expect(migration).toContain("'mayacceptrisk',false");
    expect(migration).toContain("'mayreturntoservice',false");
  });

  it("fails closed on role, tenancy, adopted control and named review", () => {
    expect(migration).toContain("requires a named reliability engineer");
    expect(migration).toContain(
      "where id=p_sensor_id and organization_id=v_org",
    );
    expect(migration).toContain("evaluate_agent_control_internal");
    expect(migration).toContain("interpret_condition_evidence");
    expect(migration).toContain(
      "review owner must be a named member of this organization",
    );
  });

  it("is reachable on the condition-monitoring workspace", () => {
    expect(service).toContain('"run_condition_monitoring_agent"');
    expect(service).toContain('"assign_condition_monitoring_review"');
    expect(panel).toContain("Run assessment");
    expect(panel).toContain("Assign review");
    expect(parent).toContain("<ConditionMonitoringAgentWorkbench />");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.06", () => {
    for (const proof of [
      "exact_reading_snapshot=true",
      "operating_context=true",
      "quality_exclusion=true",
      "role_gate=true",
      "tenant_wall=true",
      "immutable_pack=true",
      "named_review=true",
      "no_execution_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-condition-monitoring-agent-smoke.sh",
    );
    expect(register).toMatch(/\| C1\.06 \|[^\n]+\| ✅[^\n]+/i);
  });
});

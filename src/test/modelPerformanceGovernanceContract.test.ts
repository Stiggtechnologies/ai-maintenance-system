import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101830000_model_performance_governance.sql",
  "utf8",
).toLowerCase();
const panel = readFileSync(
  "src/components/ModelPerformanceMonitoringPanel.tsx",
  "utf8",
);
const service = readFileSync("src/services/modelMonitoringService.ts", "utf8");
const registryPage = readFileSync(
  "src/pages/EngineeringModelRegistryPage.tsx",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E5.08/E5.10/E5.11 model-performance governance", () => {
  it("extends the canonical model, prediction, evidence and calculation stores", () => {
    for (const canonical of [
      "public.model_register",
      "public.model_predictions",
      "public.model_input_snapshots",
      "public.evidence_items",
      "public.calculation_runs",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
    expect(migration).not.toContain("model_register_v2");
    expect(migration).not.toContain("model_predictions_v2");
    expect(migration.match(/create table/g)).toHaveLength(2);
  });

  it("makes snapshots, assessments and reviews tenant-scoped and service-proof", () => {
    expect(migration).toContain(
      "create policy model_monitoring_assessment_read",
    );
    expect(migration).toContain("create policy model_monitoring_review_read");
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain("app.model_monitoring_write");
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain("from anon,authenticated,service_role");
    expect(migration).toContain(
      "model monitoring evidence is retained and cannot be deleted",
    );
  });

  it("records exact-version lineage and refuses to turn screening into authority", () => {
    expect(migration).toContain("reference_checksum");
    expect(migration).toContain("current_checksum");
    expect(migration).toContain("prediction_snapshot_checksum");
    expect(migration.match(/extensions\.digest/g)).toHaveLength(2);
    expect(migration).not.toMatch(/(?<!extensions\.)digest\(/);
    expect(migration).toContain("model_register_id=m.id");
    expect(
      migration.match(
        /p\.predicted_at::date between c\.window_start and c\.window_end/g,
      ),
    ).toHaveLength(2);
    expect(migration).toContain("operationalauthorization',false");
    expect(migration).toContain(
      "screening bands; cohort gaps are conservative review triggers, not findings of unfairness",
    );
  });

  it("requires a different named human and verified evidence before model-state change", () => {
    expect(migration).toContain("a.assessed_by=v_uid");
    expect(migration).toContain(
      "the assessor cannot independently disposition the same assessment",
    );
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("app.model_registry_governed_write");
    expect(migration).toContain("current_for_decisions=false");
    expect(migration).toContain("production_eligible=false");
  });

  it("makes outcome capture, snapshots, PSI and independent review customer reachable", () => {
    expect(panel).toContain("recordEngineeringModelFieldOutcome");
    expect(panel).toContain("populationStabilityIndex(");
    for (const rpc of [
      "capture_model_input_snapshot",
      "run_model_performance_assessment",
      "review_model_performance_assessment",
      "get_model_monitoring_workspace",
    ]) {
      expect(service).toContain(`"${rpc}"`);
    }
    expect(registryPage).toContain("<ModelPerformanceMonitoringPanel />");
    expect(workflow).toContain(
      "bash scripts/ci-model-performance-governance-smoke.sh",
    );
  });

  it("advances only the three capabilities proven by this slice", () => {
    for (const id of ["E5.08", "E5.10", "E5.11"]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`),
      );
    }
  });
});

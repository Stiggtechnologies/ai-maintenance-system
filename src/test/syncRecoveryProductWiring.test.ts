import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/services/syncRecoveryService.ts", "utf8");
const page = readFileSync("src/pages/SyncRecoveryPage.tsx", "utf8");
const controlCenter = readFileSync(
  "src/components/RecoveryControlCenter.tsx",
  "utf8",
);
const integrationsPage = readFileSync("src/pages/IntegrationsPage.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261002100000_recovery_product_wiring.sql",
  "utf8",
).toLowerCase();

describe("Sync Recovery product wiring", () => {
  it("exposes Control, Optimize and Learn through the Recovery page", () => {
    for (const view of ["control", "optimize", "learn"]) {
      expect(page).toContain(`id: "${view}"`);
    }
    expect(page).toContain("RecoveryControlCenter");
  });

  it("reaches the governed control, optimization and learning contracts", () => {
    for (const fn of [
      "refresh_recovery_planning_inputs",
      "get_recovery_handoff",
      "get_recovery_decision_queue",
      "get_recovery_component_life_context",
      "get_recovery_parts_risk",
      "run_restoration_risk_simulation",
      "simulate_recovery_what_if",
      "run_recovery_fleet_optimization",
      "get_recovery_sequence_patterns",
      "get_recovery_productivity_norms",
      "record_recovery_recommendation_feedback",
      "record_recovery_delay_attribution",
      "publish_recovery_cadence_snapshot",
      "add_recovery_field_evidence",
      "set_recovery_consequence",
      "set_restoration_work_zone",
      "record_asset_energy_state",
      "set_job_plan_energy_requirement",
      "set_recovery_uncertainty_group",
    ]) {
      expect(service).toContain(fn);
    }
    expect(controlCenter).toContain("stale evidence stays unknown");
    expect(controlCenter).toMatch(/never self-approve\s+work/);
  });

  it("refreshes deeper planning inputs before every product plan generation", () => {
    const refresh = service.indexOf('"refresh_recovery_planning_inputs"');
    const generate = service.indexOf('"generate_restoration_plan"');
    expect(refresh).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(refresh);
    expect(migration).toContain("component-life planning evidence");
    expect(migration).toContain("material-lot readiness");
    expect(migration).toContain("do-now/defer is not inferred");
    expect(migration).toContain(
      "missing component-life and material-lot evidence is never inferred",
    );
  });

  it("uses the canonical connector run/staging contract for external signals", () => {
    expect(migration).toContain("configure_recovery_signal_connector");
    expect(migration).toContain("ingest_recovery_signal_batch");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.ingest_staging");
    expect(migration).toContain("'duplicate'");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("operational_constraint_signal");
    expect(service).toContain("configure_recovery_signal_connector");
    expect(integrationsPage).toContain("RecoverySignalConnectorSetup");
  });

  it("keeps connector activation explicit, secretless and read-only", () => {
    expect(migration).toContain("credential_binding_ref");
    expect(migration).toContain("never the credential value");
    expect(migration).toContain("write_enabled=false");
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("connector is configured but disabled");
    expect(migration).toContain("health stays never run");
  });

  it("validates tenant ownership and denies anonymous execution", () => {
    expect(migration).toContain("site_id is outside the active tenant");
    expect(migration).toContain("asset_id is outside the active tenant");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("from public,anon");
    expect(migration).not.toMatch(/grant execute[^;]+to anon/);
  });
});

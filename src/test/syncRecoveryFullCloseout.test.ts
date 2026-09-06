import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const control = readFileSync(
  "supabase/migrations/20261001090000_sync_recovery_control_closeout.sql",
  "utf8",
).toLowerCase();
const optimize = readFileSync(
  "supabase/migrations/20261001091000_sync_recovery_optimize_closeout.sql",
  "utf8",
).toLowerCase();

const all = `${control}\n${optimize}`;

describe("Sync Recovery full production close-out", () => {
  it("closes readiness without inventing availability", () => {
    expect(control).toContain("restoration_resource_requirements");
    expect(control).toContain("operational_constraint_signals");
    expect(control).toContain("refresh_restoration_readiness");
    expect(control).toContain("missing or stale evidence remains unknown");
    expect(control).toContain("craft_capacity");
    expect(control).toContain("work_order_materials");
  });

  it("adds probability-based duration risk with explicit evidence bounds", () => {
    expect(optimize).toContain("run_restoration_risk_simulation");
    expect(optimize).toContain("deterministic empirical bootstrap");
    expect(optimize).toContain("hist_n>=5");
    expect(optimize).toContain("shared-rank shock");
    expect(optimize).toContain("p80_hours");
    expect(optimize).toContain("probability_before_frozen_baseline");
  });

  it("fails physical parallelism closed on missing work-zone evidence", () => {
    expect(control).toContain("work_zone_relationships");
    expect(control).toContain("physical interference");
    expect(control).toContain("interference cannot be assessed");
    expect(control).toContain("no verified physical relationship permits");
  });

  it("enforces multi-energy state below the UI", () => {
    expect(control).toContain("job_plan_energy_requirements");
    expect(control).toContain("asset_energy_states");
    expect(control).toContain("trg_recovery_energy_state");
    expect(control).toContain("raise exception 'recovery energy gate");
  });

  it("adds consequence, FTR and recommendation-reason learning", () => {
    expect(control).toContain("recovery_consequence_assessments");
    expect(control).toContain("recovery_recurrence_links");
    expect(control).toContain("get_recovery_ftr_metrics");
    expect(control).toContain("recovery_recommendation_feedback");
    expect(control).toContain("learning_events");
  });

  it("integrates component age/history without manufacturing current life", () => {
    expect(optimize).toContain("asset_meter_readings");
    expect(optimize).toContain("component_instances");
    expect(optimize).toContain("component_life_events");
    expect(optimize).toContain("current_component_age_hours");
    expect(optimize).toContain("current age is never inferred");
  });

  it("makes cannibalization a governed trade study rather than an autonomous transfer", () => {
    expect(optimize).toContain("get_recovery_cannibalization_options");
    expect(optimize).toContain("propose_recovery_cannibalization");
    expect(optimize).toContain("'recovery_cannibalization'");
    expect(optimize).toContain("'pending',true");
    expect(optimize).toContain("no component transfer is performed");
  });

  it("adds a multi-event scarce-resource optimizer and dynamic production weighting", () => {
    expect(optimize).toContain("run_recovery_fleet_optimization");
    expect(optimize).toContain(
      "deterministic_priority_first_scarce_craft_allocation_v1",
    );
    expect(optimize).toContain("craft_capacity");
    expect(optimize).toContain("signal_kind='production'");
    expect(optimize).toContain("priority_weight");
  });

  it("adds what-if, historical sequence learning and normalized crew productivity", () => {
    expect(optimize).toContain("simulate_recovery_what_if");
    expect(optimize).toContain("get_recovery_sequence_patterns");
    expect(optimize).toContain("get_recovery_productivity_norms");
    expect(optimize).toContain("actual_hours/nullif(t.estimated_hours,0)");
  });

  it("adds weather/vendor/documentation/production connector contracts", () => {
    for (const kind of ["vendor", "documentation", "weather", "production"]) {
      expect(control).toContain(`'${kind}'`);
    }
    expect(control).toContain("valid_until");
    expect(control).toContain("source_system");
  });

  it("models parts staging, condition, certification, lead time and alternatives", () => {
    expect(optimize).toContain("material_stock_lots");
    expect(optimize).toContain("certification_status");
    expect(optimize).toContain("staged_for_work_order_id");
    expect(optimize).toContain("expected_receipt_date");
    expect(optimize).toContain("lead_time_days");
    expect(optimize).toContain("material_substitutions");
  });

  it("adds rich economics but leaves value verification in the canonical control", () => {
    expect(control).toContain("recovery_economic_assumptions");
    expect(control).toContain("contractor_cost_usd");
    expect(control).toContain("logistics_cost_usd");
    expect(control).toContain("risk_cost_usd");
    expect(control).toContain("life_cycle_cost_usd");
    expect(control).toContain("verify_value_metric()");
    expect(control).not.toContain("update value_metrics set status='verified'");
  });

  it("adds causal attribution while preserving the frozen counterfactual", () => {
    expect(control).toContain("recovery_delay_attribution");
    expect(control).toContain("get_recovery_counterfactual_attribution");
    expect(control).toContain("baseline_return_at");
    expect(control).not.toContain(
      "update restoration_events set baseline_return_at",
    );
  });

  it("adds a supervisor intervention queue and automated escalation clock", () => {
    expect(control).toContain("get_recovery_decision_queue");
    expect(control).toContain("run_recovery_escalation_clock");
    expect(control).toContain("syncai-recovery-escalation-clock");
    expect(control).toContain("*/5 * * * *");
    expect(control).toContain("system_alerts");
  });

  it("generates shift handoff and closed-loop management cadence server-side", () => {
    expect(control).toContain("get_recovery_handoff");
    expect(control).toContain("recovery_cadence_snapshots");
    expect(control).toContain("publish_recovery_cadence_snapshot");
    for (const cadence of ["shift", "daily", "weekly"]) {
      expect(control).toContain(`'${cadence}'`);
    }
  });

  it("links field photo/voice/document evidence to the canonical Sync attachment store", () => {
    expect(control).toContain("recovery_field_evidence");
    expect(control).toContain("references cowork_attachments(id)");
    expect(control).toContain(
      "'photo','voice','document','measurement','note'",
    );
    expect(control).toContain("client_command_id");
    expect(control).toContain("uploaded_by=auth.uid()");
  });

  it("keeps new tables tenant-readable but direct-write closed", () => {
    expect(all).toContain("enable row level security");
    expect(all).toContain("for select to authenticated");
    expect(all).not.toMatch(
      /create policy [^;]+ for (insert|update|delete|all) to authenticated/,
    );
  });

  it("revokes privileged RPCs from PUBLIC and anon", () => {
    expect(control).toContain("revoke all on function public.");
    expect(optimize).toContain("revoke all on function public.");
    expect(control).toContain("from public, anon");
    expect(optimize).toContain("from public, anon");
  });

  it("does not create duplicate recovery approval, work-order, material or audit stores", () => {
    for (const forbidden of [
      "create table recovery_approvals",
      "create table restoration_approvals",
      "create table recovery_work_orders",
      "create table restoration_work_orders",
      "create table recovery_materials",
      "create table restoration_materials",
      "create table recovery_audit",
      "create table restoration_audit",
    ]) {
      expect(all).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Honesty ratchet.
//
// The product-wiring slice deliberately exposes the operator-facing close-out
// contracts. This ratchet names that surface exactly: adding or removing a
// reachable contract requires the control matrix and this list to change in the
// same review. Internal triggers, deterministic helpers and connector-only
// master-data writers are not counted as user-facing capabilities.
// ---------------------------------------------------------------------------
describe("Sync Recovery close-out reachability claims", () => {
  const migrations = [
    "supabase/migrations/20261001090000_sync_recovery_control_closeout.sql",
    "supabase/migrations/20261001091000_sync_recovery_optimize_closeout.sql",
    "supabase/migrations/20261001092000_sync_recovery_closeout_hardening.sql",
  ];

  const closeoutFunctions = [
    ...new Set(
      migrations
        .flatMap((f) => [
          ...readFileSync(f, "utf8").matchAll(
            /create or replace function public\.([a-z0-9_]+)/gi,
          ),
        ])
        .map((m) => m[1].toLowerCase()),
    ),
  ].sort();

  const appDirs = ["services", "pages", "components", "lib", "hooks"];
  const appSource = appDirs
    .map((d) => {
      const dir = `src/${d}`;
      const walk = (p: string): string[] =>
        readdirSync(p, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? walk(`${p}/${e.name}`)
            : /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")
              ? [`${p}/${e.name}`]
              : [],
        );
      return walk(dir).map((f) => readFileSync(f, "utf8"));
    })
    .flat()
    .join("\n");

  it("finds the close-out functions at all (control for the scan below)", () => {
    expect(closeoutFunctions.length).toBeGreaterThan(30);
    // A canonical Recovery RPC from the earlier slice IS wired to a surface.
    // If this control ever fails, the surface scan is broken, not the claim.
    expect(appSource).toContain("open_restoration_event");
  });

  it("keeps the control matrix honest about product reachability", () => {
    const reachable = closeoutFunctions.filter((fn) => appSource.includes(fn));
    expect(reachable).toEqual([
      "add_recovery_field_evidence",
      "get_recovery_cannibalization_options",
      "get_recovery_component_life_context",
      "get_recovery_counterfactual_attribution",
      "get_recovery_decision_queue",
      "get_recovery_economics",
      "get_recovery_ftr_metrics",
      "get_recovery_handoff",
      "get_recovery_parts_risk",
      "get_recovery_productivity_norms",
      "get_recovery_sequence_patterns",
      "publish_recovery_cadence_snapshot",
      "record_asset_energy_state",
      "record_recovery_delay_attribution",
      "record_recovery_recommendation_feedback",
      "refresh_recovery_recurrence_candidates",
      "register_operational_constraint_signal",
      "run_recovery_fleet_optimization",
      "run_restoration_risk_simulation",
      "set_job_plan_energy_requirement",
      "set_recovery_consequence",
      "set_recovery_uncertainty_group",
      "set_restoration_resource_requirement",
      "set_restoration_work_zone",
      "simulate_recovery_what_if",
    ]);

    const matrix = readFileSync("docs/sync-recovery/control-matrix.md", "utf8");
    expect(matrix).toContain(
      "25 of the 39 close-out functions are now reachable",
    );
    expect(matrix).not.toContain("No product surface reaches any of it");
    expect(matrix).not.toContain("0 rows are closed end to end in the product");
  });

  it("does not let the acceptance job re-assert 30 closed requirements", () => {
    const workflow = readFileSync(
      ".github/workflows/recovery-closeout.yml",
      "utf8",
    );
    expect(workflow).toContain("name: Recovery close-out runtime acceptance");
    expect(workflow).not.toMatch(/^\s*name:\s*Recovery 30-requirement/m);
  });
});

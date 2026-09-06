/**
 * Sync Develop Realize / Learn — migration contract (static, no database).
 *
 * Live behaviour is the RPCs. This file pins the CONTRACT in the migration
 * text so a later edit that forks a store, invents a checkpoint table, admits
 * ai_admin, or teaches verification to stamp a design target as the actual
 * fails CI before it reaches a database.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_HORIZONS,
  DELIVERY_FAILURE_TYPES,
  WARRANTY_METRICS,
} from "../lib/develop/realize";
import { stripComments } from "./support/migrationPolicies";

const sql = stripComments(
  readFileSync(
    "supabase/migrations/20261217091000_develop_realize_warranty_lessons.sql",
    "utf8",
  ),
);
const lower = sql.toLowerCase();

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf("create or replace function public.", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe("no parallel stores (rulings 9, 11, 12, 13)", () => {
  it("creates no warranty / checkpoint / lesson / fracas table", () => {
    expect(lower).not.toMatch(
      /create table[^;]*(warranty|checkpoint|lesson|fracas)/,
    );
  });

  it("grows ram_targets in place — the seven I.36 metrics are columns", () => {
    expect(sql).toContain("alter table public.ram_targets");
    expect(sql).toContain("add column if not exists development_case_id");
    expect(sql).toContain("add column if not exists survives_handover");
    expect(sql).toContain("throughput_target");
    expect(sql).toContain("reliability_target");
    expect(sql).toContain("maintenance_cost_target");
    expect(sql).toContain("energy_target");
    expect(sql).toContain("quality_target");
    expect(sql).toContain("operating_cost_target");
    expect(sql).toContain("ram_targets_metric_pairs");
  });

  it("does not touch warranty_terms / warranty_claims — those stay vendor cover", () => {
    expect(lower).not.toMatch(/alter table public\.warranty_terms/);
    expect(lower).not.toMatch(/alter table public\.warranty_claims/);
    expect(sql).toContain("warranty_terms");
  });

  it("checkpoints land on value_metrics — the one verification loop", () => {
    expect(sql).toContain("alter table public.value_metrics");
    expect(sql).toContain("checkpoint_horizon_days");
    expect(sql).toContain("parent_metric_id");
    expect(sql).toContain("verify_value_metric");
    expect(functionBody("record_operational_warranty")).toContain(
      "verify_value_metric",
    );
    expect(functionBody("open_realization_window")).toContain(
      "verify_value_metric",
    );
    expect(functionBody("record_checkpoint_observation")).toContain(
      "verify_value_metric",
    );
  });

  it("lessons land on learning_events — the one learning store", () => {
    expect(sql).toContain("alter table public.learning_events");
    expect(sql).toContain("failure_mode_key");
    expect(sql).toContain("corrective_action");
    expect(sql).toContain("applicability");
    expect(functionBody("record_project_lesson")).toContain("learning_events");
  });
});

describe("vocabularies pinned to src/lib/develop/realize.ts", () => {
  it("sync_warranty_metric_keys matches WARRANTY_METRICS", () => {
    const body = functionBody("sync_warranty_metric_keys");
    for (const key of WARRANTY_METRICS) {
      expect(body).toContain(`'${key}'`);
    }
    expect(body).not.toContain("'mtbf'");
  });

  it("sync_checkpoint_horizons matches CHECKPOINT_HORIZONS and excludes RIA day 60", () => {
    const body = functionBody("sync_checkpoint_horizons");
    expect(body).toContain("array[30, 90, 180, 365]");
    expect(body).not.toContain("60");
    expect(CHECKPOINT_HORIZONS).toEqual([30, 90, 180, 365]);
  });

  it("sync_delivery_failure_types matches DELIVERY_FAILURE_TYPES", () => {
    const body = functionBody("sync_delivery_failure_types");
    for (const key of DELIVERY_FAILURE_TYPES) {
      expect(body).toContain(`'${key}'`);
    }
    expect(DELIVERY_FAILURE_TYPES).toHaveLength(8);
  });
});

describe("recommend ≠ authorize", () => {
  it("every write door refuses ai_admin by naming the human role list", () => {
    for (const name of [
      "record_operational_warranty",
      "open_realization_window",
      "record_checkpoint_observation",
      "record_project_lesson",
    ]) {
      const body = functionBody(name);
      expect(body).toContain(
        "'admin','executive','maintenance_manager','reliability_engineer','planner'",
      );
      expect(body).not.toContain("'ai_admin'");
      expect(body).toMatch(/recommend ≠ authorize|named-human act|not offered/);
    }
  });

  it("observation does not flip status to verified", () => {
    const body = functionBody("record_checkpoint_observation");
    expect(body).not.toMatch(/status\s*=\s*'verified'/);
    expect(body).toContain("Observed, not verified");
    expect(body).toContain("value stays the DESIGN target");
    expect(body).not.toMatch(/(?<![a-z_])value\s*=\s*p_observed_value/);
  });

  it("verify_value_metric refuses a checkpoint with no observation", () => {
    const body = functionBody("verify_value_metric");
    expect(body).toContain("checkpoint_horizon_days is not null and m.observed_at is null");
    expect(body).toContain("the design target is not the actual");
    expect(body).toContain("m.observed_value");
  });

  it("recording a lesson does not adopt a standard or revise a framework", () => {
    const body = functionBody("record_project_lesson");
    expect(body).toContain("Does not adopt a standard");
    expect(body).not.toContain("adopt_taxonomy_definition");
    expect(body).not.toContain("adopt_risk_criteria");
  });
});

describe("tenancy and schema walls", () => {
  it("case-bound warranty requires a basis at the schema", () => {
    expect(sql).toContain("ram_targets_case_warranty_basis");
    expect(sql).toContain("development_case_id is null");
  });

  it("case-bound lesson requires the eight-type complete record at the schema", () => {
    expect(sql).toContain("learning_events_case_lesson_complete");
    expect(sql).toContain("sync_delivery_failure_types()");
  });

  it("tenancy triggers refuse a cross-tenant case pointer for every writer", () => {
    expect(sql).toContain("enforce_ram_target_case_tenancy");
    expect(sql).toContain("enforce_learning_event_case_tenancy");
    expect(sql).toContain("another tenant''s development case");
    const ram = functionBody("enforce_ram_target_case_tenancy");
    const lesson = functionBody("enforce_learning_event_case_tenancy");
    expect(ram).not.toContain("current_user not in");
    expect(lesson).not.toContain("current_user not in");
  });

  it("every new SECURITY DEFINER function revokes from public and anon", () => {
    for (const name of [
      "record_operational_warranty",
      "ensure_realization_checkpoints",
      "open_realization_window",
      "record_checkpoint_observation",
      "record_project_lesson",
      "get_case_operational_warranty",
      "get_case_realization_checkpoints",
      "get_case_project_lessons",
      "ensure_project_delivery_taxonomy",
      "verify_value_metric",
    ]) {
      expect(lower).toMatch(
        new RegExp(
          `revoke (all|execute) on function public\\.${name}\\([^)]*\\) from public, anon`,
        ),
      );
    }
  });

  it("every new definer RPC resolves the tenant from the session", () => {
    for (const name of [
      "record_operational_warranty",
      "open_realization_window",
      "record_checkpoint_observation",
      "record_project_lesson",
      "get_case_operational_warranty",
      "get_case_realization_checkpoints",
      "get_case_project_lessons",
      "ensure_project_delivery_taxonomy",
    ]) {
      expect(functionBody(name)).toContain("app_current_org()");
    }
    expect(functionBody("ensure_project_delivery_taxonomy")).not.toMatch(
      /p_org/,
    );
  });
});

describe("honest empty / unstated", () => {
  it("an unstated metric is omitted from shells, never zeroed", () => {
    const body = functionBody("ensure_realization_checkpoints");
    expect(body).toContain("if r.throughput_target is not null");
    expect(body).toContain("if r.reliability_target is not null");
    expect(body).toContain("if r.energy_target is not null");
    expect(functionBody("record_operational_warranty")).toContain(
      "unstated metric is not warranted, never zero",
    );
  });

  it("warranty recording refuses a case with no capital project rather than inventing one", () => {
    const body = functionBody("record_operational_warranty");
    expect(body).toContain("c.capital_project_id is null");
    expect(body).toContain("bind the case to a capital project first");
  });

  it("taxonomy seeds as draft — adoption stays the C3 human act", () => {
    expect(sql).toContain("register_ref, status, version");
    expect(sql).toContain("'draft', 1");
    expect(sql).toContain("D9.04");
  });
});

describe("§34 Lesson APPLIES_TO AssetClass — audit acted on, not left alarming", () => {
  it("closes the edge at the column the 5D audit named, and moves the ledger", () => {
    expect(sql).toContain("add column if not exists applicability");
    expect(sql).toContain("sync_spec34_edges");
    expect(sql).toContain("CORRECTED 20261217091000");
    expect(sql).toContain("learning_events.applicability");
    expect(sql).toContain("information_schema.columns");
    expect(sql).toContain(
      "would be the false claim it exists to remove",
    );
  });

  it("removes the Lesson tuple from the absent-edge audit and restates TWO remaining", () => {
    expect(sql).toContain("sync_spec34_absent_edge_audit");
    expect(sql).toContain("the Lesson entry of sync_spec34_absent_edge_audit");
    expect(sql).toContain("states TWO of");
    expect(sql).toContain(
      "20261217091000 closed Lesson APPLIES_TO AssetClass",
    );
    // D9.12 is a different residual — closing the column is not screening.
    expect(sql).toContain("D9.12 auto-screening");
  });
});

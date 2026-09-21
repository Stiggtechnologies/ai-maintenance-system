import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const FILE =
  "supabase/migrations/20261220120000_develop_ram_case_completion.sql";
const raw = readFileSync(FILE, "utf8");
const migration = stripComments(raw);
const slice5dSmoke = readFileSync(
  "scripts/ci-develop-slice5d-smoke.sh",
  "utf8",
);

function body(fn: string): string {
  const at = migration.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = migration.indexOf("\n$$;", at);
  return migration.slice(at, end === -1 ? undefined : end);
}

describe("D12.13 completion extends the canonical case RAM scope", () => {
  const scope = () => body("get_case_ram_scope");

  it("reuses the canonical topology and common-cause stores", () => {
    expect(scope()).toContain("asset_dependencies");
    expect(scope()).toContain("common_cause_groups");
    expect(scope()).toContain("common_cause_members");
    expect(scope()).toContain("redundancy_group");
    expect(scope()).toContain("min_suppliers_required");
    expect(scope()).toContain("confirmed_at");
    expect(scope()).toContain("evidence");
  });

  it("does not invent a second RBD, FMEA, strategy, or growth store", () => {
    expect(migration).not.toMatch(/create table/);
    expect(scope()).toContain("asset_failure_mode_libraries");
    expect(scope()).toContain("asset_maintenance_strategy_recommendations");
    expect(scope()).toContain("asset_meter_readings");
    expect(scope()).toContain("work_orders");
  });

  it("requires an explicit meter-bounded observation window", () => {
    expect(scope()).toContain("meter_kind = 'operating_hours'");
    expect(scope()).toContain("calendarHours");
    expect(scope()).toContain("operatingHoursDelta");
    expect(scope()).toContain("meterReadingIds");
    expect(scope()).not.toContain("greatest(24");
    expect(scope()).not.toContain("+ interval '24 hours'");
  });

  it("keeps every case and child read inside the caller's organization", () => {
    expect(scope()).toContain("v_org uuid := app_current_org()");
    expect(scope()).toMatch(
      /development_cases where id = p_case_id and organization_id = v_org/,
    );
    expect(scope()).toMatch(
      /d\.development_case_id = c\.id and d\.organization_id = v_org/,
    );
    for (const table of [
      "asset_dependencies",
      "common_cause_groups",
      "common_cause_members",
      "asset_meter_readings",
      "work_orders",
      "asset_failure_mode_libraries",
      "asset_maintenance_strategy_recommendations",
    ]) {
      expect(scope(), table).toMatch(
        new RegExp(`${table}[\\s\\S]{0,900}organization_id = v_org`),
      );
    }
  });

  it("removes the obsolete claim that no redundancy topology exists", () => {
    expect(scope()).not.toContain(
      "nothing in this repository stores a redundancy structure",
    );
    expect(scope()).toContain("declared case dependency graph");
  });
});

describe("D12.13 completion keeps report lineage tied to server scope", () => {
  const record = body("record_ram_agent_report");

  it("pins the expanded kernel identity", () => {
    expect(body("sync_ram_kernel_version")).toContain(
      "develop-ram/5E/2026-12-20",
    );
    expect(record).toContain("sync_ram_kernel_version()");
  });

  it("validates topology, FMEA and PM identities before recording", () => {
    expect(record).toContain("v_scope_edges");
    expect(record).toContain("v_claim_edges");
    expect(record).toContain("v_scope_fmea");
    expect(record).toContain("v_claim_fmea");
    expect(record).toContain("v_scope_strategies");
    expect(record).toContain("v_claim_strategies");
    expect(record).toContain("does not match the server scope");
  });

  it("remains advisory and cannot write engineering authority", () => {
    expect(migration).not.toMatch(/insert into ram_targets/i);
    expect(migration).not.toMatch(/update ram_targets/i);
    expect(migration).not.toMatch(/insert into approvals/i);
    expect(migration).not.toMatch(/update approvals/i);
    expect(record).toContain("'advisory', true");
  });
});

describe("D12.13 preserves the earlier case-RAM runtime contract", () => {
  it("keeps no-asset fatal while project and target gaps are leg-local", () => {
    expect(slice5dSmoke).toContain(
      "grep -qi 'No asset is bound' <<<\"$(printf '%s' \"$R\" | field refusal)\"",
    );
    expect(slice5dSmoke).toContain(
      'grep -qi \'references no capital project\' <<<"$(jqp "$R"',
    );
    expect(slice5dSmoke).toContain(
      'grep -qi \'no ram_targets row\' <<<"$(jqp "$R"',
    );
    expect(slice5dSmoke).toContain(
      'RAM_KERNEL=$(psqlc "select sync_ram_kernel_version()")',
    );
    expect(slice5dSmoke).not.toContain(
      String.raw`p_kernel_version\":\"develop-ram/5D/2026-12-07`,
    );
  });
});

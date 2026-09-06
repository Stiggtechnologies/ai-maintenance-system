/**
 * Sync Develop D7 residual close — constraint escalation + composition honesty.
 *
 * Slice 7A left D7.07 🟡 on "run_recovery_escalation_clock has no scheduled
 * caller" and "restoration_blockers is event-only". The first claim was stale
 * (20261001090000 already scheduled the job). The second named the wrong
 * store: the burn-down reads restoration_constraints. This file pins that
 * the ONE clock now walks package-anchored constraints, that no second
 * schedule or burn-down table was invented, and that D7.16's live
 * composition list dropped D7.07 while keeping D7.06 and D7.12.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const FILE = "20261215090000_develop_constraint_escalation_and_field_module.sql";
const CLOCK_ORIGIN = "20261001090000_sync_recovery_control_closeout.sql";

const read = (f: string) =>
  stripComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
const raw = (f: string) => readFileSync(`supabase/migrations/${f}`, "utf8");

const residual = read(FILE);
const residualRaw = raw(FILE);
const origin = read(CLOCK_ORIGIN);
const registerDoc = readFileSync("docs/sync-develop/register.md", "utf8");
const overlap = readFileSync("docs/sync-develop/overlap-map.md", "utf8");
const panel = readFileSync(
  "src/components/develop/WorkPackagingPanels.tsx",
  "utf8",
);
const smoke = readFileSync("scripts/ci-develop-slice7c-smoke.sh", "utf8");

function body(source: string, fn: string): string {
  const at = source.lastIndexOf(`create or replace function public.${fn}(`);
  expect(at, `${fn} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("$$;", at);
  expect(end, `${fn} has no $$; terminator`).toBeGreaterThan(at);
  return source.slice(at, end);
}

function registerRow(id: string): string {
  const row = registerDoc.split("\n").find((l) => l.startsWith(`| ${id} `));
  expect(row, `register row ${id}`).toBeDefined();
  return row as string;
}

function registerStatus(id: string): string {
  return registerRow(id).split("|")[4]?.trim() ?? "";
}

describe("D7.07 — the one clock walks package constraints", () => {
  it("extends restoration_constraints rather than inventing a burn-down table", () => {
    expect(residual).toContain("alter table public.restoration_constraints");
    expect(residual).toContain("add column if not exists escalated_at");
    expect(residual).toContain("add column if not exists escalation_level");
    expect(residualRaw).not.toMatch(/create table/i);
  });

  it("keeps the restoration_blockers loop and adds the package-constraint loop", () => {
    const fn = body(residual, "run_recovery_escalation_clock");
    expect(fn).toContain("from restoration_blockers rb");
    expect(fn).toContain("escalation_due_at <= now()");
    expect(fn).toContain("from restoration_constraints rc");
    expect(fn).toContain("rc.work_package_id is not null");
    expect(fn).toContain("rc.expected_clear_date < current_date");
    expect(fn).toContain("rc.required_by < current_date");
    expect(fn).toContain("'package_constraint_escalation'");
    expect(fn).toContain("insert into system_alerts");
  });

  it("does not clear a constraint — the clock only raises", () => {
    const fn = body(residual, "run_recovery_escalation_clock");
    expect(fn).not.toMatch(/set\s+state\s*=/);
    expect(fn).not.toContain("satisfied");
  });

  it("stays on the one pg_cron job Recovery already scheduled", () => {
    expect(origin).toContain("syncai-recovery-escalation-clock");
    expect(origin).toContain("*/5 * * * *");
    expect(residual).toContain("syncai-recovery-escalation-clock");
    expect(residual).toContain("*/5 * * * *");
    expect(residual).toContain("select public.run_recovery_escalation_clock()");
    // One job name, restated, not a second schedule.
    const scheduled = [
      ...residual.matchAll(/cron\.schedule\(\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(scheduled).toEqual(["syncai-recovery-escalation-clock"]);
  });

  it("stays service-role-only", () => {
    expect(residual).toContain(
      "revoke all on function public.run_recovery_escalation_clock()",
    );
    expect(residual).toContain(
      "grant execute on function public.run_recovery_escalation_clock() to service_role",
    );
  });

  it("is reachable from the burn-down surface and from system_alerts", () => {
    expect(panel).toContain("scheduled escalation clock");
    expect(panel).toContain("system alerts");
    expect(registerRow("D7.07")).toContain("run_recovery_escalation_clock");
    expect(registerRow("D7.07")).toContain("syncai-recovery-escalation-clock");
    expect(registerRow("D7.07")).toContain("src/pages/CommandCenters.tsx");
  });

  it("flips D7.07 to ✅ and leaves the named D7.06 / D7.12 gaps yellow", () => {
    expect(registerStatus("D7.07")).toBe("✅");
    expect(registerStatus("D7.06")).toBe("🟡");
    expect(registerStatus("D7.12")).toBe("🟡");
    expect(registerRow("D7.06")).toContain(
      "the release door does not REQUIRE a field-readiness assessment",
    );
    expect(registerRow("D7.12")).toContain("unverifiable");
  });
});

describe("D7.16 — composition list drops the closed part", () => {
  it("names only D7.06 and D7.12 as still open", () => {
    const fn = body(residual, "get_sync_field_module");
    expect(fn).toContain("'row', 'D7.06'");
    expect(fn).toContain("'row', 'D7.12'");
    expect(fn).not.toContain("'row', 'D7.07'");
  });

  it("still composes and never recomputes", () => {
    const fn = body(residual, "get_sync_field_module");
    expect(fn).toContain("get_case_work_packages(c.id)");
    expect(fn).toContain("get_constraint_free_work_index(c.id, p_horizon_days)");
    expect(fn).not.toContain("sync_metric_ratio");
    expect(fn).not.toContain("sync_work_package_release_verdict");
    expect(fn).not.toContain("sync_field_readiness_elements");
  });

  it("stays 🟡 because a composition is not more complete than its parts", () => {
    expect(registerStatus("D7.16")).toBe("🟡");
    expect(registerRow("D7.16")).toContain("D7.07 closed");
  });

  it("the live smoke asserts the two remaining open parts", () => {
    expect(smoke).toContain('len(x[\'openParts\'])")" = "2"');
    expect(smoke).toContain("D7.06,D7.12");
    expect(smoke).not.toContain("D7.06,D7.07,D7.12");
  });
});

describe("overlap-map D7.07 ruling tracks the clock", () => {
  it("no longer claims the clock has no scheduled caller", () => {
    expect(overlap).not.toContain(
      "run_recovery_escalation_clock still has no scheduled caller",
    );
    expect(overlap).toContain("syncai-recovery-escalation-clock");
  });
});

/**
 * C4.06 — the weekly freeze stays on the existing door, refuses the
 * AI-operator identity, and records the feasibility it enforced.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const root = process.cwd();
const migrationPath =
  "supabase/migrations/20271109120000_schedule_freeze_audit.sql";
const migration = readFileSync(path.join(root, migrationPath), "utf8");
const executable = stripComments(migration);

function body(name: string): string {
  const marker = `create or replace function public.${name}`;
  const start = executable.indexOf(marker);
  expect(start, name).toBeGreaterThan(-1);
  const next = executable.indexOf(
    "\ncreate or replace function ",
    start + marker.length,
  );
  return executable.slice(start, next === -1 ? executable.length : next);
}

describe("C4.06 schedule freeze audit", () => {
  const release = body("release_schedule_option");
  const guard = body("guard_schedule_option_freeze");
  const reader = body("get_schedule_freeze_receipts");

  it("keeps one freeze door and writes the canonical audit ledger", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(release).toContain("public.evaluate_schedule_feasibility(p_id)");
    expect(release).toContain("insert into public.audit_events");
    expect(release).toContain("'action', 'schedule_frozen'");
    expect(release).toContain("'schedule_option'");
    expect(release).toContain("extensions.digest");
    expect(release).toContain("feasibility_sha256");
    expect(release).toContain(
      "perform set_config('syncai.schedule_freeze', '1', true)",
    );
    expect(executable).toContain(
      "grant execute on function public.release_schedule_option(uuid, boolean)",
    );
    expect(executable).toContain(
      "revoke all on function public.release_schedule_option(uuid, boolean)",
    );
  });

  it("refuses the AI-operator identity before any human release role", () => {
    expect(release).toMatch(/coalesce\(v_role,\s*''\)\s*=\s*'ai_admin'/);
    expect(release).toContain(
      "The AI-operator identity may prepare a schedule option; it may not freeze the week or authorize a production interruption.",
    );
    expect(release).not.toContain(
      "'planner', 'maintenance_manager', 'admin', 'ai_admin'",
    );
    expect(release).toContain(
      "coalesce(v_role, '') not in ('planner', 'maintenance_manager', 'admin')",
    );
    const refusal = release.indexOf("= 'ai_admin'");
    const allow = release.indexOf(
      "not in ('planner', 'maintenance_manager', 'admin')",
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(refusal);
  });

  it("fails closed on tenancy, a missing decision, hard blocks, and silent warnings", () => {
    expect(release).toContain("v_org uuid := public.app_current_org()");
    expect(release).toContain("organization_id = v_org");
    expect(release).toContain("for update");
    expect(release).toContain("o.organization_id is distinct from v_org");
    expect(release).toContain("no organization in session");
    expect(release).toContain("schedule feasibility did not return a decision");
    expect(release).toContain("f ? 'error'");
    expect(release).toContain("(f->>'blocking_failures')::int > 0");
    expect(release).toContain(
      "coalesce(p_acknowledge_warnings, false) is not true",
    );
    expect(release).toContain("only draft options can be released");
  });

  it("makes released and discarded status unreachable except through that door", () => {
    expect(guard).toContain("a released weekly schedule is frozen");
    expect(guard).toContain("a released weekly schedule cannot be deleted");
    expect(guard).toContain("cannot move between tenants");
    expect(guard).toContain("schedule_options cannot be truncated");
    expect(guard).toContain(
      "releasing or discarding a weekly schedule is only release_schedule_option",
    );
    expect(guard).toContain("new.status in ('released', 'discarded')");
    expect(guard).toContain("syncai.schedule_freeze");
    expect(executable).toContain(
      "before insert or update or delete on public.schedule_options",
    );
    expect(executable).toContain(
      "for each row execute function public.guard_schedule_option_freeze()",
    );
    expect(executable).toContain("before truncate on public.schedule_options");
    expect(executable).toContain(
      "revoke all on function public.guard_schedule_option_freeze()",
    );
    expect(executable).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.guard_schedule_option_freeze/i,
    );
  });

  it("reads receipts only for the session tenant and does not freeze from the reader", () => {
    expect(reader).toContain("v_org uuid := public.app_current_org()");
    expect(reader).toContain("auth.uid() is null or v_org is null");
    expect(reader).toContain("a.organization_id = v_org");
    expect(reader).toContain("where organization_id = v_org");
    expect(reader).toContain("'schedule_frozen'");
    expect(reader).not.toContain("update public.schedule_options");
    expect(reader).not.toContain("insert into public.audit_events");
    expect(reader).not.toContain("set_config");
    expect(executable).toContain(
      "revoke all on function public.get_schedule_freeze_receipts()",
    );
    expect(executable).toContain(
      "grant execute on function public.get_schedule_freeze_receipts()",
    );
    expect(executable).toContain("to authenticated");
  });

  it("is the last definition of the two-argument freeze door", () => {
    const dir = path.join(root, "supabase/migrations");
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    let last = "";
    const pattern =
      /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?release_schedule_option\s*\(([\s\S]*?)\)/gi;
    for (const file of files) {
      const sql = stripComments(readFileSync(path.join(dir, file), "utf8"));
      if (pattern.test(sql)) last = file;
      pattern.lastIndex = 0;
    }
    expect(last).toBe("20271109120000_schedule_freeze_audit.sql");
  });

  it("keeps the customer freeze on the scheduler and the receipt on the scheduling page", () => {
    const panel = readFileSync(
      path.join(root, "src/components/SchedulerPanel.tsx"),
      "utf8",
    );
    const page = readFileSync(
      path.join(root, "src/pages/SchedulingPage.tsx"),
      "utf8",
    );
    const receipt = readFileSync(
      path.join(root, "src/components/ScheduleFreezeReceipt.tsx"),
      "utf8",
    );
    const service = readFileSync(
      path.join(root, "src/services/scheduleFreezeService.ts"),
      "utf8",
    );
    expect(panel).toContain('"release_schedule_option"');
    expect(panel).toContain("p_acknowledge_warnings: true");
    expect(panel).not.toContain("ai_admin");
    expect(page).toContain("<ScheduleFreezeReceipt />");
    expect(receipt).not.toContain("supabase.rpc");
    expect(receipt).not.toContain('"release_schedule_option"');
    expect(receipt).not.toContain('"evaluate_schedule_feasibility"');
    expect(service).toContain('"get_schedule_freeze_receipts"');
    expect(service).toMatch(
      /export async function getScheduleFreezeReceipts\([\s\S]*get_schedule_freeze_receipts/,
    );
  });
});

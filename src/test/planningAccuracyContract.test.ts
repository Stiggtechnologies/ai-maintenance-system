/**
 * C6.14 planning accuracy. The percentage is a sealed comparison of the
 * applied job plan's labour hours with named-human task actuals, after
 * governed closeout. It is not closeout labour, and it is not a client
 * status change.
 *
 * The paired sample below is the reason absolute error and bias are both
 * reported. Planned 10 / actual 15 and planned 10 / actual 5 have signed
 * percentage errors of +50 and -50, so bias is 0 while mean absolute error
 * is 50. A single average would call that perfect planning.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271110140000_planning_accuracy_seal.sql",
  "utf8",
);
const panel = readFileSync(
  "src/components/WorkOrderPlanningPanel.tsx",
  "utf8",
);
const plans = readFileSync("src/components/JobPlans.tsx", "utf8");
const service = readFileSync("src/services/jobPlanService.ts", "utf8");

function planningAccuracyStats(
  rows: { planned: number; actual: number }[],
): { mape: number; bias: number; within10: number } {
  const n = rows.length;
  const mape =
    rows.reduce(
      (sum, row) => sum + (Math.abs(row.actual - row.planned) / row.planned) * 100,
      0,
    ) / n;
  const bias =
    rows.reduce(
      (sum, row) => sum + ((row.actual - row.planned) / row.planned) * 100,
      0,
    ) / n;
  const within10 =
    (100 *
      rows.filter(
        (row) => Math.abs(row.actual - row.planned) / row.planned <= 0.1,
      ).length) /
    n;
  return { mape, bias, within10 };
}

describe("planning accuracy seal contract", () => {
  it("keeps absolute error and bias from cancelling each other", () => {
    const stats = planningAccuracyStats([
      { planned: 10, actual: 15 },
      { planned: 10, actual: 5 },
    ]);
    expect(stats.bias).toBe(0);
    expect(stats.mape).toBe(50);
    expect(stats.within10).toBe(0);
  });

  it("measures only sealed same-tenant receipts and keeps the existing 10 percent band", () => {
    expect(migration).toContain("from public.planning_accuracy_receipts");
    expect(migration).toContain(
      "abs(actual_hours - planned_hours) / planned_hours * 100",
    );
    expect(migration).toContain(
      "(actual_hours - planned_hours) / planned_hours * 100",
    );
    expect(migration).toContain(
      "abs(actual_hours - planned_hours) / planned_hours <= 0.10",
    );
    expect(migration).toContain("where organization_id = v_org");
    expect(migration).toContain("'excluded_open_with_plan'");
    expect(migration).toContain("'excluded_closed_unsealed'");
    expect(migration).toContain("'excluded_client_completed'");
    expect(migration).toContain("'excluded_closed_without_plan'");
    expect(migration).toContain("w.closed_at is null");
    expect(migration).not.toContain("release_equipment");
    expect(migration).not.toContain("accept_equipment");
    expect(migration).not.toContain("set status");
  });

  it("is tenant-scoped, append-only, audited, and refused to machine roles", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("planning accuracy receipts are append-only");
    expect(migration).toContain(
      "planning accuracy receipt work order must belong to the receipt organization",
    );
    expect(migration).toContain(
      "planning accuracy recorder must belong to the receipt organization",
    );
    expect(migration).toContain("revoke insert, update, delete, truncate");
    expect(migration).toContain(
      "for select to authenticated",
    );
    expect(migration).toContain("organization_id = public.app_current_org()");
    expect(migration).toContain("'planning_accuracy'");
    expect(migration).toContain("'task_actual_recorded'");
    expect(migration).toContain("'action', 'sealed'");
    expect(migration).toContain("auth.uid()");
    expect(migration).not.toContain("'ai_admin'");
    expect(migration).toContain(
      "recording task actuals requires a named maintenance or planning role",
    );
    expect(migration).toContain(
      "sealing planning accuracy requires a named maintenance or planning role",
    );
    expect(migration).toContain("task actuals are recorded only through record_task_actual");
    expect(migration).toContain(
      "governed closeout must complete this work order before planning accuracy can be sealed",
    );
    expect(migration).toContain("w.planned_hours is distinct from v_planned");
    expect(migration).toContain("up.organization_id = v_org");
    expect(migration).toContain("revoke all on function public.seal_planning_accuracy(uuid) from public, anon");
    expect(migration).toContain("revoke all on function public.record_task_actual(uuid, numeric, text)");
    expect(migration).toContain("revoke all on function public.get_planning_accuracy() from public, anon");
  });

  it("is reachable from the work order and job plan surfaces", () => {
    expect(panel).toContain('call("seal_planning_accuracy"');
    expect(panel).toContain('call("record_task_actual"');
    expect(panel).toContain("does not complete the work order or return equipment to service");
    expect(service).toContain('callRpc<PlanningAccuracy>("get_planning_accuracy"');
    expect(plans).toContain("getPlanningAccuracy");
    expect(plans).toContain("Excluded:");
  });
});

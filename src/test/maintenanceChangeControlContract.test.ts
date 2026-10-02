import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("C5.10/C5.11/C5.17 governed maintenance change control", () => {
  const sql = read(
    "supabase/migrations/20270101470000_maintenance_change_control.sql",
  );

  it("extends the canonical work, approval, risk and audit models", () => {
    expect(sql).toContain("alter table public.work_orders");
    expect(sql).toContain("alter table public.approvals");
    expect(sql).toContain("public.risks");
    expect(sql).toContain("public.risk_acceptances");
    expect(sql).toContain("insert into public.audit_events");
    expect(sql).toContain("insert into public.work_order_status_history");
    expect(sql).not.toMatch(
      /create\s+table[^;]+(maintenance.?change|deferral|safety.?critical.?work|approval.?queue|audit.?log)/i,
    );
  });

  it("keeps all three decision rights live and human-approved", () => {
    for (const right of [
      "change_pm_interval",
      "defer_critical_work",
      "schedule_safety_critical_work",
    ]) {
      expect(sql).toContain(`right_key='${right}'`);
    }
    expect(sql).toContain("tier='approval'");
    expect(sql).toContain("enforcement='enforced'");
    expect(sql).toContain("required_authority='maintenance_manager'");
    expect(sql).toContain("v_role='ai_admin'");
    expect(sql).toContain("requested_by=auth.uid()");
  });

  it("models critical-work deferral as a versioned approval with current accepted risk", () => {
    expect(sql).toContain(
      "create or replace function public.request_critical_work_deferral",
    );
    expect(sql).toContain("w.risk_id is null");
    expect(sql).toContain("subject_type='risk'");
    expect(sql).toContain("subject_id=w.risk_id");
    expect(sql).toContain("accepted_by=auth.uid()");
    expect(sql).toContain("expires_at>now()");
    expect(sql).toContain("control_revision");
    expect(sql).toContain("deferred_until");
    expect(sql).toContain("deferral_approval_id");
  });

  it("creates and reschedules safety-critical work only through the governed approval", () => {
    expect(sql).toContain(
      "create or replace function public.request_safety_critical_work",
    );
    expect(sql).toContain(
      "create or replace function public.request_safety_critical_reschedule",
    );
    expect(sql).toContain(
      "create or replace function public.decide_maintenance_change_control",
    );
    expect(sql).toContain("app.maintenance_change_control_write");
    expect(sql).toMatch(
      /create\s+trigger\s+trg_governed_work_control/i,
    );
    expect(sql).toMatch(/before\s+insert\s+or\s+update/i);
    expect(sql).toContain("safety_flag");
    expect(sql).toContain("scheduled_date");
    expect(sql).toContain("due_date");
  });

  it("routes late safety classification from the canonical job-plan path into approval", () => {
    expect(sql).toContain("create or replace function public.apply_job_plan");
    expect(sql).toContain("a permit-bearing plan cannot first classify work as safety-critical after execution or closure");
    expect(sql).toContain("schedule_approval_required");
    expect(sql).toContain("status=case when v_permits>0 then 'approval' else status end");
    expect(sql).toContain("status=case when w.status='approval' then 'scheduled' else status end");
    expect(sql).toContain("new.safety_flag is distinct from old.safety_flag");
  });

  it("fails closed for stale, cross-tenant, self-approved and wrong-role acts", () => {
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("request snapshot is stale");
    expect(sql).toContain("cannot approve your own maintenance change request");
    expect(sql).toContain("requires a named maintenance manager or administrator");
    expect(sql).toContain("same-tenant work order not found");
    expect(sql).toContain("same-tenant asset not found");
  });

  it("is reachable from Decision Governance through one typed service", () => {
    const page = read("src/pages/DecisionGovernance.tsx");
    const panel = read("src/components/MaintenanceChangeControlPanel.tsx");
    const service = read("src/services/maintenanceChangeControlService.ts");

    expect(page).toContain("MaintenanceChangeControlPanel");
    expect(panel).toContain("requestCriticalWorkDeferral");
    expect(panel).toContain("requestSafetyCriticalWork");
    expect(panel).toContain("requestSafetyCriticalReschedule");
    expect(panel).toContain("decideMaintenanceChangeControl");
    expect(service).toContain('"get_maintenance_change_control_workspace"');
    expect(service).toContain('"request_critical_work_deferral"');
    expect(service).toContain('"request_safety_critical_work"');
    expect(service).toContain('"request_safety_critical_reschedule"');
    expect(service).toContain('"decide_maintenance_change_control"');
  });

  it("credits the existing PM-interval path only with its runtime evidence", () => {
    const register = read("docs/enterprise-readiness/capability-register.md");
    const smoke = read("scripts/ci-asset-strategy-agent-smoke.sh");
    expect(smoke).toContain("adopt_asset_strategy_assessment");
    expect(smoke).toContain("programmeChanged");
    expect(register).toMatch(/\| C5\.10 [^\n]+\| ✅/);
    expect(register).toMatch(/\| C5\.11 [^\n]+\| ✅/);
    expect(register).toMatch(/\| C5\.17 [^\n]+\| ✅/);
  });
});

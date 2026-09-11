import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const migration=readFileSync("supabase/migrations/20261219138000_pm_task_effectiveness.sql","utf8");
const modal=readFileSync("src/components/WorkOrderCloseoutModal.tsx","utf8");
const service=readFileSync("src/services/workOrderCloseout.ts","utf8");
const monitoring=readFileSync("src/components/ConditionMonitoring.tsx","utf8");
describe("direct PM effectiveness contract",()=>{
  it("terminates every PL/pgSQL function body",()=>{
    expect(migration.match(/end;\n\$\$;/g)).toHaveLength(2);
  });
  it("makes closeout type-aware and removes direct client access to the failure-only legacy path",()=>{
    expect(migration).toContain("w.work_type='corrective'");
    expect(migration).toContain("w.work_type='preventive'");
    expect(migration).toContain("revoke all on function public.close_work_order(");
    expect(service).toContain('supabase.rpc("close_work_order_v2"');
    expect(modal).toContain("isPreventive");
    expect(modal).toContain("Target failure mechanism");
  });
  it("records a named-human direct finding against a governed mechanism",()=>{
    expect(migration).toContain("public.pm_task_outcomes");
    expect(migration).toContain("target_mechanism_id");
    expect(migration).toContain("finding_outcome");
    expect(migration).toContain("finding_detail");
    expect(migration).toContain("recorded_by");
    expect(migration).toContain("auth.uid()");
  });
  it("matches numerator and observation window to the same coded mechanism",()=>{
    expect(migration).toContain("f.failure_mechanism_id=o.target_mechanism_id");
    expect(migration).toContain("f.mechanism_coded_by is not null");
    expect(migration).toContain("length(btrim(f.mechanism_note)),0)>=10");
    expect(migration).toContain("f.asset_id=w.asset_id");
    expect(migration).toContain("w.completed_at+make_interval(days=>v_days)");
    expect(migration).toContain("or post_pm_failure as mature");
    expect(migration).toContain("falseReassuranceRatePct");
  });
  it("is tenant-bound, read-only to clients, and reachable",()=>{
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("pm_task_outcomes_read");
    expect(migration).toContain("revoke insert,update,delete,truncate");
    expect(monitoring).toContain('supabase.rpc("get_pm_task_effectiveness"');
    expect(monitoring).not.toContain("pm?.finding_rate_pct");
    expect(monitoring).not.toContain("pm?.missed_rate_pct");
    expect(modal).toContain("Inspection evidence");
  });
  it("fails closed for an absent role and states the recurrence clock honestly",()=>{
    expect(migration).toContain("if v_role is null or v_role not in");
    expect(migration).toContain("work-order created_at is a detection/recording timestamp, not a claimed failure-occurrence timestamp");
    expect(monitoring).toContain("Post-PM corrective recurrence");
  });
});

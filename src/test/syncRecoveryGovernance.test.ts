import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "supabase/migrations/20260921090000_sync_recovery.sql";
const SECURITY =
  "supabase/migrations/20260921090100_sync_recovery_security.sql";
const sql = readFileSync(MIGRATION, "utf8");
const lower = sql.toLowerCase().replace(/\s+/g, " ");
const security = readFileSync(SECURITY, "utf8").toLowerCase();
const approvalQueue = readFileSync("src/components/ApprovalQueue.tsx", "utf8");

const RECOVERY_TABLES = [
  "restoration_events",
  "restoration_event_work",
  "restoration_constraints",
  "restoration_blockers",
  "restoration_plan_versions",
];

const DEFINER_FUNCTIONS = [
  "recovery_role_allowed(text[])",
  "open_restoration_event(uuid,text,text)",
  "set_restoration_baseline(uuid,timestamptz,text,text)",
  "add_restoration_work(uuid,uuid,text)",
  "include_restoration_candidate(uuid,text)",
  "sequence_restoration_work(uuid,int)",
  "verify_restoration_parallel_group(uuid,uuid[],text,text)",
  "add_restoration_constraint(uuid,uuid,text,text,boolean,text,text,text,uuid)",
  "set_restoration_constraint_state(uuid,text,text)",
  "record_restoration_blocker(uuid,uuid,text,text,text,text,timestamptz,numeric,text)",
  "resolve_restoration_blocker(uuid,text)",
  "generate_restoration_plan(uuid)",
  "submit_restoration_plan_for_approval(uuid)",
  "release_restoration_plan(uuid)",
  "start_restoration_work(uuid)",
  "complete_restoration_work(uuid,numeric,text,jsonb)",
  "close_restoration_event(uuid,text)",
  "get_recovery_board()",
  "get_recovery_event(uuid)",
  "get_recovery_opportunities(uuid,numeric)",
];

function functionBody(name: string): string {
  const start = lower.indexOf(`function public.${name.toLowerCase()}(`);
  expect(start, `${name} function not found`).toBeGreaterThan(-1);
  const next = lower.indexOf("create or replace function", start + 20);
  return lower.slice(start, next === -1 ? lower.length : next);
}

describe("Sync Recovery extends the canonical operating system", () => {
  it("uses restoration-domain tables only, not duplicate approval/audit/work-order stores", () => {
    for (const table of RECOVERY_TABLES) {
      expect(lower).toContain(`create table if not exists ${table}`);
    }
    for (const forbidden of [
      "restoration_approvals",
      "recovery_approvals",
      "restoration_audit",
      "recovery_audit",
      "restoration_work_orders",
      "recovery_work_orders",
      "restoration_materials",
      "recovery_materials",
    ]) {
      expect(lower).not.toContain(`create table if not exists ${forbidden}`);
    }
    expect(lower).toContain("references work_orders(id)");
    expect(lower).toContain("references autonomous_decisions(id)");
    expect(lower).toContain("from equipment_releases");
    expect(lower).toContain("from work_order_materials");
  });

  it("makes every Recovery table tenant-readable but direct-write closed", () => {
    for (const table of RECOVERY_TABLES) {
      expect(lower).toContain(`alter table ${table} enable row level security`);
      expect(lower).toContain(
        `create policy ${table}_org_read on ${table} for select to authenticated using (organization_id=public.app_current_org())`,
      );
      expect(lower).not.toMatch(
        new RegExp(
          `create policy [^;]+ on ${table} (?:for (?:insert|update|delete|all)|to authenticated with check)`,
        ),
      );
    }
  });
});

describe("fail-closed planning contracts", () => {
  it("never infers parallel work", () => {
    expect(lower).toContain("concurrency_rule text not null default 'unknown'");
    expect(lower).toContain(
      "concurrency_rule in ('unknown','sequential_only','verified_parallel')",
    );
    const generate = functionBody("generate_restoration_plan");
    expect(generate).toContain(
      "bool_and(concurrency_rule='verified_parallel')",
    );
    expect(generate).toContain(
      "unknown concurrency is scheduled sequentially until a human verifies parallel execution",
    );
  });

  it("requires named human evidence before parallelization", () => {
    const verify = functionBody("verify_restoration_parallel_group");
    expect(verify).toContain("length(trim(p_basis)),0)<20");
    expect(verify).toContain("hard planning constraints must be resolved");
    expect(verify).toContain("concurrency_verified_by=auth.uid()");
    expect(verify).toContain("concurrency_verified_at=now()");
  });

  it("does not invent duration percentiles", () => {
    const generate = functionBody("generate_restoration_plan");
    expect(generate).toContain("case when h.n>=5 then h.p80");
    expect(generate).toContain("when w.planned_hours>0 then w.planned_hours");
    expect(generate).toContain("when w.estimated_hours>0 then w.estimated_hours");
    expect(generate).toContain("else 'missing' end duration_basis");
    expect(generate).toContain("case when bool_and(hist_n>=5) then");
  });

  it("freezes the value counterfactual at first planning", () => {
    const baseline = functionBody("set_restoration_baseline");
    const generate = functionBody("generate_restoration_plan");
    expect(baseline).toContain("baseline_frozen_at is not null");
    expect(baseline).toContain("do not rewrite the counterfactual");
    expect(generate).toContain("baseline_frozen_at=now()");
  });

  it("blocks approval on missing inputs or unresolved hard planning constraints", () => {
    const submit = functionBody("submit_restoration_plan_for_approval");
    expect(submit).toContain("jsonb_array_length(p.missing_inputs)>0");
    expect(submit).toContain("p.unresolved_planning_hard_constraints>0");
  });
});

describe("approval and scope-growth controls", () => {
  it("hands plan release into the canonical decision/workflow chain", () => {
    const submit = functionBody("submit_restoration_plan_for_approval");
    expect(submit).toContain("insert into autonomous_decisions");
    expect(submit).toContain("insert into approval_workflows");
    expect(submit).toContain("'release_restoration_plan'");
    expect(submit).toContain("'advisory'");
  });

  it("labels Recovery approval completeness as a contract, not outcome probability", () => {
    const submit = functionBody("submit_restoration_plan_for_approval");
    expect(submit).toContain(
      "deterministic contract completeness; not probability of outcome",
    );
    expect(approvalQueue).toContain(
      'decision.decision_type === "release_restoration_plan"',
    );
    expect(approvalQueue).toContain("Deterministic contract complete");
  });

  it("enforces segregation of duties at release", () => {
    const release = functionBody("release_restoration_plan");
    expect(release).toContain("d.status<>'approved'");
    expect(release).toContain("d.approved_by=p.generated_by");
    expect(release).toContain("segregation of duties");
    expect(release).toContain("insert into autonomous_actions");
  });

  it("keeps released plan evidence immutable", () => {
    const protect = functionBody("protect_released_restoration_plan");
    expect(protect).toContain("old.status='released'");
    expect(protect).toContain("new.status='superseded'");
    expect(protect).toContain("to_jsonb(new)-'status'");
    expect(protect).toContain("released restoration plans are immutable");
  });

  it("quarantines scope growth until a revised released plan contains it", () => {
    const add = functionBody("add_restoration_work");
    const start = functionBody("start_restoration_work");
    expect(add).toContain(
      "when e.status in ('released','executing','return_pending') then 'candidate'",
    );
    expect(add).toContain("'scope_growth'");
    expect(start).toContain("from jsonb_array_elements(p.schedule)");
    expect(start).toContain("scope item is not in the currently released plan");
  });
});

describe("execution and return-to-service gates", () => {
  it("rechecks materials and canonical release/isolation before field start", () => {
    const start = functionBody("start_restoration_work");
    expect(start).toContain("from work_order_materials");
    expect(start).toContain("status in ('requested','short')");
    expect(start).toContain("from equipment_releases r");
    expect(start).toContain("r.isolation_confirmed");
    expect(start).toContain("from job_plan_permits");
  });

  it("requires every job-plan quality check to pass before work completion", () => {
    const complete = functionBody("complete_restoration_work");
    expect(complete).toContain("from job_plan_checks");
    expect(complete).toContain("lower(coalesce(r->>'result',''))='pass'");
    expect(complete).toContain("v_passed<>v_checks");
    expect(complete).toContain("completion_quality_evidence");
  });

  it("requires operations handback to be accepted before event closure", () => {
    const close = functionBody("close_restoration_event");
    expect(close).toContain("from equipment_releases");
    expect(close).toContain("status in ('released','returned')");
    expect(close).toContain("has not been accepted by operations");
  });

  it("records value as projected, never self-verifies the counterfactual", () => {
    const close = functionBody("close_restoration_event");
    expect(close.match(/'projected'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(close).toContain("projected until human verification");
    expect(close).not.toContain("'verified'");
  });
});

describe("the existing opportunity engine becomes reachable without a second implementation", () => {
  it("Recovery delegates to find_opportunity_work", () => {
    const opportunities = functionBody("get_recovery_opportunities");
    expect(opportunities).toContain("return public.find_opportunity_work");
    expect(opportunities).not.toContain("from work_orders");
  });
});

describe("privileged RPCs are not anonymously executable", () => {
  it.each(DEFINER_FUNCTIONS)("revokes %s from PUBLIC and anon", (signature) => {
    expect(security).toContain(
      `revoke all on function public.${signature} from public, anon;`,
    );
  });
});

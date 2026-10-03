import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101120000_planner_agent_execution.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/jobPlanService.ts", "utf8");
const surface = readFileSync("src/components/JobPlans.tsx", "utf8");
const workforce = readFileSync("src/pages/AIWorkforcePage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-planning-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Planning & Scheduling agent execution", () => {
  it("uses the canonical job-plan and agent-run families", () => {
    expect(migration).toContain(
      "create or replace function public.run_planning_agent",
    );
    expect(migration).toContain("insert into public.job_plans");
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).toContain("insert into public.job_plan_steps");
    expect(migration).toContain("insert into public.job_plan_materials");
    expect(migration).not.toContain(
      "create table if not exists planning_agent_runs",
    );
  });

  it("fails closed on tenancy, role and per-agent controls", () => {
    expect(migration).toContain(
      "where id = p_work_order_id and organization_id = v_org",
    );
    expect(migration).toContain("requires a named human planning");
    expect(migration).toContain("evaluate_agent_control_internal");
    expect(migration).toContain("draft_job_plans");
    expect(migration).toContain("identify_missing_materials_docs");
    expect(migration).toContain("control profile changed during the run");
    expect(migration).toContain("retained agent runs are immutable");
  });

  it("never invents absent planning inputs or claims execution authority", () => {
    expect(migration).toContain("the agent did not invent one");
    expect(migration).toContain("absence is not treated as readiness");
    expect(migration).toContain("'may_adopt',false");
    expect(migration).toContain("'may_apply',false");
    expect(migration).toContain("'may_release_schedule',false");
    expect(migration).toContain("never overwrite an existing human draft");
    expect(migration).toContain(
      "never commit spend or return equipment to service",
    );
  });

  it("is reachable from the job-plan editor and AI Workforce charter", () => {
    expect(service).toContain('"run_planning_agent"');
    expect(service).toContain('from("job_plan_documents")');
    expect(surface).toContain("Run Planning agent");
    expect(surface).toContain("PlanningAgentReading");
    expect(workforce).toContain("operating_charter");
    expect(workforce).toContain("Operating limits");
  });

  it("keeps a runtime proof in the clean migration-chain gate", () => {
    expect(smoke).toContain("exact_source_copy=true");
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("immutable_run=true");
    expect(smoke).toContain("no_execution_authority=true");
    expect(workflow).toContain("bash scripts/ci-planning-agent-smoke.sh");
  });

  it("advances exactly the completed planning capabilities with evidence", () => {
    for (const id of ["C1.04", "C1.05", "C5.02", "C5.03", "C9.02"]) {
      expect(register).toMatch(
        new RegExp(
          `\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅[^\\n]+`,
          "i",
        ),
      );
    }
  });
});

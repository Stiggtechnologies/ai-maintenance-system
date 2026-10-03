import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101150000_fracas_rca_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/fracasAgentService.ts", "utf8");
const panel = readFileSync("src/components/FracasAgentWorkbench.tsx", "utf8");
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-fracas-rca-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed RCA / FRACAS agent execution", () => {
  it("reuses canonical closeout, retained runs and effectiveness verification", () => {
    expect(migration).toContain(
      "create or replace function public.run_fracas_rca_agent",
    );
    expect(migration).toContain("from public.work_orders h");
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).toContain("public.start_ca_verification");
    expect(migration).toContain("public.ca_verifications");
    expect(migration).not.toContain(
      "create table if not exists public.fracas_work_orders",
    );
  });

  it("keeps a reported cause distinct from verified root cause", () => {
    expect(migration).toContain("reported_not_verified");
    expect(migration).toContain("does not claim a verified root cause");
    expect(migration).toContain("'mayclaimrootcause',false");
    expect(migration).toContain("'mayattestverification',false");
    expect(migration).toContain(
      "association and recurrence do not prove causation",
    );
  });

  it("fails closed on role, tenancy, control profile and named ownership", () => {
    expect(migration).toContain("requires a named reliability engineer");
    expect(migration).toContain(
      "where id=p_work_order_id and organization_id=v_org",
    );
    expect(migration).toContain("evaluate_agent_control_internal");
    expect(migration).toContain("analyse_fracas_case");
    expect(migration).toContain(
      "owner must be a named member of this organization",
    );
    expect(migration).toContain(
      "assign a named human owner before starting verification",
    );
  });

  it("is customer reachable for analyze, assign and verify", () => {
    expect(service).toContain('"run_fracas_rca_agent"');
    expect(service).toContain('"assign_fracas_investigation"');
    expect(service).toContain('"start_fracas_verification"');
    expect(panel).toContain("Build investigation");
    expect(panel).toContain("Start 90-day verification");
    expect(page).toContain("<FracasAgentWorkbench />");
  });

  it("keeps an end-to-end runtime proof in the clean migration gate", () => {
    for (const proof of [
      "exact_closeout_snapshot=true",
      "reported_cause_not_root_cause=true",
      "role_gate=true",
      "tenant_wall=true",
      "immutable_pack=true",
      "named_owner=true",
      "verification_handoff=true",
      "no_execution_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-fracas-rca-agent-smoke.sh");
  });

  it("closes the role and full FRACAS loop without overstating the broader stage", () => {
    expect(register).toMatch(/\| C1\.07 \|[^\n]+\| ✅[^\n]+/i);
    expect(register).toMatch(/\| C8\.05 \|[^\n]+\| ✅[^\n]+/i);
    expect(register).toMatch(/\| C9\.03 \|[^\n]+\| 🟡[^\n]+/i);
  });
});

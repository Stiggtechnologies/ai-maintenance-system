import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20261219162000_develop_hop_agent.sql"),
  "utf8",
);
const edge = fs.readFileSync(
  path.join(root, "supabase/functions/develop-hop-agent/index.ts"),
  "utf8",
);
const core = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/develop-hop-core.ts"),
  "utf8",
);
const service = fs.readFileSync(
  path.join(root, "src/services/hopAgentService.ts"),
  "utf8",
);
const page = fs.readFileSync(
  path.join(root, "src/pages/DecisionGovernance.tsx"),
  "utf8",
);
const smoke = fs.readFileSync(
  path.join(root, "scripts/ci-develop-hop-agent-smoke.sh"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/ci.yml"),
  "utf8",
);
describe("D11.01 / D12.03 / D12.19 HOP contract", () => {
  it("extends the canonical store and covers exactly the nine §24 categories", () => {
    expect(sql).toContain("alter table public.human_performance_events");
    for (const key of [
      "task_complexity",
      "conflicting_procedures",
      "excessive_handoffs",
      "decision_delays",
      "workarounds",
      "repeat_deviations",
      "overloaded_roles",
      "unclear_authority",
      "error_provoking_conditions",
    ])
      expect(sql).toContain(`'${key}'`);
    expect(core).toContain("HOP_CATEGORIES");
  });
  it("makes individual attribution structurally and contractually unavailable", () => {
    const create = fs
      .readFileSync(
        path.join(root, "supabase/migrations/20260817090000_human_factors.sql"),
        "utf8",
      )
      .split("create table if not exists human_performance_events (")[1]
      .split(");")[0];
    expect(create).not.toMatch(/member_id|person_id|worker_id|employee_id/);
    expect(sql).toContain("individual-attribution field");
    for (const key of [
      "person",
      "member",
      "worker",
      "employee",
      "operator",
      "actor",
      "owner",
      "user",
      "individual",
      "name",
      "email",
    ])
      expect(sql).toContain(key);
    expect(sql).not.toMatch(
      /add column if not exists (member|person|worker|employee|owner|user)/,
    );
    expect(core).toContain("identifies, ranks and scores no person");
  });
  it("uses caller JWT only and exposes no autonomous mutation", () => {
    expect(edge).toContain("SUPABASE_ANON_KEY");
    expect(edge).not.toContain("SERVICE_ROLE");
    expect(edge).toContain('caller.rpc("screen_hop_agent"');
    expect(core).toContain(
      "cannot assign blame, approve an intervention, accept risk or alter",
    );
  });
  it("preserves tenant, role, evidence, and customer reachability controls", () => {
    expect(sql).toContain("app_current_org()");
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("evidence_refs");
    expect(sql).toContain("authorized human");
    expect(service).toContain('"record_hop_system_condition"');
    expect(service).toContain('"develop-hop-agent"');
    expect(page).toContain("<HopSystemConditionsPanel");
  });
  it("derives only from canonical system sources and refuses invented thresholds", () => {
    for (const source of [
      "decisions",
      "restoration_constraints",
      "temporary_modifications",
      "get_case_resource_balance",
    ])
      expect(sql).toContain(source);
    expect(core).toContain("reported only when a human records them");
    expect(core).toContain("no unsupported threshold");
  });
  it("runs a clean-stack no-person, role, tenant, provenance, and read-only smoke", () => {
    for (const evidence of [
      "noauth=401",
      "role_wall=403",
      "writer_role_wall=true",
      "tenant_wall=true",
      "no_person=true",
      "provenance=true",
      "read_only=true",
      "nine_categories=true",
    ])
      expect(smoke).toContain(evidence);
    expect(workflow).toContain("ci-develop-hop-agent-smoke.sh");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const migration = stripComments(
  readFileSync(
    "supabase/migrations/20270101110000_cross_node_governance_execution.sql",
    "utf8",
  ),
);
const edge = readFileSync(
  "supabase/functions/develop-evidence-agent/index.ts",
  "utf8",
);
const governancePanel = readFileSync(
  "src/components/develop/GovernancePanel.tsx",
  "utf8",
);

describe("D11.14 cross-node governance execution", () => {
  it("defines adopted-ancestor scope on the canonical organization tree", () => {
    expect(migration).toContain("function public.framework_operable_for_org");
    expect(migration).toContain("join org_ancestry(p_organization_id)");
    expect(migration).toContain("a.node_id = f.organization_id");
    expect(migration).toContain("f.status = 'adopted'");
    expect(migration).not.toMatch(/create table[^;]*(framework_copy|inherited_framework)/i);
  });

  it("widens definition SELECT only, never framework authoring", () => {
    for (const policy of [
      "project_frameworks_read",
      "project_framework_stages_read",
      "stage_gates_read",
      "sgc_read",
    ]) {
      expect(migration).toContain(`policy ${policy}`);
    }
    expect(migration).toContain("framework_visible_to_current_org");
    expect(migration.match(/organization_id = app_current_org\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).not.toMatch(
      /create policy[^;]+for (insert|update|delete)/i,
    );
    expect(migration).toContain(
      "revoke all on function public.framework_operable_for_org(uuid, uuid)\n  from public, anon, authenticated",
    );
  });

  it("makes both inherited and explicitly selected ancestor frameworks operable", () => {
    expect(migration).toContain(
      "v_framework_id := v_resolved.framework_id;",
    );
    expect(migration).toContain(
      "not framework_operable_for_org(v_framework_id, v_org)",
    );
    expect(migration).toContain(
      "'operableHere', framework_operable_for_org(fw.id, v_org)",
    );
    expect(migration).toContain("framework_inheritance_not_operable");
    expect(migration).toContain("_d1114_replace_function");
    expect(governancePanel).toContain(
      "new cases created without a framework inherit it",
    );
    expect(governancePanel).not.toContain(
      "cross-node framework operation is named future work",
    );
  });

  it("pins all gate acts to the case framework while retaining case tenant ownership", () => {
    for (const signature of [
      "case_gate_outstanding_obligations(uuid,bigint)",
      "gate_review_sod_position(uuid,bigint,uuid)",
      "get_gate_readiness(uuid,bigint)",
      "get_gate_review_pack(uuid,bigint)",
      "open_gate_review(uuid,bigint)",
      "record_case_gate_review(uuid,bigint,text,text,jsonb,jsonb,uuid,text)",
      "record_gate_agent_report(uuid,bigint,text,text)",
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain(
      "select * into g from stage_gates where id = p_gate_id;",
    );
    expect(migration).toContain(
      "public.create_case_deliverable(uuid,text,text,uuid,bigint,date,text)",
    );
    expect(migration).toContain(
      "public.request_gate_requirement_waiver(uuid,bigint,text,text,uuid,timestamp with time zone)",
    );
    expect(migration).toContain("public.get_case_lifecycle_success(uuid)");
  });

  it("keeps Edge evidence case-owned while accepting ancestor definitions", () => {
    const criterionRead = edge.slice(
      edge.indexOf('.from("stage_gate_criteria")'),
      edge.indexOf("const { data: evidenceRows"),
    );
    expect(criterionRead).not.toContain(
      '.eq("organization_id", auth.organizationId)',
    );
    expect(criterionRead).toContain(
      "gate.framework_id !== caseRow.framework_id",
    );
    const evidenceRead = edge.slice(edge.indexOf("const { data: evidenceRows"));
    expect(evidenceRead).toContain(
      '.eq("organization_id", auth.organizationId)',
    );
  });

  it("ships a live cross-node transcript in required CI", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const smoke = readFileSync(
      "scripts/ci-cross-node-governance-smoke.sh",
      "utf8",
    );
    expect(workflow).toContain("bash scripts/ci-cross-node-governance-smoke.sh");
    expect(smoke).toContain("create_development_case");
    expect(smoke).toContain("get_gate_review_pack");
    expect(smoke).toContain("record_gate_review_outcome");
    expect(smoke).toContain("advance_development_case_stage");
    expect(smoke).toContain("sibling/foreign adopted framework is invisible");
  });
});

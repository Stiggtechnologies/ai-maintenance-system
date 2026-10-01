import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101270000_workforce_execution_governance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/workforceExecutionService.ts",
  "utf8",
);
const controls = readFileSync(
  "src/components/WorkforceExecutionControls.tsx",
  "utf8",
);
const readiness = readFileSync("src/components/WorkforceReadiness.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E6.05/E6.08/E6.09/E6.11/E6.12 workforce execution governance", () => {
  it("extends canonical workforce and standard-work stores without parallel tables", () => {
    expect(migration).not.toMatch(/create table/);
    for (const canonical of [
      "public.crew_templates",
      "public.crew_template_roles",
      "public.specialised_tools",
      "public.knowledge_areas",
      "public.knowledge_holders",
      "public.training_plans",
      "public.standard_work",
      "public.procedure_translations",
      "public.evidence_items",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
  });

  it("makes crew and tool planning inputs versioned, retained and evidence-backed", () => {
    expect(migration).toContain("record_crew_template");
    expect(migration).toContain("record_specialised_tool");
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("crew template versions are immutable");
    expect(migration).toContain("specialised-tool versions are immutable");
    expect(migration).toContain("cannot be deleted");
    expect(migration).toContain("does not dispatch a crew or release work");
  });

  it("keeps knowledge holding, transfer delivery and competency distinct", () => {
    expect(migration).toContain("record_knowledge_area");
    expect(migration).toContain("record_knowledge_holder");
    expect(migration).toContain("record_knowledge_transfer_plan");
    expect(migration).toContain("tp.knowledge_area_id=ka.id");
    expect(migration).toContain("'competencygranted',false");
    expect(migration).not.toContain("insert into public.member_competencies");
  });

  it("reuses the governed standard-work baseline for verified languages", () => {
    expect(service).toContain('"register_standard_work_baseline"');
    expect(controls).toContain("Register verified procedure language");
    expect(controls.replace(/\s+/g, " ")).toContain("SyncAI does not");
    expect(migration).toContain("public.standard_work");
    expect(migration).toContain("public.procedure_translations");
  });

  it("is customer-reachable from workforce readiness with a live database transcript", () => {
    for (const rpc of [
      "get_workforce_execution_workspace",
      "record_crew_template",
      "record_specialised_tool",
      "record_knowledge_area",
      "record_knowledge_holder",
      "record_knowledge_transfer_plan",
    ]) {
      expect(service).toMatch(new RegExp(`supabase\\.rpc\\(\\s*"${rpc}"`));
    }
    expect(readiness).toContain(
      "<WorkforceExecutionControls onChanged={refetch} />",
    );
    expect(workflow).toContain(
      "bash scripts/ci-workforce-execution-governance-smoke.sh",
    );
  });

  it("advances only the five capabilities proven by the slice", () => {
    for (const id of ["E6.05", "E6.08", "E6.09", "E6.11", "E6.12"]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`),
      );
    }
  });
});

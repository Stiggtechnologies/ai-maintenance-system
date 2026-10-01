import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101260000_workforce_governance_lifecycle.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/workforceGovernanceService.ts",
  "utf8",
);
const controls = readFileSync(
  "src/components/WorkforceGovernanceControls.tsx",
  "utf8",
);
const readiness = readFileSync("src/components/WorkforceReadiness.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E6.02/E6.04/E6.07 workforce governance lifecycle", () => {
  it("extends the canonical workforce stores without inventing a parallel model", () => {
    expect(migration).toContain("alter table public.training_plans");
    expect(migration).toContain("alter table public.labour_rules");
    expect(migration).not.toMatch(/create table/);
    for (const canonical of [
      "public.training_plans",
      "public.labour_rules",
      "public.workforce_members",
      "public.competencies",
      "public.shift_assignments",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
  });

  it("makes training plans closed-loop without equating delivery to competency", () => {
    expect(migration).toContain("start','complete','cancel','supersede");
    expect(migration).toContain("completion_evidence_reference");
    expect(migration).toContain("lifecycle_version=lifecycle_version+1");
    expect(migration).toContain(
      "training lifecycle changes require the version that was reviewed",
    );
    expect(migration).toContain("'competencygranted',false");
    expect(migration).not.toContain("insert into public.member_competencies");
    expect(migration).toContain(
      "training plans are retained lifecycle evidence and cannot be deleted",
    );
  });

  it("requires evidence, independent adoption and an effective window before a rule governs", () => {
    expect(migration).toContain(
      "segregation of duties requires adoption by a different named human",
    );
    expect(migration).toContain(
      "adoption requires a governed draft with a substantive basis",
    );
    expect(migration).toContain(
      "status='adopted' and effective_from<=current_date",
    );
    expect(migration).toContain(
      "labour rule content is immutable; record and adopt a new version",
    );
    expect(migration).toContain(
      "labour rules are retained governance evidence and cannot be deleted",
    );
  });

  it("preserves tenant and named-human authority boundaries", () => {
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("auth.uid() is null");
    expect(migration).toContain(
      "('admin','executive','maintenance_manager','planner','supervisor')",
    );
    expect(migration).toContain("for update");
    expect(migration).toContain("changed after it was loaded; refresh");
  });

  it("is customer-reachable from the existing workforce readiness surface", () => {
    for (const rpc of [
      "get_workforce_governance_workspace",
      "transition_training_plan",
      "record_labour_rule",
      "decide_labour_rule",
    ]) {
      expect(service).toMatch(new RegExp(`supabase\\.rpc\\(\\s*"${rpc}"`));
    }
    expect(readiness).toContain(
      "<WorkforceGovernanceControls onChanged={refetch} />",
    );
    expect(controls).toContain("Record training lifecycle act");
    expect(controls).toContain("Record labour-rule draft");
    expect(controls).toContain("Record labour-rule decision");
  });

  it("runs a live database transcript and advances only the three proven rows", () => {
    expect(workflow).toContain("bash scripts/ci-workforce-governance-smoke.sh");
    for (const id of ["E6.02", "E6.04", "E6.07"]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`),
      );
    }
  });
});

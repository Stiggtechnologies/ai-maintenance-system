import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102030000_safety_critical_procedure_control.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const projectPanel = readFileSync(
  "src/components/develop/ProjectStandardPanel.tsx",
  "utf8",
);
const learningPanel = readFileSync(
  "src/components/develop/LearningRevisionPanel.tsx",
  "utf8",
);
const smoke = readFileSync("scripts/ci-project-fracas-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("C5.14 safety-critical procedure control contract", () => {
  it("reuses the canonical rule, decision-right, standard, approval, and audit stores", () => {
    expect(migration).toContain("engineering_approval_rules");
    expect(migration).toContain("safety_critical_procedure_change");
    expect(migration).toContain("alter_safety_procedures");
    expect(migration).toMatch(/enforcement\s*=\s*'enforced'/);
    expect(migration).toContain("alter table public.standard_work");
    expect(migration).toContain("engineering_change_class");
    expect(migration).toContain("public.approvals");
    expect(migration).toContain("public.audit_events");
    expect(migration).not.toMatch(/create table( if not exists)? public\./i);
  });

  it("makes safety classification monotonic and reachable only through governed request doors", () => {
    expect(migration).toContain("guard_safety_critical_standard_revision");
    expect(migration).toContain("syncai.safety_procedure_write");
    expect(migration).toContain(
      "request_safety_critical_project_standard_revision",
    );
    expect(migration).toContain(
      "request_safety_critical_learning_standard_revision",
    );
    expect(migration).toMatch(/cannot be downgraded/i);
    expect(migration).toMatch(/same-tenant/i);
  });

  it("requires the adopted rule and exact designated authority at either adoption door", () => {
    expect(migration).toContain("guard_standard_revision_approval");
    expect(migration).toMatch(/status\s*=\s*'adopted'/);
    expect(migration).toContain("required_authority");
    expect(migration).toContain("revision_requested_by");
    expect(migration).toMatch(/requester cannot decide/i);
    expect(migration).toMatch(/named same-tenant designated safety authority/i);
    expect(migration).toContain("safety_procedure_decision");
  });

  it("routes both customer-facing request services through the safety-specific RPCs", () => {
    expect(service).toContain("safetyCritical: boolean");
    expect(service).toContain(
      '"request_safety_critical_project_standard_revision"',
    );
    expect(service).toContain(
      '"request_safety_critical_learning_standard_revision"',
    );
    expect(service).toContain("safety_critical");
    expect(service).toContain("engineering_change_class");
  });

  it("makes classification and required authority visible before the human acts", () => {
    for (const panel of [projectPanel, learningPanel]) {
      expect(panel).toContain("Safety-critical procedure");
      expect(panel).toContain("Designated safety authority");
      expect(panel).toContain("safetyCritical");
    }
  });

  it("proves refusal and provenance in the authenticated clean-chain smoke", () => {
    for (const phrase of [
      "generic door cannot revise a classified safety-critical procedure",
      "requester cannot decide",
      "non-designated approver",
      "foreign tenant",
      "AI identity",
      "direct classification write",
      "safety classification cannot be downgraded",
      "safety_procedure_decision",
    ]) {
      expect(smoke.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(workflow.match(/ci-project-fracas-smoke\.sh/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("marks C5.14 green only with concrete runtime evidence", () => {
    const row = register
      .split("\n")
      .find((line) => line.includes("| C5.14 |"));
    expect(row).toContain("✅");
    expect(row).toContain("20270102030000_safety_critical_procedure_control.sql");
    expect(row).toContain("ci-project-fracas-smoke.sh");
  });
});

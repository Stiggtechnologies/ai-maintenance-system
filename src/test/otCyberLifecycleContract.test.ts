import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261219155000_develop_ot_cyber_lifecycle.sql", "utf8").toLowerCase();
const service = readFileSync("src/services/otCyberLifecycleService.ts", "utf8");
const panel = readFileSync("src/components/develop/OtCyberLifecyclePanel.tsx", "utf8");
const page = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-develop-ot-cyber-lifecycle-smoke.sh", "utf8");

describe("D4.13 OT cybersecurity by design", () => {
  it("pins the exact ten II.13 artifacts on the canonical requirement table", () => {
    for (const kind of ["cyber_requirement","architecture_review","segmentation","remote_access","vendor_access","firmware","patchability","backup","recovery","cyber_acceptance_test"]) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toContain("alter table public.design_requirements");
    expect(sql).toContain("category='cyber'");
    expect(sql).not.toMatch(/create table[^;]+ot_cyber/);
  });

  it("uses existing verification, evidence, acceptance-test and gate contracts", () => {
    expect(sql).toContain("from verification_obligations");
    expect(sql).toContain("o.evidence_id is not null");
    expect(sql).toContain("left join acceptance_tests");
    expect(sql).toContain("test_release_status='released'");
    expect(sql).toContain("case_gate_outstanding_obligations");
    expect(sql).toContain("enforce_gate_review_outstanding_obligations");
    expect(smoke).toContain("case_gate_outstanding_obligations");
  });

  it("keeps applicability and verification human, evidenced and refusal-first", () => {
    expect(sql).toContain("null does not mean not applicable");
    expect(sql).toContain("the ai-operator identity may identify an ot-cyber gap");
    expect(sql).toContain("achieved evidence-backed verification");
    expect(sql).toContain("cannot accept a test");
    expect(sql.match(/coalesce\(current_setting\('app\.ot_cyber_write',true\),''\)<>\s*'granted'/g)).toHaveLength(2);
    expect(smoke).toContain("unexpectedly succeeded");
  });

  it("is customer reachable through the case workspace", () => {
    expect(service).toContain('"get_case_ot_cyber_lifecycle"');
    expect(service).toContain('"record_case_ot_cyber_artifact"');
    expect(panel).toContain("OT cybersecurity by design");
    expect(panel).toContain("Add to the canonical requirement thread");
    expect(page).toContain("<OtCyberLifecyclePanel");
  });
});

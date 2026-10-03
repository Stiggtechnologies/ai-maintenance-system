import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const smoke = readFileSync("scripts/ci-develop-slice1-smoke.sh", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

describe("D11.34 MVP-90 integrated acceptance", () => {
  it("walks one development case through all twelve MVP capabilities", () => {
    expect(smoke).toContain(
      "D11.34 MVP-90 integrated acceptance passed: case=true framework_gate=true requirements=true deliverables=true evidence=true risk=true decision=true actions=true baselines=true gate_readiness=true operational_readiness=true evidence_agent=true human_authority_preserved=true",
    );

    for (const proof of [
      "get_development_case",
      "get_gate_readiness",
      "get_case_system_operational_readiness",
      "get_case_operational_readiness_index",
      "w['framework'] and w['stages']",
      "g['criteria']",
      "['deliverables','evidence','risks','decisions','actions','baselines']",
      "e.get('evidenceClass')=='AI_INFERENCE'",
    ]) {
      expect(smoke).toContain(proof);
    }
  });

  it("uses the same case for the system, readiness, gate, and workspace readbacks", () => {
    expect(smoke).toContain(
      "update development_cases set capital_project_id=$MVP_PROJECT where id='$CASE'",
    );
    expect(smoke).toContain(
      'record_commissioning_object "{\\"p_case_id\\":\\"$CASE\\"',
    );
    expect(smoke).toContain(
      'get_case_system_operational_readiness "{\\"p_case_id\\":\\"$CASE\\"',
    );
    expect(smoke).toContain(
      'get_case_operational_readiness_index "{\\"p_case_id\\":\\"$CASE\\"',
    );
    expect(smoke).toContain(
      'get_development_case "{\\"p_case_id\\":\\"$CASE\\"',
    );
    expect(smoke).toContain(
      'get_gate_readiness "{\\"p_case_id\\":\\"$CASE\\",\\"p_gate_id\\":$G4}',
    );
  });

  it("proves governance rather than manufacturing a readiness pass", () => {
    expect(smoke).toContain('c["status"]=="BLOCKED"');
    expect(smoke).toContain('c["hardConditionOverride"] is True');
    expect(smoke).toContain("human_authority_preserved=true");
    expect(smoke).not.toContain("MVP_INDEX_OVERRIDE");
  });

  it("runs the runtime transcript in CI and records the earned register claim", () => {
    expect(ci).toContain("bash scripts/ci-develop-slice1-smoke.sh");
    expect(register).toMatch(/\| D11\.34 [^\n]+\| ✅\s+\|/u);
    expect(register).toContain("One case, one runtime transcript");
  });
});

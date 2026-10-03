import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101140000_reliability_life_data_agent.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const service = readFileSync(
  "src/services/reliabilityLifeDataService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/ReliabilityLifeDataWorkbench.tsx",
  "utf8",
);
const page = readFileSync("src/pages/ReliabilityPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-reliability-life-data-agent-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Reliability Engineer life-data execution", () => {
  it("uses the canonical agent, source evidence and retained run ledger", () => {
    expect(migration).toContain("where a.key='reliability_engineering'");
    expect(migration).toContain("public.component_life_events");
    expect(migration).toContain("insert into public.agent_runs");
    expect(migration).toContain(
      "create table if not exists public.reliability_life_data_reports",
    );
    expect(migration).not.toContain(
      "create table if not exists reliability_life_events",
    );
  });

  it("classifies suspensions in the controlled shared-kernel path", () => {
    expect(edge).toContain('body.action === "reliability_life_data"');
    expect(edge).toContain("selectWeibullMethod(failures, suspensions)");
    expect(edge).toContain('event.eventKind === "scheduled"');
    expect(edge).toContain('"record_reliability_life_data_run"');
    expect(migration).toContain("v_distinct_failure_hours<2");
    expect(migration).toContain("'right_censored'");
  });

  it("requires named same-tenant engineering authority and exact inputs", () => {
    expect(migration).toContain(
      "requires a named same-tenant reliability engineer or administrator",
    );
    expect(migration).toContain(
      "source event set changed or does not match the complete same-tenant component population",
    );
    expect(migration).toContain(
      "method selection or event counts do not match the server-owned source classification",
    );
    expect(migration).toContain("analyse_censored_life_data");
    expect(migration).toContain("recommend_inspection_review");
  });

  it("is customer reachable for evidence capture and analysis", () => {
    expect(service).toContain('"record_component_life_event"');
    expect(service).toContain('"calculation-service"');
    expect(panel).toContain("Run governed analysis");
    expect(panel).toContain("Scheduled, still working");
    expect(page).toContain("<ReliabilityLifeDataWorkbench />");
  });

  it("has no maintenance execution or approval authority", () => {
    for (const boundary of [
      "'may_change_pm_interval',false",
      "'may_create_work',false",
      "'may_approve_strategy',false",
      "'may_accept_risk',false",
      "'may_commit_spend',false",
      "'may_return_to_service',false",
    ])
      expect(migration).toContain(boundary);
    expect(panel).toContain("Advisory only");
  });

  it("keeps a runtime proof in the clean migration-chain gate", () => {
    expect(smoke).toContain("censored_method=true");
    expect(smoke).toContain("complete_source_set=true");
    expect(smoke).toContain("immutable_report=true");
    expect(smoke).toContain("role_gate=true");
    expect(smoke).toContain("no_execution_authority=true");
    expect(workflow).toContain(
      "bash scripts/ci-reliability-life-data-agent-smoke.sh",
    );
  });

  it("closes the censored life-data engine without overstating full role closure", () => {
    expect(register).toMatch(/\| C7\.01 \|[^\n]+\| ✅[^\n]+/i);
    expect(register).toMatch(/\| C1\.03 \|[^\n]+\| 🟡[^\n]+/i);
  });
});

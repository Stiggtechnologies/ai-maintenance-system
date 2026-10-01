import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101190000_asset_strategy_agent.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const service = readFileSync(
  "src/services/assetStrategyAgentService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/AssetStrategyAgentWorkbench.tsx",
  "utf8",
);
const page = readFileSync("src/pages/IntervalDecisionsPage.tsx", "utf8");
const smoke = readFileSync("scripts/ci-asset-strategy-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Asset Strategy Specialist execution", () => {
  it("reuses the canonical programme, evidence and shared kernels", () => {
    for (const source of [
      "public.maintenance_plans",
      "public.component_life_events",
      "public.pf_intervals",
      "public.asset_economics",
      "public.lifecycle_evaluations",
      "insert into public.agent_runs",
    ])
      expect(migration).toContain(source);
    expect(edge).toContain("selectWeibullMethod(failures, suspensions)");
    expect(edge).toContain("optimalAgeReplacement(fit");
    expect(edge).toContain("inspectionInterval(pfDays, 0.9, 2)");
    expect(migration).not.toContain(
      "create table if not exists public.maintenance_plans",
    );
    expect(migration).not.toContain("weibull");
  });

  it("covers PM optimisation, task intervals, run-to-failure and lifecycle plans", () => {
    for (const mode of [
      "'pm optimization'",
      "'task intervals'",
      "'run-to-failure screening'",
      "'lifecycle planning'",
    ])
      expect(migration).toContain(mode);
    for (const kind of [
      '"interval_change"',
      '"inspection_interval"',
      '"run_to_failure_review"',
      '"evidence_gap"',
    ])
      expect(edge).toContain(kind);
    expect(migration).toContain("public.asset_lifecycle_plans");
  });

  it("keeps every programme mutation behind named-human review and locking", () => {
    expect(migration).toContain("segregation of duties requires adoption");
    expect(migration).toContain("this named human is not assigned to review");
    expect(migration).toContain("maintenance plan changed after assessment");
    expect(migration).toMatch(
      /from public\.assets a\s+where a\.id=s\.asset_id and a\.organization_id=v_org for update/,
    );
    expect(migration).toContain("change_pm_interval");
    expect(migration).toContain("d.required_authority='reliability_engineer'");
    expect(migration).toContain(
      "v_role,'') not in ('reliability_engineer','admin')",
    );
  });

  it("fails run-to-failure closed on safety, regulation and unknowns", () => {
    expect(edge).toContain("hasCostEvidence");
    expect(edge).toContain(
      "no age-replacement or run-to-failure decision is proposed",
    );
    expect(edge).toContain("source.plan.safetyCritical === false");
    expect(edge).toContain("source.plan.regulatoryRequired === false");
    expect(migration).toContain(
      "planned and failure consequence cost evidence is required",
    );
    expect(migration).toContain(
      "run-to-failure is blocked when safety or regulatory applicability is true or unknown",
    );
    expect(migration).toContain(
      "run-to-failure cannot be adopted when safety or regulatory applicability is true or unknown",
    );
  });

  it("freezes exact tenant evidence and keeps the specialist advisory", () => {
    expect(migration).toContain("source event set changed or does not match");
    expect(migration).toContain(
      "agent run names an asset outside its organization",
    );
    expect(migration).toContain(
      "asset-strategy assessments, reviews and lifecycle plans are append-only",
    );
    for (const control of [
      "'maychangepminterval',false",
      "'maydeactivatetask',false",
      "'mayapprovestrategy',false",
      "'maycreatework',false",
      "'mayacceptrisk',false",
      "'maycommitspend',false",
      "'mayreturntoservice',false",
    ])
      expect(migration).toContain(control);
  });

  it("is operable from interval decisions and writes back only through RPCs", () => {
    expect(service).toContain('"record_asset_strategy_context"');
    expect(service).toContain('"asset_strategy"');
    expect(service).toContain('"assign_asset_strategy_review"');
    expect(service).toContain('"adopt_asset_strategy_assessment"');
    expect(panel).toContain("Run retained assessment");
    expect(panel).toContain("Save governed context");
    expect(panel).toContain("Record governed decision");
    expect(page).toContain("<AssetStrategyAgentWorkbench");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.10", () => {
    for (const proof of [
      "shared_kernels=true",
      "canonical_programme_writeback=true",
      "rtf_cost_screen=true",
      "rtf_safety_screen=true",
      "optimistic_lock=true",
      "sod_adoption=true",
      "tenant_wall=true",
      "immutable_assessment=true",
      "lifecycle_version=true",
      "no_agent_execution_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-asset-strategy-agent-smoke.sh");
    expect(register).toMatch(/\| C1\.10 \|[^\n]+\| ✅[^\n]+/i);
  });
});

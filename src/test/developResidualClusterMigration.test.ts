/**
 * Sync Develop residual cluster — migration contract (static, no database).
 *
 * D3.29 estimate/schedule legs, D4.01 quality↔§10 binding, D4.14 cyber as a
 * first-class gate category. Live behaviour of the quality write path is
 * additionally proven by scripts/ci-quality-management-smoke.sh (unbound
 * create refused; bound create persists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";
import { GATE_READINESS_CATEGORIES } from "../lib/develop/governance";

const FILE = "20261217090000_develop_register_residual_cluster.sql";
const sql = stripComments(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
const recordAssumption = sql.slice(
  sql.indexOf("create or replace function public.record_case_assumption("),
);
const qualityRecord = sql.slice(
  sql.indexOf(
    "create or replace function public.record_quality_requirement(p_record jsonb)",
  ),
);
const cockpit = sql.slice(
  sql.indexOf(
    "create or replace function public.get_quality_cockpit(p_from timestamptz default null,p_to timestamptz default null)",
  ),
);
const shelf = readFileSync(
  "src/components/develop/FrameworkShelfPanel.tsx",
  "utf8",
);
const valueSpine = readFileSync(
  "src/components/develop/ValueSpinePanels.tsx",
  "utf8",
);
const qualityPage = readFileSync(
  "src/components/QualityManagementWorkbench.tsx",
  "utf8",
);
const governancePage = readFileSync(
  "src/pages/DecisionGovernance.tsx",
  "utf8",
);
const standards = readFileSync(
  "src/components/GovernanceStandards.tsx",
  "utf8",
);
const developRegister = readFileSync("docs/sync-develop/register.md", "utf8");

const row = (id: string) => {
  const line = developRegister
    .split("\n")
    .find((candidate) => candidate.startsWith(`| ${id} `));
  expect(line, id).toBeTruthy();
  return line!;
};

describe("D3.29 — estimate and schedule legs on the ONE assumption family", () => {
  it("does not create a fourth assumption store", () => {
    expect(sql).not.toMatch(/create table if not exists public\.\w*assumption/);
    expect(sql).toContain(
      "add column if not exists schedule_activity_id bigint",
    );
    expect(sql).toContain("references public.shutdown_tasks(id)");
    expect(sql).toContain("'estimate'");
    expect(sql).toContain("project_cost_items");
  });

  it("record_case_assumption validates both new legs against THIS case", () => {
    expect(recordAssumption).toContain("subject_type'='estimate'");
    expect(recordAssumption).toContain("ci.development_case_id=c.id");
    expect(recordAssumption).toContain("e.development_case_id = c.id");
    expect(recordAssumption).toContain(
      "schedule activity not found on this development case",
    );
    expect(recordAssumption).toMatch(
      /revoke all on function public\.record_case_assumption\(uuid, jsonb\) from public, anon/,
    );
    expect(recordAssumption).toContain("app_current_org()");
  });

  it("the read path is INVOKER and the surface calls it", () => {
    const links = sql.slice(
      sql.indexOf(
        "create or replace function public.get_case_assumption_links(",
      ),
    );
    expect(links).toMatch(/security invoker/i);
    expect(links).toContain("app_current_org()");
    expect(valueSpine).toContain("getCaseAssumptionLinks");
    expect(valueSpine).toContain('subjectType: "estimate"');
    expect(valueSpine).toContain("scheduleActivityId");
  });
});

describe("D4.01 — quality requirements bind to design_requirements", () => {
  it("adds the FK and refuses an unbound create", () => {
    expect(sql).toContain(
      "add column if not exists design_requirement_id bigint",
    );
    expect(sql).toContain("references public.design_requirements(id)");
    expect(qualityRecord).toContain("ONE project requirement table");
    expect(qualityRecord).toContain("v_design is null");
    expect(qualityRecord).toContain(
      "design requirement not found in this organization",
    );
  });

  it("the cockpit names unbound historical rows instead of hiding them", () => {
    expect(cockpit).toContain("'unboundQualityRequirements'");
    expect(cockpit).toContain("r.design_requirement_id is null");
    expect(qualityPage).toContain("designRequirementId");
    expect(qualityPage).toContain("ONE project requirement table");
  });
});

describe("D4.14 — cyber is a first-class gate-blocking category", () => {
  it("SQL and TypeScript publish the same vocabulary, including cyber", () => {
    expect(sql).toContain("create or replace function public.sync_gate_readiness_categories()");
    for (const category of GATE_READINESS_CATEGORIES) {
      expect(sql).toContain(`'${category}'`);
    }
    expect(sql).toContain("'cyber'");
    expect(shelf).toContain("GATE_READINESS_CATEGORIES");
    expect([...GATE_READINESS_CATEGORIES]).toContain("cyber");
  });

  it("does not invent a must-have-cyber rule that would break existing walks", () => {
    expect(sql).not.toContain("cyber_category_missing");
    expect(sql).not.toContain("every design gate must");
    expect(sql).toContain("get_gate_readiness / record_case_gate_review");
  });
});

describe("status-lag flips are backed by live callers the gate can walk", () => {
  it("D3.19 — both waiver halves have product request and decide paths", () => {
    expect(governancePage).toContain("<GovernanceStandards />");
    expect(standards).toContain("requestStandardVariance");
    expect(standards).toContain("decideStandardVariance");
    expect(row("D3.19")).toMatch(/^\| D3\.19 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D3.19")).toContain("`requestStandardVariance`");
    expect(row("D3.19")).toContain("`decideStandardVariance`");
    expect(row("D3.19")).toContain("`GovernanceStandards`");
    expect(row("D3.19")).toContain("`src/pages/DecisionGovernance.tsx`");
    expect(row("D3.19")).not.toContain("`DecisionGovernance.tsx`");
    expect(row("D3.19")).not.toContain("GovernanceStandards.test.tsx");
  });

  it("D11.32 — first Develop connector shipped under analyze-not-author", () => {
    expect(row("D11.32")).toMatch(/^\| D11\.32 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D11.32")).toContain("`ingest_procurement_status_batch`");
    expect(row("D11.32")).toContain("`ContractImport`");
  });

  it("flips only the rows this cluster actually closed", () => {
    expect(row("D3.29")).toMatch(/^\| D3\.29 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.01")).toMatch(/^\| D4\.01 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.14")).toMatch(/^\| D4\.14 \|[^|]*\|[^|]*\| ✅/);
    expect(row("D4.14")).toContain("`src/components/develop/FrameworkShelfPanel.tsx`");
    expect(row("D4.14")).toContain("`setGateRequirement`");
    expect(row("D4.14")).not.toContain("sync_gate_readiness_categories");
    expect(row("D4.07")).toMatch(/^\| D4\.07 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D3.02")).toMatch(/^\| D3\.02 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D7.06")).toMatch(/^\| D7\.06 \|[^|]*\|[^|]*\| 🟡/);
    expect(row("D8.06")).toMatch(/^\| D8\.06 \|[^|]*\|[^|]*\| 🟡/);
  });
});

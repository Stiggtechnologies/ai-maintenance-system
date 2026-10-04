import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270102230000_maintenance_executive_agent.sql",
).toLowerCase();
const service = read("src/services/maintenanceExecutiveAgentService.ts");
const panel = read("src/components/MaintenanceExecutiveAgentWorkbench.tsx");
const host = read("src/pages/ExecutiveIntelligence.tsx");
const smoke = read("scripts/ci-maintenance-executive-agent-smoke.sh");
const workflow = read(".github/workflows/ci.yml");
const register = read("docs/enterprise-readiness/capability-register.md");

describe("governed Maintenance Executive execution", () => {
  it("uses the canonical enterprise evidence families without shadows", () => {
    for (const source of [
      "public.kpi_catalog",
      "public.kpi_values",
      "public.approvals",
      "public.agent_control_profiles",
      "public.budget_lines",
      "public.expenditure_commitments",
      "public.risks",
      "public.asset_strategy_assessments",
      "public.asset_lifecycle_plans",
      "public.agent_runs",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain("create table if not exists public.risks");
    expect(migration).not.toContain(
      "create table if not exists public.budget_lines",
    );
  });

  it("covers all five executive domains and freezes exact fingerprints", () => {
    for (const mode of [
      "'enterprise performance'",
      "'governance'",
      "'budgets'",
      "'risk'",
      "'strategy'",
    ])
      expect(migration).toContain(mode);
    expect(migration).toContain("sync_maintenance_executive_source_snapshot");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("where organization_id=p_org");
    expect(migration).toContain("executive_scope");
    expect(migration).toContain("public.can_read_risk(id)");
    expect(migration).toContain("status not in ('closed','archived')");
  });

  it("preserves the hard human authority boundary", () => {
    for (const control of [
      "'mayapprove',false",
      "'mayacceptrisk',false",
      "'mayadoptstrategy',false",
      "'maycommitspend',false",
      "'mayreleasework',false",
      "'maychangeoperatinglimits',false",
      "'mayreturntoservice',false",
    ])
      expect(migration).toContain(control);
    expect(migration).toContain(
      "never treat absent data as passing or aggregate different currencies into one amount",
    );
    expect(migration).toContain("'budget_currency_missing'");
    expect(migration).toContain("'currencystatus','not_recorded_by_budget_lines'");
    expect(migration).not.toContain("sum(budgeted)");
    expect(migration).toContain("an acknowledged briefing is not an approval");
  });

  it("requires independent named-human review and immutable history", () => {
    expect(migration).toContain(
      "maintenance-executive briefings, assignments and acknowledgements are append-only",
    );
    expect(migration).toContain(
      "segregation of duties requires a reviewer other than the briefing requester",
    );
    expect(migration).toContain(
      "segregation of duties requires acknowledgement by a different named human",
    );
    expect(migration).toContain(
      "this named human is not assigned to review the briefing",
    );
    expect(migration).toContain("'operationalauthorization',false");
    expect(migration).toContain("'approvalcreated',false");
    expect(migration).toContain("maintenance-executive evidence cannot be truncated");
    expect(migration).toContain(
      "if tg_table_name='maintenance_executive_briefings' then",
    );
    expect(migration).toContain(
      "elsif tg_table_name='maintenance_executive_review_assignments' then",
    );
    expect(migration).toContain(
      "elsif tg_table_name='maintenance_executive_acknowledgements' then",
    );
    expect(migration).toContain("from public,anon,authenticated,service_role");
    expect(migration).not.toContain(
      "u.role in ('executive','maintenance_manager','reliability_engineer','admin','ai_admin')",
    );
  });

  it("is customer-operable from Executive Asset Intelligence", () => {
    for (const rpc of [
      '"get_maintenance_executive_workspace"',
      '"run_maintenance_executive_agent"',
      '"assign_maintenance_executive_review"',
      '"acknowledge_maintenance_executive_briefing"',
    ])
      expect(service).toContain(rpc);
    expect(panel).toContain("Run retained briefing");
    expect(panel).toContain("Assign independent review");
    expect(panel).toContain("Record review receipt");
    expect(panel).toContain('profile?.role !== "executive"');
    expect(panel).toContain('profile?.role !== "admin"');
    expect(host).toContain("<MaintenanceExecutiveAgentWorkbench />");
  });

  it("holds runtime proof in the clean migration gate and closes C1.01", () => {
    for (const proof of [
      "performance=true",
      "governance=true",
      "budgets=true",
      "risk=true",
      "strategy=true",
      "exact_source_fingerprints=true",
      "tenant_wall=true",
      "immutable_briefing=true",
      "sod_review=true",
      "no_decision_authority=true",
      "no_operational_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-maintenance-executive-agent-smoke.sh",
    );
    expect(register).toMatch(/\| C1\.01 \|[^\n]+\| ✅[^\n]+/i);
  });
});

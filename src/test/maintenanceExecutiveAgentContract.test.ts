import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101210000_maintenance_executive_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/maintenanceExecutiveAgentService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/MaintenanceExecutiveAgentWorkbench.tsx",
  "utf8",
);
const host = readFileSync("src/pages/ExecutiveIntelligence.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-maintenance-executive-agent-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Maintenance Executive Specialist execution", () => {
  it("composes canonical enterprise records instead of shadow scorecards", () => {
    for (const source of [
      "public.kpi_catalog",
      "public.kpi_values",
      "public.budget_lines",
      "public.risks",
      "public.maintenance_plans",
      "public.asset_strategy_assessments",
      "public.recommendations",
      "public.approvals",
      "public.verification_obligations",
      "public.value_metrics",
      "public.raci_assignments",
      "public.authority_limits",
      "public.agent_runs",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain(
      "create table if not exists public.executive_kpis",
    );
    expect(migration).not.toContain(
      "create table if not exists public.executive_budgets",
    );
    expect(migration).not.toContain(
      "create table if not exists public.executive_risks",
    );
  });

  it("covers performance, governance, budgets, risk, strategy and verified value", () => {
    for (const mode of [
      "'enterprise performance'",
      "'governance'",
      "'budgets'",
      "'risk'",
      "'maintenance strategy'",
      "'verified value'",
    ])
      expect(migration).toContain(mode);
    for (const priority of [
      "kpi_breaches",
      "kpi_sources_missing",
      "budget_not_recorded",
      "budget_forecast_basis_missing",
      "budget_exception_attention",
      "enterprise_risk_attention",
      "risk_drafts_unqualified",
      "maintenance_strategy_evidence_gap",
      "authority_instrument_not_adopted",
      "outcome_verification_overdue",
      "projected_value_unverified",
    ])
      expect(migration).toContain(priority);
    expect(migration).toContain("'route','/learning-loop'");
    expect(migration).not.toContain("'route','/learning'");
  });

  it("freezes exact organization-scoped evidence and preserves honest units", () => {
    expect(migration).toContain("organization_scope_id");
    expect(migration).toContain(
      "agent run organization scope crosses its organization boundary",
    );
    expect(migration).toContain(
      "executive workspace requires a named executive, maintenance manager or administrator",
    );
    expect(smoke).toContain("role_scoped_read=true");
    expect(smoke).toContain("risk_sensitivity_preserved=true");
    expect(migration).toContain("public.can_read_risk(id)");
    expect(migration).toContain("information_sensitivity='restricted'");
    expect(migration).toContain("agent_runs_information_sensitivity_check");
    expect(migration).toContain("audit_events_information_sensitivity_check");
    expect(migration).toContain("sync_maintenance_executive_source_snapshot");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain("value is separated by recorded unit");
    expect(migration).toContain("'otherunverified'");
    expect(migration).toContain("'aggregateamount','not calculated;");
    expect(migration).toContain("budget rows do not carry a currency field");
  });

  it("keeps the specialist advisory and incapable of executive acts", () => {
    for (const boundary of [
      "'mayapprove',false",
      "'mayacceptrisk',false",
      "'maycommitspend',false",
      "'mayreleasework',false",
      "'maychangestrategy',false",
      "'maychangekpitarget',false",
      "'mayreturntoservice',false",
      "'operationalauthorization',false",
    ])
      expect(migration).toContain(boundary);
    expect(migration).toContain(
      "does not approve, accept risk, commit spend, release work, change strategy or change a kpi target",
    );
    expect(migration).toContain("null,now(),now(),auth.uid(),v_org");
    expect(migration).not.toContain("recommendations_generated=coalesce");
  });

  it("requires immutable evidence and independent named-human review", () => {
    expect(migration).toContain(
      "maintenance-executive briefs, assignments and dispositions are append-only",
    );
    expect(migration).toContain(
      "segregation of duties requires a reviewer other than the brief requester",
    );
    expect(migration).toContain(
      "segregation of duties requires disposition by a different named human",
    );
    expect(migration).toContain(
      "this named human is not assigned to review the brief",
    );
  });

  it("is customer-operable from the canonical executive surface", () => {
    expect(service).toContain('"get_maintenance_executive_workspace"');
    expect(service).toContain('"run_maintenance_executive_agent"');
    expect(service).toContain('"assign_maintenance_executive_review"');
    expect(service).toContain('"record_maintenance_executive_disposition"');
    expect(panel).toContain("Assemble retained brief");
    expect(panel).toContain("Assign independent review");
    expect(panel).toContain("Record independent disposition");
    expect(panel).toContain("reviewer.id !== brief?.createdBy");
    expect(panel).toContain('brief?.informationSensitivity !== "restricted"');
    expect(host).toContain("<MaintenanceExecutiveAgentWorkbench />");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.01", () => {
    for (const proof of [
      "canonical_kpis=true",
      "canonical_budgets=true",
      "canonical_risks=true",
      "canonical_strategy=true",
      "canonical_governance=true",
      "budget_amounts_not_mixed_without_currency=true",
      "verified_value_statuses_and_units_separated=true",
      "exact_source_fingerprints=true",
      "organization_scope=true",
      "immutable_brief=true",
      "no_invented_confidence=true",
      "no_shadow_recommendations=true",
      "sod_review=true",
      "no_agent_approval=true",
      "no_risk_acceptance=true",
      "no_spend_commitment=true",
      "no_work_release=true",
      "no_strategy_mutation=true",
      "no_operational_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-maintenance-executive-agent-smoke.sh",
    );
    expect(register).toMatch(/\| C1\.01 \|[^\n]+\| ✅[^\n]+/i);
  });
});

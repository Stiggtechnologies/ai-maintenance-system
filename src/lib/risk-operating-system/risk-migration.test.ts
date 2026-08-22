import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260921110101_iso31000_risk_operating_system.sql",
  ),
  "utf8",
).toLowerCase();

const newTables = [
  "risk_context_nodes",
  "risk_criteria_profiles",
  "risks",
  "risk_controls",
  "risk_control_links",
  "risk_control_tests",
  "risk_indicators",
  "risk_indicator_observations",
  "risk_stakeholder_views",
  "risk_links",
  "risk_framework_reviews",
  "risk_maturity_assessments",
] as const;

describe("ISO 31000 migration contract", () => {
  it("reuses the canonical operating loop instead of creating parallel workflow records", () => {
    expect(sql).toContain("canonical reuse");
    for (const table of [
      "evidence_items",
      "scenarios",
      "recommendations",
      "approvals",
      "decisions",
      "work_orders",
      "learning_events",
    ]) {
      expect(sql).toContain(`alter table ${table}`);
      expect(sql).toContain(`add column if not exists risk_id`);
    }
    expect(sql).not.toContain("create table if not exists risk_treatments");
    expect(sql).not.toContain("create table if not exists risk_approvals");
    expect(sql).not.toContain("create table if not exists risk_evidence");
    expect(sql).not.toContain("create table if not exists risk_work_orders");
  });

  it("enables tenant isolation on every new persistence surface", () => {
    for (const table of newTables) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(sql).toMatch(
        new RegExp(
          `create policy [\\s\\S]{0,100} on ${table}[\\s\\S]{0,180}organization_id = app_current_org\\(\\)`,
        ),
      );
    }
  });

  it("validates every governed relationship against the current organization", () => {
    for (const message of [
      "context not found in this organization",
      "site not found in this organization",
      "asset not found in this organization",
      "risk owner not found in this organization",
      "decision owner not found in this organization",
      "stakeholder user not found in this organization",
      "owner not found in this organization",
    ]) {
      expect(sql).toContain(message);
    }
    expect(sql).toContain("c.organization_id=p_risk.organization_id");
    expect(sql).toContain("u.organization_id=p_risk.organization_id");
  });

  it("enforces the universal risk contract at the database boundary", () => {
    expect(sql).toContain("function public.risk_contract_gaps");
    expect(sql).toContain("function public.enforce_risk_contract");
    expect(sql).toContain("trigger trg_enforce_risk_contract");
    for (const field of [
      "objective_at_risk",
      "risk_source",
      "event_description",
      "scope_decision",
      "scope_inclusions",
      "scope_exclusions",
      "time_horizon",
      "decision_owner_id",
      "risk_owner_id",
      "criteria_profile_id",
      "assumptions",
      "data_quality",
      "method_limitations",
      "biases",
      "bias_review_complete",
      "reporting_profile",
    ]) {
      expect(sql).toContain(field);
    }
  });

  it("provides controlled workflows for the full operating loop", () => {
    for (const fn of [
      "create_risk_assessment",
      "record_risk_analysis",
      "record_risk_value_of_information",
      "ingest_risk_evidence",
      "record_stakeholder_view",
      "record_risk_indicator_observation",
      "record_risk_control_test",
      "configure_risk_control",
      "configure_risk_indicator",
      "link_risks",
      "create_risk_treatment",
      "record_risk_decision",
      "decide_risk_decision",
      "record_risk_outcome",
      "upsert_risk_context",
      "adopt_risk_criteria",
      "create_risk_criteria_version",
      "configure_risk_authority_requirements",
      "record_risk_maturity_assessment",
      "record_risk_framework_review",
      "get_aggregate_risk_exposure",
      "get_risk_operating_cockpit",
      "get_risk_management_effectiveness",
      "get_risk_audience_view",
    ]) {
      expect(sql).toContain(`function public.${fn}`);
      expect(sql).toContain(`grant execute on function public.${fn}`);
    }
  });

  it("extends the existing time-bounded authority-controlled acceptance model to risks", () => {
    expect(sql).toContain("alter table risk_acceptances");
    expect(sql).toContain("'risk'");
    expect(sql).toContain("reassessment_trigger");
    expect(sql).toContain("function public.accept_risk");
    expect(sql).toContain("authority_limits");
    expect(sql).toContain("required_competency_keys");
    expect(sql).toContain("max_exposure");
    expect(sql).toContain("risk_kinds");
  });

  it("keeps governed RPC execution away from anonymous and public roles", () => {
    for (const fn of [
      "create_risk_assessment",
      "record_risk_decision",
      "accept_risk",
      "adopt_risk_context",
      "adopt_risk_criteria",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke execute on function public\\.${fn}\\([^;]+from public, anon`,
        ),
      );
    }
  });

  it("allows canonical recommendations to be governed by asset location or risk context", () => {
    expect(sql).toContain(
      "create or replace function check_recommendation_contract",
    );
    expect(sql).toContain("governed risk context");
    expect(sql).toContain("r.risk_id is not null");
    expect(sql).not.toContain(
      "create table if not exists risk_recommendations",
    );
  });

  it("never lets indicator automation approve or accept a risk", () => {
    const observationFunction = sql.match(
      /function public\.record_risk_indicator_observation[\s\S]*?grant execute on function public\.record_risk_indicator_observation/,
    )?.[0];
    expect(observationFunction).toBeTruthy();
    expect(observationFunction).not.toContain("insert into risk_acceptances");
    expect(observationFunction).not.toContain("approval_status = 'approved'");
    expect(observationFunction).not.toContain("decision_action = 'accept'");
  });
});

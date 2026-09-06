import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260921110102_iso31000_enterprise_extensions.sql",
  ),
  "utf8",
).toLowerCase();

describe("ISO 31000 enterprise-extension migration contract", () => {
  it.each([
    "risk_objectives",
    "risk_stakeholders",
    "risk_obligations",
    "risk_sources",
    "risk_consequences",
    "risk_assumptions",
    "risk_likelihood_estimates",
    "risk_event_scenarios",
    "risk_stress_tests",
    "risk_treatment_dependencies",
    "risk_challenges",
    "risk_assurance_reviews",
    "risk_communications",
    "risk_learning_transfers",
  ])("creates and tenant-protects %s", (table) => {
    expect(sql).toContain(`create table if not exists ${table}`);
    expect(sql).toContain(`alter table ${table} enable row level security`);
  });

  it("reuses canonical decisions, scenarios, learning, authority and audit", () => {
    expect(sql).toContain("alter table decisions");
    expect(sql).toContain("alter table scenarios");
    expect(sql).toContain("alter table learning_events");
    expect(sql).toContain("alter table authority_limits");
    expect(sql).toContain("insert into audit_events");
    expect(sql).not.toContain("create table if not exists risk_decisions");
    expect(sql).not.toContain("create table if not exists risk_treatments");
    expect(sql).not.toContain(
      "create table if not exists risk_learning_events",
    );
  });

  it("implements controlled lifecycle, propagation, expiry and sensitivity", () => {
    expect(sql).toContain("transition_risk_lifecycle");
    expect(sql).toContain("mark_risk_reassessment");
    expect(sql).toContain("refresh_risk_governance_state");
    expect(sql).toContain("can_read_risk");
    expect(sql).toContain("segregation of duties");
    expect(sql).toContain("reassessment_required");
  });

  it("implements scenario, challenge, assurance, communication and learning RPCs", () => {
    for (const fn of [
      "upsert_risk_objective",
      "create_risk_objective_version",
      "record_risk_obligation",
      "create_risk_obligation_version",
      "record_risk_assumption",
      "invalidate_risk_assumption",
      "record_risk_analysis_element",
      "record_risk_likelihood_estimate",
      "record_risk_event_scenario",
      "record_risk_stress_test",
      "link_risk_treatment_dependency",
      "record_risk_challenge",
      "resolve_risk_challenge",
      "record_risk_assurance_review",
      "record_risk_communication",
      "record_risk_learning_transfer",
      "get_risk_enterprise_architecture",
      "get_risk_decision_operations",
      "get_sensitive_risk_operating_cockpit",
      "configure_risk_integration_binding",
      "configure_risk_agent_binding",
      "provision_risk_advisory_agents",
    ]) {
      expect(sql).toContain(`function public.${fn}`);
    }
  });

  it("keeps public and anonymous callers outside every controlled mutation", () => {
    expect(sql).toContain("revoke execute");
    expect(sql).toContain("from public, anon");
    expect(sql).not.toMatch(/grant execute[^;]+\bto\s+anon\b/);
  });

  it("revokes and grants the sensitivity helpers using their deployed signatures", () => {
    expect(sql).toContain(
      "revoke execute on function public.can_read_risk_set(jsonb) from public, anon",
    );
    expect(sql).toContain(
      "revoke execute on function public.can_read_risk_subject(text,uuid,uuid) from public, anon",
    );
    expect(sql).not.toContain("can_read_risk_set(uuid[])");
    expect(sql).not.toContain("can_read_risk_subject(text,uuid) from");
  });
});

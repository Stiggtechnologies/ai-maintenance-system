import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260920003000_ria_governed_write_contracts.sql",
  "utf8",
).toLowerCase();

const activationDirectoryFix = readFileSync(
  "supabase/migrations/20260920004000_ria_activation_directory_control_flow.sql",
  "utf8",
).toLowerCase();

function body(name: string): string {
  const marker = `function public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("create or replace function public.", start + marker.length);
  return migration.slice(start, next === -1 ? migration.length : next);
}

describe("RIA commercial activation contract", () => {
  it("persists complete conversion provenance on the originating lead", () => {
    for (const column of [
      "ria_assessment_id",
      "activated_organization_id",
      "activated_by",
      "activated_at",
      "activation_acceptance_reference",
    ]) {
      expect(migration).toContain(`add column if not exists ${column}`);
    }
    expect(migration).toContain("pilot_intake_ria_activation_is_complete");
  });

  it("locks the lead and is idempotent only inside the same target organization", () => {
    const sql = body("activate_ria_from_intake");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_lead.ria_assessment_id is not null");
    expect(sql).toContain("activated_organization_id is distinct from p_organization_id");
    expect(sql).toContain("return v_lead.ria_assessment_id");
  });

  it("does not turn a tenant admin into a cross-tenant platform operator", () => {
    const sql = body("activate_ria_from_intake");
    expect(sql).toContain("v_role not in ('admin', 'ai_admin')");
    expect(sql).toContain("v_role = 'admin' and p_organization_id is distinct from v_current_org");
    expect(sql).toContain("target organization does not exist");
  });

  it("terminates authorized activation-directory branches after returning their allowed rows", () => {
    expect(activationDirectoryFix).toContain("if v_role = 'ai_admin' then");
    expect(activationDirectoryFix).toMatch(/order by o\.name;\s*return;\s*elsif v_role = 'admin'/);
    expect(activationDirectoryFix).toMatch(/where o\.id = v_current_org\s*order by o\.name;\s*return;/);
    expect(activationDirectoryFix).toContain(
      "ria activation organization directory requires administrator authority",
    );
  });

  it("requires recorded commercial acceptance and never auto-creates an organization", () => {
    const sql = body("activate_ria_from_intake");
    expect(sql).toContain("p_acceptance_reference");
    expect(sql).toContain("signed sow, po, invoice, or payment reference");
    expect(sql).not.toMatch(/insert\s+into\s+public\.organizations/);
  });
});

describe("RIA engineering authoring boundary", () => {
  it("resolves every authoring mutation through current-org assessment authority", () => {
    const helper = body("ria_authoring_organization");
    expect(helper).toContain("app_current_org()");
    expect(helper).toContain("reliability_engineer");
    expect(helper).toContain("maintenance_manager");
    expect(helper).toContain("v_assessment_org is distinct from v_org");

    for (const fn of [
      "upsert_ria_baseline_metric",
      "create_ria_criticality_draft",
      "create_ria_finding_draft",
      "create_ria_opportunity_draft",
      "create_ria_decision_draft",
      "create_ria_action_draft",
      "record_ria_verification",
      "transition_ria_assessment_phase",
    ]) {
      expect(body(fn)).toContain("ria_authoring_organization(p_assessment_id)");
    }
  });

  it("validates evidence source tenancy before definer writes", () => {
    const helper = body("ria_validate_source_ids");
    expect(helper).toContain("s.assessment_id = p_assessment_id");
    expect(helper).toContain("s.organization_id = p_organization_id");
    expect(helper).toContain("s.deleted_at is null");

    expect(body("upsert_ria_baseline_metric")).toContain("ria_validate_source_ids");
    expect(body("record_ria_verification")).toContain("ria_validate_source_ids");

    const finding = body("create_ria_finding_draft");
    expect(finding).toContain("s.assessment_id = p_assessment_id");
    expect(finding).toContain("s.organization_id = v_org");
    expect(finding).toContain("s.deleted_at is null");
  });

  it("creates findings and their evidence in one transactional RPC", () => {
    const sql = body("create_ria_finding_draft");
    expect(sql).toContain("insert into public.ria_findings");
    expect(sql).toContain("jsonb_array_elements");
    expect(sql).toContain("insert into public.ria_finding_evidence");
    expect(sql).toContain("linked_by");
  });

  it("does not admit unsupported precision into a quantified opportunity", () => {
    const sql = body("create_ria_opportunity_draft");
    expect(sql).toContain("p_value_low > p_value_high");
    expect(sql).toContain("p_method");
    expect(sql).toContain("p_value_source");
    expect(sql).toContain("p_assumptions");
    expect(sql).toContain("a quantified opportunity requires an ordered range, method, source, and assumptions");
  });

  it("leaves high/critical actions pending human approval", () => {
    const sql = body("create_ria_action_draft");
    expect(sql).toContain("v_severity in ('critical','high') then 'pending'");
    expect(sql).toContain("'not_started'");
    expect(sql).not.toContain("'approved'");
  });

  it("requires an actual verification conclusion before completion", () => {
    const sql = body("transition_ria_assessment_phase");
    expect(sql).toContain("for update");
    expect(sql).toContain("v_current = 'verification' and p_status in ('customer_review','complete')");
    expect(sql).toContain("assessment cannot be completed before a verification conclusion is recorded");
    expect(sql).toContain("v.status in ('supported','partially_supported','unsupported')");
  });
});

describe("RIA definer grants", () => {
  it("keeps helper definers private and grants only named API contracts", () => {
    expect(migration).toContain(
      "revoke all on function public.ria_authoring_organization(uuid) from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.ria_validate_source_ids(uuid,uuid,uuid[]) from public, anon, authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.ria_authoring_organization(uuid) to authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.ria_validate_source_ids(uuid,uuid,uuid[]) to authenticated",
    );

    for (const fn of [
      "list_ria_activation_organizations()",
      "activate_ria_from_intake(uuid,uuid,text,date,text)",
      "create_ria_criticality_draft(uuid,text,text,text,text)",
      "create_ria_finding_draft(uuid,text,text,text,text,text,text,jsonb)",
      "transition_ria_assessment_phase(uuid,text)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn} from public, anon`);
      expect(migration).toContain(`grant execute on function public.${fn} to authenticated`);
    }
  });
});

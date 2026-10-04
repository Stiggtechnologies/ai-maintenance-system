import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270102270000_enterprise_hse_events.sql",
).toLowerCase();
const service = read("src/services/enterpriseHseEventsService.ts");
const workbench = read("src/components/EnterpriseHseEvents.tsx");
const executive = read("src/pages/ExecutiveIntelligence.tsx");
const smoke = read("scripts/ci-enterprise-hse-events-smoke.sh");
const workflow = read(".github/workflows/ci.yml");
const register = read("docs/enterprise-readiness/capability-register.md");

describe("C6.01 governed enterprise HSE events", () => {
  it("adds one canonical versioned HSE event record and reuses existing evidence and process-safety truth", () => {
    expect(migration).toContain("create table public.hse_events");
    expect(migration).toContain("public.evidence_items");
    expect(migration).toContain("public.audit_events");
    expect(migration).toContain("public.containment_losses");
    expect(migration).toContain("event_ref");
    expect(migration).toContain("version");
    expect(migration).toContain("supersedes_id");
    expect(migration).toContain("expectedversion");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("keeps classification human-authored, tenant-bound, AAL2 and independently verifiable", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_aal()<>'aal2'");
    expect(migration).toContain("public.app_actor_has_verified_mfa(v_actor)");
    expect(migration).toContain("ai_admin");
    expect(migration).toContain("aggregate hse posture only for this role");
    expect(migration).toContain("exact event and source evidence requires");
    expect(migration).toContain("e.verification_status='verified'");
    expect(migration).toContain("e.verified_by<>v_actor");
    expect(migration).toContain("organization_id=v_org");
    expect(migration).toContain("asset does not belong to the selected site");
  });

  it("refuses silent mutation and keeps review separate from operational authority", () => {
    expect(migration).toContain("guard_hse_event_write");
    expect(migration).toContain("app.hse_event_writer");
    expect(migration).toContain(
      "revoke insert,update,delete,truncate on public.hse_events",
    );
    expect(migration).toContain("hse event history cannot be truncated");
    for (const boundary of [
      "'incidentclosed',false",
      "'compliancecertified',false",
      "'riskaccepted',false",
      "'workauthorized',false",
      "'returntoserviceauthorized',false",
    ])
      expect(migration).toContain(boundary);
  });

  it("requires explicit reporting coverage before a zero becomes a KPI", () => {
    expect(migration).toContain("create table public.hse_reporting_sources");
    expect(migration).toContain("coverage_start");
    expect(migration).toContain("coverage_end");
    expect(migration).toContain("source_reference");
    expect(migration).toContain("evidence_item_id");
    expect(migration).toContain("reportingcoveragecomplete");
    expect(migration).toContain("awaiting reporting coverage");
    expect(workbench).toContain("A zero is shown only for an attested source");
  });

  it("reports safety and environmental events separately and deduplicates containment loss", () => {
    expect(migration).toContain("occupational_safety");
    expect(migration).toContain("environmental");
    expect(migration).toContain("tier_1");
    expect(migration).toContain("tier_2");
    expect(migration).toContain("tier_3");
    expect(migration).toContain("tier_4");
    expect(migration).toContain("reached_environment");
    expect(migration).toContain("containment_loss_id");
    expect(migration).toContain("countedonce");
    expect(migration).not.toContain("safety-flagged work orders");
    expect(workbench).toContain("Safety events");
    expect(workbench).toContain("Environmental events");
    expect(workbench).toContain("Pending classification");
  });

  it("replaces the unsafe work-order proxy while preserving the canonical KPI fact service", () => {
    expect(migration).toContain("public.kpi_catalog");
    expect(migration).toContain("public.kpi_values");
    expect(migration).toContain("enterprise_safety_events_30d");
    expect(migration).toContain("enterprise_environmental_events_30d");
    expect(migration).toContain("compute_general_kpi_snapshot");
    expect(migration).toContain("compute_enterprise_hse_kpi_snapshot");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to service_role");
  });

  it("is customer-operable from Executive Asset Intelligence", () => {
    for (const rpc of [
      '"get_enterprise_hse_workspace"',
      '"record_hse_reporting_source"',
      '"record_hse_event"',
      '"verify_hse_event"',
    ])
      expect(service).toContain(rpc);
    expect(workbench).toContain("Record event");
    expect(workbench).toContain("Attest reporting source");
    expect(workbench).toContain("Verify event evidence");
    expect(executive).toContain("<EnterpriseHseEvents />");
  });

  it("has clean-stack runtime proof and closes only C6.01", () => {
    for (const proof of [
      "tenant_wall=true",
      "aal2_required=true",
      "ai_refused=true",
      "version_history=true",
      "independent_verification=true",
      "coverage_required_for_zero=true",
      "containment_loss_counted_once=true",
      "safety_environment_separate=true",
      "direct_write_locked=true",
      "no_operational_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain(
      "bash scripts/ci-enterprise-hse-events-smoke.sh",
    );
    expect(register).toMatch(/\| C6\.01 \|[^\n]+\| ✅[^\n]+/i);
  });
});

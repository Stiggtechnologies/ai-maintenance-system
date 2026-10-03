import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20270101630000_sync_context_canonical_contracts.sql",
  "utf8",
).toLowerCase();
const contracts = readFileSync("src/lib/sync-context/contracts.ts", "utf8");
const service = readFileSync("src/services/syncContextService.ts", "utf8");
const panel = readFileSync(
  "src/components/GeospatialOperationalIntelligencePanel.tsx",
  "utf8",
);
const provenanceBadges = readFileSync(
  "src/components/sync-context/ContextProvenanceBadges.tsx",
  "utf8",
);
const workspaceProjection = sql.slice(
  sql.indexOf(
    "create or replace function public.get_geospatial_operational_workspace()",
  ),
  sql.indexOf(
    "revoke all on function public.get_geospatial_operational_workspace()",
  ),
);

describe("SC-01 canonical Sync Context contracts", () => {
  it("extends canonical connector and geospatial stores without shadows", () => {
    expect(sql).toContain("alter table public.connectors");
    expect(sql).toContain("alter table public.geospatial_features");
    expect(sql).toContain("alter table public.geospatial_subject_links");
    for (const forbidden of [
      "create table public.spatial_objects",
      "create table public.context_events",
      "create table public.context_sources",
      "create table public.source_health",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("maps Context objects to canonical tenant-scoped identities", () => {
    for (const identity of [
      "public.assets",
      "public.sites",
      "public.work_orders",
      "public.evidence_items",
      "public.recommendations",
      "public.decisions",
      "public.approvals",
      "public.risks",
      "public.restoration_events",
      "public.development_cases",
      "public.capital_projects",
      "public.audit_events",
    ]) {
      expect(sql).toContain(identity);
    }
    expect(sql).toContain("same-tenant classified context source");
    expect(sql).toContain("crosses the context tenant boundary");
    expect(sql).toContain(
      "context source governance fields are writable only through governed rpcs",
    );
    expect(sql).toContain("link at least one canonical context subject");
    expect(sql).toContain("v_recommendation");
    expect(sql).toContain("approval does not govern the linked work order");
    expect(sql).toContain(
      "work order and decision do not share their canonical recommendation",
    );
  });

  it("normalizes source classes, rights, health, and temporal validity", () => {
    for (const value of [
      "live_external",
      "simulated_industrial",
      "customer_operational",
      "partial_coverage",
      "clock_skew",
      "production_approved",
      "customer_authorized",
    ]) {
      expect(sql).toContain(value);
      expect(contracts.toLowerCase()).toContain(value);
    }
    expect(sql).toContain("validity_kind");
    expect(contracts).toContain("validityKind");
  });

  it("provides one read-only browser projection with no approval power", () => {
    expect(service).toContain('supabase.rpc("get_sync_context_snapshot")');
    expect(service).toContain("parseSyncContextSnapshot");
    expect(sql).toContain("'operationalauthority',false");
    expect(sql).not.toContain("insert into public.approvals");
    expect(sql).not.toContain("insert into public.work_orders");
    expect(sql).not.toMatch(/update public\.recommendations\s+set\s+status/);
    expect(sql).not.toContain("sqlerrm");
  });

  it("derives layer health and work authority from canonical state", () => {
    for (const field of [
      "'sourcedependencies'",
      "'healthstates'",
      "'availability'",
      "'recordcount'",
      "'empty'",
      "'degraded'",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("approval_decision");
    expect(sql).toContain("e.event_time<=h.changed_at");
    expect(sql).toContain(
      "h.status_to in ('in_progress','completed') then 'executed'",
    );
    expect(sql).not.toContain(
      "h.status_to in ('scheduled','in_progress') then 'approved'",
    );
    expect(sql).toContain(
      "source health check time must advance monotonically",
    );
    expect(sql).toContain(
      "a later live check cannot regress the canonical observation time",
    );
    expect(sql).toContain(
      "live source health requires an enforced positive freshness interval",
    );
    expect(sql).toContain(
      "out-of-order observations must be reported as delayed or conflicting evidence",
    );
    expect(sql).toContain("context_observed_at=v_effective_observed");
    expect(sql).toContain(
      "where w.organization_id=v_org and v_role<>'technician'",
    );
  });

  it("enforces human rights governance, revocation, and private projections", () => {
    expect(sql).toContain("transition_context_source_rights");
    expect(sql).toContain("sync_context_source_rights_permit");
    expect(sql).toContain("coalesce(v_role,'')<>'admin'");
    expect(sql).toContain("context_rights_decided_by");
    expect(sql).toContain("context_rights_basis");
    expect(sql).toContain("v_role<>'technician'");
    expect(sql).toContain("never use to_jsonb(link)");
    expect(sql).toContain("public.can_read_risk(l.risk_id)");
    for (const policy of [
      "create policy connectors_org_read",
      "create policy geospatial_features_read",
      "create policy geospatial_subject_links_read",
      "create policy geospatial_assessments_read",
    ]) {
      expect(sql).toContain(policy);
    }
    expect(
      sql.match(/public\.sync_context_source_rights_permit\(c\)/g)?.length,
    ).toBeGreaterThanOrEqual(16);
    expect(sql).toContain(
      "returns trigger language plpgsql security definer set search_path=public",
    );
    expect(sql).toContain(
      "revoke all on function public.get_geospatial_operational_workspace() from public,anon,service_role",
    );
    expect(workspaceProjection).not.toContain("to_jsonb(f)");
    expect(workspaceProjection).not.toContain("to_jsonb(a)");
    expect(workspaceProjection).toContain(
      "public.sync_context_source_rights_permit(c)",
    );
    for (const privateField of [
      "'context_owner_id'",
      "'recorded_by'",
      "'verified_by'",
      "'work_order_id'",
      "'decision_id'",
      "'approval_id'",
      "'risk_id'",
    ]) {
      expect(workspaceProjection).not.toContain(privateField);
    }
  });

  it("quarantines legacy geofences and refuses empty-subject projections", () => {
    expect(sql).toContain("trg_context_feature_verification");
    expect(sql).toContain("trg_context_assessment_inputs");
    expect(sql).toContain("set status='superseded'");
    expect(sql).toContain(
      "exists(select 1 from public.geospatial_subject_links sl",
    );
    expect(contracts).toContain("SpatialObject requires a canonical subject.");
  });

  it("does not introduce a person-tracking or biometric model", () => {
    for (const forbidden of [
      "person_id",
      "worker_id",
      "user_location",
      "biometric",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
    expect(contracts).toContain("FORBIDDEN_PERSON_KEYS");
    expect(contracts).toContain("containsPersonIdentity");
  });

  it("makes source provenance and authority visible at the customer surface", () => {
    expect(panel).toContain("Select governed source");
    expect(panel).toContain("ContextProvenanceBadges");
    expect(panel).toContain("Verified evidence — no operational approval");
    expect(panel).not.toContain("source_system: sourceSystem");
    expect(provenanceBadges).toContain("demo-only rights · not live");
  });
});

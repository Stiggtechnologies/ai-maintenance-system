import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103010000_time_synchronization_assurance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/timeSynchronization.ts", "utf8");
const component = readFileSync(
  "src/components/TimeSynchronizationAssurance.tsx",
  "utf8",
);
const governance = readFileSync("src/components/DataGovernance.tsx", "utf8");

describe("E12.07 governed time-synchronization assurance", () => {
  it("requires the collector's expected revision instead of rebinding an in-flight observation", () => {
    expect(migration).toContain(
      "p_configuration_revision integer default null",
    );
    expect(migration).toContain("expected clock-contract revision is required");
    expect(migration).toContain(
      "p_configuration_revision<>c.time_assurance_revision",
    );
    expect(migration).toContain(
      "observation names a superseded clock-contract revision",
    );
    const guard = migration.indexOf(
      "p_configuration_revision<>c.time_assurance_revision",
    );
    const insert = migration.indexOf(
      "insert into public.connector_time_observations(",
      guard,
    );
    expect(guard).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(guard);
  });

  it("uses explicit CI-only browser sources and tests disabled refusal without enabling demo feeds", () => {
    const fixture = readFileSync(
      "scripts/tests/time-assurance-browser-fixture.sql",
      "utf8",
    );
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const browser = readFileSync(
      "tests/e2e/time-synchronization-assurance.spec.ts",
      "utf8",
    );
    expect(workflow).toContain('test "${GITHUB_ACTIONS:-}" = true');
    expect(workflow).toContain("time-assurance-browser-fixture.sql");
    expect(fixture).toContain("e12-browser-enabled-synthetic");
    expect(fixture).toContain("e12-browser-disabled-synthetic");
    expect(fixture.toLowerCase()).not.toMatch(
      /update\s+(?:public\.)?connectors/,
    );
    expect(fixture.toLowerCase()).not.toContain("on conflict");
    expect(browser).not.toContain("options[0]");
    expect(browser).toContain('expectedState: "disabled"');
    expect(browser).toContain('expectedState: "unproven"');
    expect(browser).toContain("initial.enabled");
    expect(browser).toContain(
      "eligible_for_time_sensitive_evidence).toBe(false)",
    );
  });

  it("keeps numerical posture distinct from approved engineering evidence", () => {
    expect(migration).toContain(
      "'configurationevidenceverified',false,'eligiblefortimesensitiveevidence',false",
    );
    expect(migration).toContain(
      "'configuration_evidence_verified',false,'eligible_for_time_sensitive_evidence',false",
    );
    expect(component).toContain("an opaque evidence reference is not verified");
  });
  it("guards initial configuration and retains clock evidence even for owner writes", () => {
    expect(migration).toContain(
      "before insert or update or delete on public.connectors",
    );
    expect(migration).toContain("tg_op='insert'");
    expect(migration).toContain("connector clock history is retained");
    expect(migration).toContain(
      "before truncate on public.connector_time_observations",
    );
    expect(migration).toContain("for each statement");
  });

  it("reconstructs the event's recorded contract from the canonical ledger without hindsight", () => {
    expect(migration).toContain(
      "'contract_scope','recorded_contract_at_event'",
    );
    expect(migration).toContain("public.audit_events");
    expect(migration).toContain("'clock_contract_version',1");
    expect(migration).toContain("v_recorded_at<=p_event_time");
    expect(migration).toContain("x.received_at<=p_event_time");
    expect(migration).toContain("p_event_time>clock_timestamp()");
    expect(migration).not.toContain("current_contract_only");
    expect(migration).toContain("'configuration_audit_id'");
    expect(migration).toContain(
      "clock contract history is incomplete or inconsistent",
    );
  });

  it("reserves clock configuration audit receipts to the governed RPC, including service writes", () => {
    expect(migration).toContain("before insert on public.audit_events");
    expect(migration).toContain("app.time_assurance_audit_write");
    expect(migration).toContain(
      "clock configuration audit receipts require the governed configuration rpc",
    );
    expect(migration).toContain("new.new_state is distinct from");
    for (const forbidden of [
      "create table public.connector_time_contracts",
      "create table public.connector_time_history",
      "drop trigger if exists trg_audit_events_append_only",
    ])
      expect(migration).not.toContain(forbidden);
  });

  it("does not trust a caller-supplied digest as proof that the replayed envelope is identical", () => {
    for (const field of [
      "source_clock_at",
      "reference_clock_at",
      "round_trip_delay_ms",
      "measurement_uncertainty_ms",
      "evidence_reference",
    ]) {
      expect(migration).toContain(`existing.${field} is not distinct from`);
    }
    expect(migration).toContain(
      "same digest but a different observation envelope",
    );
  });

  it("extends the canonical connector instead of creating another source registry", () => {
    expect(migration).toContain("alter table public.connectors");
    expect(migration).toContain("public.connector_time_observations");
    for (const forbidden of [
      "create table public.connectors",
      "create table public.time_sources",
      "create table public.source_health",
      "create table public.assets",
    ]) {
      expect(migration).not.toContain(forbidden);
    }
  });

  it("keeps policy human-owned and observations service-only, immutable, and tenant-bound", () => {
    expect(migration).toContain("named same-tenant human administrator");
    expect(migration).toContain("coalesce(v_role,'')<>'admin'");
    expect(migration).toContain("clock observations are service-only");
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain("crosses the connector tenant boundary");
    expect(migration).toContain(
      "connector clock observations are immutable evidence",
    );
    expect(migration).toContain("organization_id=public.app_current_org()");
    expect(migration).toContain(
      "event-time assurance requires an authorized same-tenant user",
    );
    expect(migration).toContain(
      "revoke all on table public.connector_time_observations",
    );
  });

  it("computes offset server-side and does not understate transport uncertainty", () => {
    expect(migration).toContain(
      "extract(epoch from\n    (p_source_clock_at-p_reference_clock_at))*1000",
    );
    expect(migration).toContain(
      "p_measurement_uncertainty_ms<p_round_trip_delay_ms/2",
    );
    expect(migration).toContain(
      "abs(o.offset_ms)+o.measurement_uncertainty_ms<=c.time_tolerance_ms",
    );
    expect(migration).toContain("payload_sha256");
    expect(migration).toContain("delivery identifier was already used");
  });

  it("invalidates old evidence on reconfiguration and fails closed for stale or absent evidence", () => {
    expect(migration).toContain("v_revision:=c.time_assurance_revision+1");
    expect(migration).toContain(
      "x.configuration_revision=c.time_assurance_revision",
    );
    expect(migration).toContain(
      "o.reference_clock_at + make_interval(mins=>c.time_observation_max_age_minutes)<clock_timestamp()",
    );
    expect(migration).toContain(
      "delivery identifier belongs to a superseded clock-contract revision",
    );
    for (const state of [
      "unconfigured",
      "disabled",
      "unproven",
      "stale",
      "synchronized",
      "untrusted",
    ]) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).toContain("eligible_for_time_sensitive_evidence");
  });

  it("exposes a customer-reachable read and configuration surface without operational authority", () => {
    expect(service).toContain('"get_connector_time_assurance"');
    expect(service).toContain('"configure_connector_time_assurance"');
    expect(component).toContain("Save clock contract");
    expect(component).toContain("does not set plant clocks");
    expect(governance).toContain("<TimeSynchronizationAssurance />");
    expect(migration).toContain("'operationalauthority',false");
    expect(migration).toContain("'setssourceclocks',false");
  });
});

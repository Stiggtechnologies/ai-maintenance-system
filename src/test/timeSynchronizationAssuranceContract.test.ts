import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103030000_time_synchronization_assurance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/timeSynchronization.ts", "utf8");
const component = readFileSync(
  "src/components/TimeSynchronizationAssurance.tsx",
  "utf8",
);
const governance = readFileSync("src/components/DataGovernance.tsx", "utf8");

describe("E12.07 governed time-synchronization assurance", () => {
  it("mounts exactly one independent clock sibling outside governance loading/error returns", () => {
    const wrapper =
      governance
        .split("export function DataGovernance() {")[1]
        ?.split("function DataGovernanceReadout()")[0] ?? "";
    expect(wrapper).toContain("<DataGovernanceReadout />");
    expect(wrapper.match(/<TimeSynchronizationAssurance\s*\/>/g)).toHaveLength(
      1,
    );
    expect(wrapper).not.toMatch(/if\s*\(\s*(?:loading|error)/);
    const readout =
      governance.split("function DataGovernanceReadout()")[1] ?? "";
    expect(readout).toContain(
      'if (loading) return <LoadingState label="Loading data governance" />',
    );
    expect(readout).toContain(
      "if (error) return <ErrorState message={error} onRetry={refetch} />",
    );
    expect(readout).not.toContain("<TimeSynchronizationAssurance");
  });

  it("uses distinct fresh clock sources per browser attempt without resetting retained state", () => {
    const fixture = readFileSync(
      "scripts/tests/time-assurance-browser-fixture.sql",
      "utf8",
    );
    const browser = readFileSync(
      "tests/e2e/time-synchronization-assurance.spec.ts",
      "utf8",
    );
    const config = readFileSync("playwright.config.ts", "utf8");
    for (const enabled of ["enabled", "disabled"]) {
      for (const attempt of [0, 1]) {
        expect(fixture).toContain(
          `e12-browser-${enabled}-synthetic-attempt-${attempt}`,
        );
      }
    }
    expect(fixture.toLowerCase()).not.toMatch(
      /\b(?:update|delete|truncate)\b|on conflict/,
    );
    expect(browser).toContain("`${fixture.key}-attempt-${testInfo.retry}`");
    expect(browser).toContain("expect(matches).toHaveLength(1)");
    expect(browser).toContain("expect(initial.configurationRevision).toBe(0)");
    expect(browser).toContain("expect(initial.configuredAt).toBeNull()");
    expect(browser).not.toMatch(/page\.route\(|route\.fulfill\(/);
    expect(config).toContain("retries: process.env.CI ? 1 : 0");
    expect(config).toContain("timeout: 90_000");
  });

  it("reconciles a configuration intent through its tenant-bound canonical receipt before changing the revision", () => {
    expect(migration).toContain("p_idempotency_key uuid default null");
    expect(migration).toContain(
      "idx_audit_connector_time_configuration_intent",
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("v_receipt.actor is distinct from v_uid::text");
    expect(migration).toContain("v_receipt.new_state->>'configuration_basis'");
    expect(migration).toContain(
      "'current_configuration_revision',c.time_assurance_revision",
    );
    expect(migration).toContain("'idempotency_key',p_idempotency_key");
    const replay = migration.indexOf("'audit_id',v_receipt.id");
    const revision = migration.indexOf(
      "v_revision:=c.time_assurance_revision+1",
    );
    expect(replay).toBeGreaterThan(0);
    expect(revision).toBeGreaterThan(replay);
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.connector_time_(?:intents|requests|executions)/,
    );
  });

  it("requires current administrator standing only for a clock-field change, not unrelated source revocation", () => {
    expect(migration).toContain(
      "if v_clock_changed and new.time_configured_by is not null",
    );
    expect(migration).toContain("and v_clock_changed then");
    expect(migration).not.toContain(
      "if new.time_configured_by is not null and not exists",
    );
  });

  it("rechecks current caller standing after serialization waits before disclosing a replay receipt", () => {
    const lockedConnector = migration.indexOf(
      "where id=p_connector_id and organization_id=v_org for update",
    );
    const recheck = migration.indexOf(
      "authorization changed while configuration waited for serialization",
    );
    const receipt = migration.indexOf(
      "select * into v_receipt from public.audit_events",
    );
    expect(lockedConnector).toBeGreaterThan(0);
    expect(recheck).toBeGreaterThan(lockedConnector);
    expect(receipt).toBeGreaterThan(recheck);
  });

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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101200000_data_steward_agent.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/dataStewardAgentService.ts", "utf8");
const panel = readFileSync(
  "src/components/DataStewardAgentWorkbench.tsx",
  "utf8",
);
const host = readFileSync("src/components/DataGovernance.tsx", "utf8");
const smoke = readFileSync("scripts/ci-data-steward-agent-smoke.sh", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("governed Data Steward Specialist execution", () => {
  it("reuses every canonical source family instead of creating shadows", () => {
    for (const source of [
      "public.assets",
      "public.components",
      "public.work_orders",
      "public.failure_code_map",
      "public.data_domains",
      "public.data_quality_slas",
      "public.sensor_validation_rules",
      "public.instrument_calibrations",
      "public.historian_tag_map",
      "public.archive_records",
      "public.agent_runs",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain("create table if not exists public.assets");
    expect(migration).not.toContain(
      "create table if not exists public.failure_code_map",
    );
  });

  it("covers hierarchy, failure codes, master data and data quality", () => {
    for (const mode of [
      "'asset hierarchy'",
      "'failure codes'",
      "'master data'",
      "'data-quality management'",
    ])
      expect(migration).toContain(mode);
    for (const finding of [
      "asset_identity_incomplete",
      "asset_hierarchy_incomplete",
      "failure_mechanism_coding_incomplete",
      "source_failure_vocabulary_unclassified",
      "data_quality_sla_breached",
      "sensor_validation_rules_incomplete",
      "instrument_calibration_overdue",
      "historian_mapping_unconfirmed",
    ])
      expect(migration).toContain(finding);
  });

  it("activates named-human master-data controls with evidence and locking", () => {
    for (const control of [
      "upsert_data_domain",
      "record_data_quality_sla",
      "record_instrument_calibration",
      "confirm_historian_tag_mapping",
      "record_archive_disposition",
    ]) {
      expect(migration).toContain(`function public.${control}`);
      expect(service).toContain(`"${control}"`);
    }
    expect(migration).toContain("version=version+1");
    expect(migration).toContain("changed after it was loaded");
    expect(migration).toContain(
      "a missing measurement is unknown, never passing",
    );
  });

  it("freezes exact tenant evidence and keeps the specialist advisory", () => {
    expect(migration).toContain("sync_data_steward_source_snapshot");
    expect(migration).toContain("extensions.digest");
    expect(migration).toContain(
      "agent run names a data domain outside its organization",
    );
    expect(migration).toContain(
      "data-steward assessments, assignments and dispositions are append-only",
    );
    for (const control of [
      "'maychangemasterdata',false",
      "'maymergeassets',false",
      "'maycodefailure',false",
      "'mayconfirmmapping',false",
      "'mayarchiverecord',false",
      "'maycreatework',false",
      "'mayacceptrisk',false",
      "'maycommitspend',false",
      "'mayreturntoservice',false",
    ])
      expect(migration).toContain(control);
  });

  it("requires independent named-human review without implicit remediation", () => {
    expect(migration).toContain(
      "segregation of duties requires a reviewer other than the assessment requester",
    );
    expect(migration).toContain(
      "segregation of duties requires disposition by a different named human",
    );
    expect(migration).toContain("this named human is not assigned to review");
    expect(migration).toContain("'masterdatachanged',false");
    expect(migration).toContain("'operationalauthorization',false");
  });

  it("is customer-operable from the existing Data Governance surface", () => {
    expect(service).toContain('"get_data_steward_workspace"');
    expect(service).toContain('"run_data_steward_agent"');
    expect(service).toContain('"assign_data_steward_review"');
    expect(service).toContain('"record_data_steward_disposition"');
    expect(panel).toContain("Run retained assessment");
    expect(panel).toMatch(/Record\s+governed\s+domain/);
    expect(panel).toContain("Record SLA evidence");
    expect(panel).toContain("Record calibration evidence");
    expect(panel).toContain("Confirm canonical mapping");
    expect(panel).toContain("Record archive disposition");
    expect(host).toContain("<DataStewardAgentWorkbench />");
  });

  it("keeps runtime proof in the clean migration gate and closes C1.12", () => {
    for (const proof of [
      "canonical_hierarchy=true",
      "failure_coding=true",
      "governed_domains=true",
      "dq_sla=true",
      "calibration_evidence=true",
      "historian_mapping=true",
      "archive_control=true",
      "exact_source_fingerprints=true",
      "tenant_wall=true",
      "immutable_assessment=true",
      "optimistic_lock=true",
      "sod_review=true",
      "no_agent_master_data_authority=true",
      "no_operational_authority=true",
    ])
      expect(smoke).toContain(proof);
    expect(workflow).toContain("bash scripts/ci-data-steward-agent-smoke.sh");
    expect(register).toMatch(/\| C1\.12 \|[^\n]+\| ✅[^\n]+/i);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20270102220000_bently_system1_condition_read_adapter.sql",
);
const edge = read(
  "supabase/functions/bently-system1-condition-read-pull/index.ts",
);
const shared = read(
  "supabase/functions/_shared/bently-system1-condition-read.ts",
);
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/bentlySystem1Read.ts");

describe("C2.19 Bently System 1 condition read contract", () => {
  it("extends the canonical connector and condition planes without another store", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
      "public.sensors",
      "public.condition_readings",
      "public.record_condition_reading",
    ])
      expect(migration).toContain(token);
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type='condition_monitoring_read'");
    expect(migration).toContain("register_ref='C2.19'");
  });

  it("is tenant-bound, human-governed, service-attested and read-only", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain(
      "returning id,enabled,write_enabled,connector_profile",
    );
    expect(migration).toContain(
      "'enabled',v_enabled",
    );
    expect(migration).toContain("a named human administrator must configure");
    expect(migration).toContain("sourceWriteBack',false");
    expect(migration).toContain("alarmAcknowledgement',false");
    expect(migration).toContain("controlAuthority',false");
    expect(migration).toContain("c.organization_id=r.organization_id");
    expect(migration).toContain("from public,anon,authenticated");
    expect(edge).toContain('method: "GET"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).toContain("entry.tenant_id !== organizationId");
  });

  it("binds exact nodes, canonical sensors, units and source evidence", () => {
    expect(migration).toContain("is_valid_system1_node_bindings");
    expect(migration).toContain("s.registry_status='active'");
    expect(migration).toContain("btrim(coalesce(s.unit,''))=btrim");
    expect(shared).toContain("is not administrator-approved");
    expect(shared).toContain("does not match canonical");
    expect(shared).toContain("must be an exact decimal string or safe integer");
  });

  it("reconciles complete bounded pages and advances only clean evidence", () => {
    expect(edge).toContain("MAX_TOTAL_BYTES");
    expect(edge).toContain("manifest.length >= maxPages");
    expect(edge).toContain("repeated a pagination cursor");
    expect(migration).toContain("v_bytes<>p_source_bytes");
    expect(migration).toContain(
      "extensions.digest(array_to_string(v_hashes,':'),'sha256')",
    );
    expect(migration).toContain("v_run.records_read<>v_expected");
    expect(migration).toContain("v_run.records_accepted+v_run.records_duplicate=v_expected");
    expect(migration).toContain("p_status='success' and v_run.records_rejected=0");
    expect(migration).not.toContain("select r,c into v_run,v_connector");
    expect(migration).toContain("select r.* into v_run from public.connector_runs r");
    expect(migration).toContain("select c.* into v_connector from public.connectors c");
  });

  it("wires administrator configuration, dry run and committed pull", () => {
    expect(page).toContain("BentlySystem1ConnectorSetup");
    expect(service).toContain('"configure_bently_system1_source"');
    expect(service).toContain('"bently-system1-condition-read-pull"');
    const component = read("src/components/BentlySystem1ConnectorSetup.tsx");
    expect(component).toContain("Validate complete dry run");
    expect(component).toContain("Pull governed readings");
    expect(component).toContain("AI administrators are limited to write-free validation");
  });
});

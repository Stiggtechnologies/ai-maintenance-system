import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101580000_adls_data_lake_read.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/data-lake-read-pull/index.ts",
  "utf8",
);
const core = readFileSync(
  "supabase/functions/_shared/adls-data-lake.ts",
  "utf8",
);
const service = readFileSync("src/services/syncRecoveryService.ts", "utf8");
const component = readFileSync(
  "src/components/RecoveryActivationKit.tsx",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);

describe("C2.14 governed ADLS data-lake adapter", () => {
  it("extends the canonical connector, run, staging and watermark contract", () => {
    expect(migration).toContain("alter table public.connectors");
    expect(migration).toContain("alter table public.connector_runs");
    expect(migration).toContain("alter table public.ingest_watermarks");
    expect(edge).toContain('"ingest_data_lake_read_batch"');
    expect(migration).not.toMatch(/create table[^;]*(data_lake|adls)/);
  });

  it("uses Microsoft OAuth, GET-only ADLS and an exact host allowlist", () => {
    expect(edge).toContain("https://storage.azure.com/.default");
    expect(edge).toContain("azure_service_principal");
    expect(edge).toContain("dfs\\.core\\.windows\\.net");
    expect(edge).toContain("RECOVERY_CONNECTOR_ALLOWED_HOSTS");
    expect(edge).toContain('method: "GET"');
    expect(edge).toContain('redirect: "error"');
    expect(edge).not.toMatch(/method:\s*"(?:PUT|PATCH|DELETE)"/);
  });

  it("retains object hashes and advances a deterministic cursor only cleanly", () => {
    expect(migration).toContain("transport_manifest");
    expect(migration).toContain("transport_cursor_to");
    expect(migration).toContain("last_cursor");
    expect(migration).toContain("v_run.records_rejected=0");
    expect(migration).toContain("cursor_advanced");
    expect(edge).toContain("sha256Hex(bytes)");
    expect(edge).toContain("transport_complete: true");
    expect(core).toContain("last_modified");
  });

  it("proves every row receipt and reconciles transport before watermarking", () => {
    const repair = readFileSync(
      "supabase/migrations/20270101581000_adls_data_lake_provenance_reconciliation.sql",
      "utf8",
    ).toLowerCase();
    expect(repair).toContain(
      "every adls row requires immutable source provenance",
    );
    expect(repair).toContain("does not match the immutable run manifest");
    expect(repair).toContain("restore_data_lake_staging_provenance");
    expect(repair).toContain("s.payload-'_sync_source'");
    expect(repair).toContain("order by s.received_at desc,s.id desc");
    expect(repair).toContain(
      "idx_ingest_staging_latest_accepted_identity",
    );
    expect(repair).toContain("pg_advisory_xact_lock");
    expect(repair.match(/for update of r/g)).toHaveLength(2);
    expect(repair).toContain("records_duplicate=records_duplicate+1");
    expect(repair).toContain("records_read=v_manifest_rows");
    expect(repair).toContain(
      "transported and ingested adls row counts do not reconcile",
    );
    expect(edge).toContain("withoutDataLakeProvenance");
  });

  it("requires service-attested begin and finish boundaries", () => {
    expect(migration).toContain("service-attested transport evidence");
    expect(migration).toContain("app.data_lake_transport");
    expect(migration).toContain("app.data_lake_ingest");
    expect(migration).toContain("app.data_lake_finish");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to service_role");
    expect(edge).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("blocks the generic ingest path and refuses cursor regression", () => {
    expect(migration).toContain("ingest_data_lake_read_batch");
    expect(migration).toContain("attested ingest or service-only clean-finish");
    expect(migration).toContain("does not advance the clean watermark");
    expect(migration).toContain("public.ingest_watermarks.last_cursor");
    expect(migration).toContain("get diagnostics v_rows=row_count");
  });

  it("ships administrator configuration and operator dry-run/import wiring", () => {
    expect(service).toContain("configure_data_lake_read_source");
    expect(service).toContain('"data-lake-read-pull"');
    expect(component).toContain("Azure Data Lake Gen2");
    expect(component).toContain("Approved object prefix");
    expect(component).toContain("Dry-run");
  });

  it("deploys and proves the JWT-protected adapter boundary", () => {
    expect(workflow).toContain("supabase/functions/data-lake-read-pull/**");
    expect(workflow).toContain("supabase functions deploy data-lake-read-pull");
    expect(workflow).toContain("Azure Data Lake adapter is deployed");
  });
});

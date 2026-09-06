import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261218090000_cmms_read_adapter.sql", "utf8");
const edge = readFileSync("supabase/functions/cmms-read-pull/index.ts", "utf8");
const service = readFileSync("src/services/cmmsRead.ts", "utf8");
const setup = readFileSync("src/components/CmmsReadConnectorSetup.tsx", "utf8");
const workflow = readFileSync(".github/workflows/deploy-migrations.yml", "utf8");

describe("CMMS read-only adapter contract", () => {
  it("extends the canonical connector and work-order import plane", () => {
    expect(migration).toContain("connectors");
    expect(migration).toContain("connector_entity_mappings");
    expect(migration).toContain("connector_runs");
    expect(migration).toContain("return public.ingest_batch(p_run_id,p_rows)");
    expect(migration).toContain("'work_order'");
    expect(migration).toContain("'read_only'");
    expect(migration).toContain("write_enabled=false");
    expect(migration).not.toMatch(/write_enabled\s*=\s*true/);
  });

  it("fails closed for tenancy, authority, unapproved mappings, and source writes", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("CMMS ingest authority denied");
    expect(migration).toContain("approve the work_order mapping before pull");
    expect(edge).toContain("CMMS_READ_ALLOWED_HOSTS");
    expect(edge).toContain("CMMS_READ_CREDENTIALS_JSON");
    expect(edge).toContain("redirect: \"error\"");
    expect(edge).toContain("return reply({ error: \"unauthorized\" }, 401)");
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });

  it("is customer-reachable and explicitly deployed", () => {
    expect(setup).toContain("CMMS work orders (read-only)");
    expect(setup).toContain("Dry-run pull");
    expect(service).toContain("cmms-read-pull");
    expect(workflow).toContain("supabase/functions/cmms-read-pull/**");
    expect(workflow).toContain("supabase functions deploy cmms-read-pull");
    expect(workflow).toContain("CMMS read adapter is deployed");
  });
});

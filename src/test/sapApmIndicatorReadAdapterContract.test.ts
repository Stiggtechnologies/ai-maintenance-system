import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271027100100_sap_apm_indicator_read_adapter.sql",
);
const edge = read("supabase/functions/sap-apm-indicator-read-pull/index.ts");
const shared = read("supabase/functions/_shared/sap-apm-indicator-read.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/sapApmIndicatorRead.ts");

describe("C2.19 SAP APM indicator read contract", () => {
  it("reuses canonical sensors and the connector plane without a health table", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
      "public.sensors",
      "public.assets",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toContain("asset_health_monitoring");
    expect(migration).not.toMatch(/insert into public\.condition_readings/i);
    expect(migration).toContain("connector_profile='sap_apm_indicator'");
    expect(migration).toContain("register_ref='C2.19'");
  });

  it("is GET-only, service-attested and refuses source mutation", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable",
    );
    expect(migration).toContain("sourceWriteBack',false");
    expect(migration).toContain("measurementWrite',false");
    expect(migration).toContain("healthScoreWrite',false");
    expect(edge).toContain('method: "GET"');
    expect(edge).toContain('"X-API-Key"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).not.toContain("TimeseriesService");
    expect(shared).toContain("technicalObject_number eq");
    expect(shared).toContain("/Indicators");
  });

  it("stamps only an unbound sensor source and preserves engineering configuration", () => {
    expect(migration).toContain("source_system is null");
    expect(migration).toContain(
      "'last_value','warning_limit','alarm_limit','unit','registry_status'",
    );
    expect(migration).not.toMatch(/last_value\s*=/i);
    expect(migration).not.toMatch(/alarm_limit\s*=/i);
    expect(migration).toContain("s.registry_status='active'");
  });

  it("bounds pagination and requires every approved binding before a clean watermark", () => {
    expect(shared).toContain("next.origin !== firstUrl.origin");
    expect(edge).toContain("fetchedUrls.has(nextUrl.href)");
    expect(edge).toContain("normalizeSapApmIndicatorPullRequest(body)");
    expect(migration).toContain(
      "jsonb_array_length(v_connector.apm_indicator_bindings)",
    );
    expect(migration).toContain(
      "p_status='success' and v_run.records_rejected=0",
    );
  });

  it("wires the setup screen and leaves the deploy allowlist unchanged", () => {
    expect(page).toContain("SapApmIndicatorReadConnectorSetup");
    expect(service).toContain('"configure_sap_apm_indicator_source"');
    expect(service).toContain('"sap-apm-indicator-read-pull"');
    const component = read(
      "src/components/SapApmIndicatorReadConnectorSetup.tsx",
    );
    expect(component).toContain("Dry-run indicator confirmation");
    expect(component).toContain("does not write measurements");
    const workflow = read(".github/workflows/deploy-migrations.yml");
    expect(workflow).not.toContain("sap-apm-indicator-read-pull");
  });
});

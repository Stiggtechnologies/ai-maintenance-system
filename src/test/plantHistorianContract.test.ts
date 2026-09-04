import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORIAN_COLUMN_MAPPING,
  PLANT_HISTORIAN_ALLOWED_FIELDS,
  PLANT_HISTORIAN_REQUIRED_FIELDS,
} from "../lib/plant-historian";

const migration = readFileSync(
  "supabase/migrations/20261212090000_plant_historian_read_adapter.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/plant-historian-pull/index.ts",
  "utf8",
);
const service = readFileSync("src/services/plantHistorian.ts", "utf8");
const setup = readFileSync(
  "src/components/PlantHistorianConnectorSetup.tsx",
  "utf8",
);
const reliability = readFileSync(
  "src/components/ConditionMonitoring.tsx",
  "utf8",
);
const integrations = readFileSync("src/pages/IntegrationsPage.tsx", "utf8");
const workflow = readFileSync(
  ".github/workflows/deploy-migrations.yml",
  "utf8",
);
const ingestRowsLatest = readFileSync(
  "supabase/migrations/20261112090000_p6_schedule_import.sql",
  "utf8",
);

describe("plant historian read-only adapter contract", () => {
  it("extends the canonical ingest plane instead of inventing a second store", () => {
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.ingest_staging");
    expect(migration).toContain("public.connector_entity_mappings");
    expect(migration).toContain("public.ingest_batch");
    expect(migration).toContain("'condition_reading'");
    expect(migration).toContain("connector_type = 'plant_historian'");
    expect(migration).not.toContain("create table plant_historian");
    expect(migration).not.toContain("create table historian_readings");
  });

  it("stays read-only: no plant write-back, execute, or autonomous control", () => {
    expect(migration).toContain("direction = 'read_only'");
    expect(migration).toContain("write_enabled = false");
    expect(migration).toContain("'read_only'");
    expect(migration).not.toMatch(/write_enabled\s*=\s*true/);
    expect(edge).not.toContain("write_enabled: true");
    expect(edge).toMatch(/method:\s*"GET"/);
    expect(edge).not.toMatch(/method:\s*"PUT"/);
    expect(edge).not.toMatch(/method:\s*"PATCH"/);
    expect(setup).toMatch(/no write-back/i);
  });

  it("keeps secrets out of tenant-readable columns", () => {
    expect(migration).toContain("credential_binding_ref");
    expect(migration).toContain("opaque secret-store URI");
    expect(edge).toContain("PLANT_HISTORIAN_CREDENTIALS_JSON");
    expect(edge).toContain("PLANT_HISTORIAN_ALLOWED_HOSTS");
    expect(edge).toContain("Private and local endpoint targets are blocked");
    expect(setup).toContain("PLANT_HISTORIAN_ALLOWED_HOSTS");
    expect(setup).toContain("vault://tenant/historian");
  });

  it("reports seed/sim honestly when the connector is unset", () => {
    expect(migration).toContain("telemetry_mode");
    expect(migration).toContain("seed_sim");
    expect(migration).toContain("That is not live plant data.");
    expect(migration).toContain(
      "seed/sim telemetry is not citable as live plant evidence",
    );
    expect(reliability).toContain("plantHistorianActions.status");
    expect(reliability).toContain("not live plant data");
  });

  it("yields the simulator only for an enabled plant_historian connector", () => {
    expect(migration).toContain("create or replace function public.simulate_telemetry_tick()");
    expect(migration).toContain("c.connector_type = 'plant_historian'");
    expect(migration).toContain("c.enabled");
    expect(migration.toLowerCase()).not.toContain("ilike '%historian%'");
    expect(migration).not.toContain("from integrations");
  });

  it("does not loosen the manual-upload ingest_rows door", () => {
    expect(ingestRowsLatest).toMatch(/c\.connector_type\s*=\s*'manual_upload'/);
    expect(migration).not.toContain("create or replace function public.ingest_rows");
    expect(migration).toContain("return public.ingest_batch(p_run_id, p_rows)");
    expect(migration).toContain("plant historian run not found");
  });

  it("cites only connector-backed readings on recommendations", () => {
    expect(migration).toContain("attach_plant_historian_evidence");
    expect(migration).toContain("historian_reading");
    expect(migration).toContain("cr.source_system = v_connector.connector_key");
    expect(service).toContain("attach_plant_historian_evidence");
    expect(reliability).toContain("Cite historian readings");
  });

  it("keeps mapping fields aligned with the condition_reading contract", () => {
    for (const field of PLANT_HISTORIAN_ALLOWED_FIELDS) {
      expect(migration).toContain(`'${field}'`);
    }
    for (const field of PLANT_HISTORIAN_REQUIRED_FIELDS) {
      expect(DEFAULT_HISTORIAN_COLUMN_MAPPING[field]).toBeDefined();
    }
    expect(DEFAULT_HISTORIAN_COLUMN_MAPPING.sensor_name).toBe("sensor_name");
  });

  it("is tenant-bound and not granted to anon", () => {
    expect(migration).toMatch(/v_org\s+uuid\s*:=\s*public\.app_current_org\(\)/);
    expect(migration).toContain("organization_id = v_org");
    expect(migration).not.toMatch(/grant execute[^;]+to anon/i);
    expect(migration).toContain("from public, anon");
  });

  it("is reachable from Integrations and Reliability, not a dead adapter", () => {
    expect(integrations).toContain("PlantHistorianConnectorSetup");
    expect(setup).toContain("plantHistorianActions.configureSource");
    expect(setup).toContain("Dry-run pull");
    expect(service).toContain("plant-historian-pull");
  });

  it("deploys and boundary-probes the JWT-protected REST adapter", () => {
    expect(workflow).toContain("supabase/functions/plant-historian-pull/**");
    expect(workflow).toContain(
      "supabase functions deploy plant-historian-pull",
    );
    expect(workflow).toContain("Plant historian adapter is deployed");
    expect(edge).toContain('return json({ error: "unauthorized" }, 401)');
  });
});

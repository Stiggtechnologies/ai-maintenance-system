import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270101750000_azure_iot_operations_ingress.sql",
);
const edge = read("supabase/functions/azure-iot-operations-ingest/index.ts");
const core = read("supabase/functions/_shared/azure-iot-operations-ingress.ts");
const relay = read("infra/azure/iot-operations-relay/src/functions/relay.ts");
const workflow = read(".github/workflows/deploy-migrations.yml");
const integrations = read("src/pages/IntegrationsPage.tsx");
const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
  activeFunctions: string[];
  allowedNoVerifyJwt: string[];
};

describe("Azure IoT Operations governed ingress contract", () => {
  it("extends canonical connector, tag-map, staging and condition-reading contracts", () => {
    expect(migration).toContain("public.connectors");
    expect(migration).toContain("public.connector_runs");
    expect(migration).toContain("public.historian_tag_map");
    expect(migration).toContain("public.ingest_staging");
    expect(migration).toContain("public.ingest_batch(v_run,v_rows)");
    expect(migration).not.toMatch(/create table .*azure_iot.*reading/i);
    expect(migration).not.toMatch(/create table .*asset/i);
  });

  it("binds service ingress to one tenant and a named-human approved connector", () => {
    expect(migration).toContain("p_organization_id uuid");
    expect(migration).toContain("ingress_key_id=btrim(p_ingress_key_id)");
    expect(migration).toContain("ingress_authorized_by");
    expect(migration).toContain("u.organization_id=p_organization_id");
    expect(migration).toContain("u.role in ('admin','ai_admin')");
    expect(migration).toContain(
      ") from public,anon,authenticated;\ngrant execute on function public.ingest_azure_iot_operations_batch(",
    );
    expect(migration).toContain(") to service_role;");
  });

  it("requires named-human tag confirmation and retains explicit rejects", () => {
    expect(migration).toContain("h.confirmed_by is not null");
    expect(migration).toContain("h.confirmed_at is not null");
    expect(migration).toContain("tag has no named-human confirmed mapping");
    expect(migration).toContain("'rejected',v_reason");
    expect(migration).toContain("then 'partial' else 'success'");
    expect(migration).toContain("watermark did not advance");
    expect(migration).toContain("then 'stale'");
    expect(migration).toContain("expected_interval_minutes,1)*2");
    expect(migration).toContain(
      "c.connector_type in ('plant_historian','azure_iot_operations')",
    );
    expect(migration).toContain("'source_posture',case");
    expect(migration).toContain("then 'connector_backed'");
  });

  it("has no plant-control path and gives the relay receive-only instructions", () => {
    expect(migration).toContain("direction<>'read_only'");
    expect(migration).toContain("write_enabled");
    expect(migration).not.toMatch(/write_enabled\s*=\s*true/);
    expect(core).toContain("FORBIDDEN_CONTROL_KEYS");
    expect(core).toContain("control_payload_refused");
    expect(relay).toContain("app.eventHub");
    expect(relay).toContain("partition and offset metadata are required");
    expect(relay).toContain("Math.ceil(normalized.points.length / 500)");
    expect(relay).toContain(":chunk-${index + 1}-of-${deliveries}");
    expect(relay).not.toContain("app.mqtt");
    expect(relay).not.toContain("sendBatch");
  });

  it("preserves exact-request authentication, replay identity and provenance", () => {
    expect(core).toContain("HMAC");
    expect(core).toContain("maxSkewSeconds");
    expect(edge).toContain("x-syncai-signature");
    expect(edge).toContain("AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON");
    expect(migration).toContain("source_delivery_id");
    expect(migration).toContain("source_body_sha256");
    expect(migration).toContain("source_received_at");
    expect(migration).toContain("uq_connector_runs_source_delivery");
    expect(migration).toContain("p_body_sha256 is null");
    expect(migration).toContain("p_points is null");
    expect(migration).toContain("p_received_at < now()-interval '10 minutes'");
    expect(migration).toContain(
      "source timestamp is implausibly later than relay receipt",
    );
  });

  it("is customer reachable and deployed through the reviewed exception boundary", () => {
    expect(integrations).toContain("AzureIotOperationsConnectorSetup");
    expect(boundary.activeFunctions).toContain("azure-iot-operations-ingest");
    expect(boundary.allowedNoVerifyJwt).toContain(
      "azure-iot-operations-ingest",
    );
    expect(workflow).toContain(
      "supabase functions deploy azure-iot-operations-ingest --no-verify-jwt",
    );
    expect(workflow).toContain(
      "supabase/functions/azure-iot-operations-ingest/**",
    );
    expect(workflow).toContain(
      "supabase/functions/_shared/azure-iot-operations-ingress.ts",
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function functionBody(sql: string, name: string): string {
  const match = new RegExp(
    `create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\)\\s*returns[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`,
    "i",
  ).exec(sql);
  if (!match?.[1]) throw new Error(`missing ${name}`);
  return match[1];
}

const read = (path: string) => readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20270105160000_azure_iot_operations_ingress.sql",
);
const edge = read("supabase/functions/azure-iot-operations-ingest/index.ts");
const core = read("supabase/functions/_shared/azure-iot-operations-ingress.ts");
const relay = read("infra/azure/iot-operations-relay/src/functions/relay.ts");
const delivery = read("infra/azure/iot-operations-relay/src/delivery.ts");
const normalizer = read("infra/azure/iot-operations-relay/src/normalize.ts");
const workflow = read(".github/workflows/deploy-migrations.yml");
const ci = read(".github/workflows/ci.yml");
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
    expect(migration).toContain("u.role = 'admin'");
    expect(migration).not.toContain("ai_admin");
    expect(migration).not.toContain("request.jwt");
    expect(migration).toContain("app.service_organization_id");
    expect(migration).toContain("refuse_azure_iot_operations_delivery");
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
    expect(relay).toContain("retry: relayRetryPolicy");
    expect(delivery).toContain("maxRetryCount: -1");
    expect(delivery).toContain('strategy: "exponentialBackoff"');
    expect(normalizer).toContain(
      "partition and one offset per event are required",
    );
    expect(delivery).toContain("Math.ceil(points.length / chunkSize)");
    expect(delivery).toContain("chunkSize = 500");
    expect(delivery).toContain(":chunk-${index + 1}-of-${deliveries}");
    expect(relay).not.toContain("app.mqtt");
    expect(relay).not.toContain("sendBatch");
    expect(normalizer).toContain("configure Json or JsonGzip rather than UADP");
    expect(normalizer).toContain('messageType === "ua-event"');
    expect(normalizer).toContain('messageType === "ua-condition"');
  });

  it("preserves exact-request authentication, replay identity and provenance", () => {
    expect(core).toContain("HMAC");
    expect(core).toContain("maxSkewSeconds");
    expect(edge).toContain("x-syncai-signature");
    expect(edge).toContain("azureIotIngressStatus");
    expect(edge).toContain('error: "ingress_unavailable" }, 503');
    expect(edge).toContain("dead_lettered");
    expect(edge).toContain("AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON");
    expect(migration).toContain("source_delivery_id");
    expect(migration).toContain("source_body_sha256");
    expect(migration).toContain("length(ingress_key_id) between 8 and 80");
    expect(migration).toContain(
      "translate(source_body_sha256, '0123456789abcdef', '') = ''",
    );
    expect(migration).toContain("source_received_at");
    expect(migration).toContain("uq_connector_runs_source_delivery");
    expect(migration).toContain(
      "v_existing_body_sha256 is distinct from p_body_sha256",
    );
    expect(migration).toContain(
      "delivery ID collision: body digest differs from recorded delivery",
    );
    expect(migration).toContain("p_body_sha256 is null");
    expect(migration).toContain("p_points is null");
    expect(migration).toContain("p_received_at < now()-interval '10 minutes'");
    expect(migration).toContain(
      "source timestamp is implausibly later than relay receipt",
    );
    expect(migration).toContain("'source_format',v_point->>'source_format'");
    expect(migration).toContain("'publisher_id',v_point->>'publisher_id'");
    expect(migration).toContain(
      "'dataset_writer_name',v_point->>'dataset_writer_name'",
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
    expect(ci).toContain("Build Azure IoT Operations relay");
    expect(ci).toContain("infra/azure/iot-operations-relay");
  });

  it("changes the canonical writers only to resolve a service-role tenant", () => {
    const previousReadings = read(
      "supabase/migrations/20261004090100_condition_reading_written_once.sql",
    );
    const previousFinish = read(
      "supabase/migrations/20261004090000_route_the_import_door.sql",
    );
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const serviceOrg =
      /v_org uuid := case\s+when coalesce\(auth\.role\(\),''\) = 'service_role'[\s\S]*?end;/;
    for (const [name, previous] of [
      ["record_condition_reading", previousReadings],
      ["ingest_batch", previousReadings],
      ["finish_connector_run", previousFinish],
    ] as const) {
      const current = functionBody(migration, name);
      expect(current).toMatch(serviceOrg);
      expect(current).toContain("public.app_current_org()");
      expect(
        normalize(
          current.replace(serviceOrg, "v_org uuid := app_current_org();"),
        ),
      ).toBe(normalize(functionBody(previous, name)));
    }
  });
});

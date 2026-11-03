import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ServiceId } from "../../services/opc-ua-read-gateway/binary";
import { readOnlyServiceAllowlist } from "../../services/opc-ua-read-gateway/client";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271103160000_opc_ua_read_adapter.sql",
);
const edge = read("supabase/functions/opc-ua-read-pull/index.ts");
const shared = read("supabase/functions/_shared/opc-ua-read.ts");
const client = read("services/opc-ua-read-gateway/client.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/opcUaRead.ts");
const boundary = read("config/edge-function-boundary.json");
const workflow = read(".github/workflows/deploy-migrations.yml");

describe("C2.21 OPC-UA read contract", () => {
  it("reuses the canonical connector, run, staging and watermark planes", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type = 'opc_ua_read'");
    expect(migration).toContain("register_ref = 'C2.21'");
    expect(migration).toContain("'opc_ua'");
  });

  it("is service-attested, tenant-bound and permanently read-only", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable an OPC-UA source",
    );
    expect(migration).toContain("direction = 'read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("'sourceWriteBack', false");
    expect(migration).toContain("c.organization_id = r.organization_id");
    expect(migration).toContain("from public, anon, authenticated");
    expect(edge).toContain('method: "POST"');
    expect(edge).toContain("/v1/read");
    expect(edge).not.toContain("Deno.connect");
    expect(edge).not.toContain("node:net");
    expect(edge).not.toContain("WriteRequest");
    expect(edge).not.toContain("CallRequest");
    expect(client).not.toContain("WriteRequest");
    expect(client).not.toContain("CallRequest");
    expect(readOnlyServiceAllowlist).not.toContain(ServiceId.WriteRequest);
    expect(readOnlyServiceAllowlist).not.toContain(ServiceId.CallRequest);
  });

  it("keeps credentials in the secret registry and refuses a secure-channel downgrade", () => {
    expect(shared).toContain("will not downgrade");
    expect(shared).toContain(
      "Anonymous OPC-UA credential must not carry a password",
    );
    expect(edge).toContain("resolveOpcUaCredential");
    expect(edge).toContain("OPC_UA_READ_CREDENTIALS_JSON");
    expect(edge).not.toContain("access_token");
    expect(migration).toContain(
      "credential binding must be an opaque secret-store URI",
    );
    expect(migration).toContain("not write_enabled");
  });

  it("reconciles one read page and advances only a clean watermark", () => {
    expect(edge).toContain("buildOpcUaReadGatewayCall");
    expect(edge).toContain("normalizeOpcUaPullRequest(body)");
    expect(migration).toContain("v_bytes <> p_source_bytes");
    expect(migration).toContain("v_run.records_read <> v_expected");
    expect(migration).toContain("p_status = 'success'");
    expect(migration).toContain("v_run.records_rejected = 0");
    expect(migration).toContain("app.opc_ua_transport");
  });

  it("wires the Integrations OPC-UA entry to the setup screen without claiming deployment", () => {
    expect(page).toContain("OpcUaReadConnectorSetup");
    expect(page).toContain("opc-ua-read-setup");
    expect(service).toContain('"configure_opc_ua_read_source"');
    expect(service).toContain('"opc-ua-read-pull"');
    const component = read("src/components/OpcUaReadConnectorSetup.tsx");
    expect(component).toContain("Dry-run node read");
    expect(component).toContain("Record node snapshot");
    expect(component).toContain("not certified against a live server");
    expect(boundary).not.toContain("opc-ua-read-pull");
    expect(workflow).not.toContain("opc-ua-read-pull");
  });
});

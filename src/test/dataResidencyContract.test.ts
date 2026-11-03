import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271103150000_tenant_data_residency.sql",
  "utf8",
).toLowerCase();
const panel = readFileSync("src/components/DataResidencyPanel.tsx", "utf8");
const service = readFileSync("src/services/dataResidencyService.ts", "utf8");
const settings = readFileSync("src/pages/SettingsPage.tsx", "utf8");

const connectorPulls = [
  "supabase/functions/cmms-read-pull/index.ts",
  "supabase/functions/plant-historian-pull/index.ts",
  "supabase/functions/p6-schedule-read-pull/index.ts",
  "supabase/functions/sap-s4-inventory-read-pull/index.ts",
  "supabase/functions/sap-s4-financial-read-pull/index.ts",
  "supabase/functions/bently-system1-condition-read-pull/index.ts",
  "supabase/functions/recovery-activation-pull/index.ts",
  "supabase/functions/azure-iot-operations-ingest/index.ts",
];

const storagePaths = [
  ["src/services/fieldCapture.ts", "failure-evidence"],
  ["src/services/syncConversation.ts", "sync-attachments"],
  ["src/services/riaDataRoom.ts", "ria-source-files"],
] as const;

describe("E12.14 tenant data residency", () => {
  it("stores one current declaration and path binding in the canonical ledger", () => {
    expect(migration).toContain(
      "create table if not exists public.tenant_residency_declarations",
    );
    expect(migration).toContain(
      "create table if not exists public.tenant_residency_bindings",
    );
    expect(migration).toContain("idx_tenant_residency_current");
    expect(migration).toContain("idx_tenant_residency_binding_current");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("insert into public.security_events");
    expect(migration).not.toMatch(
      /create table[^;]+(audit_events|security_events)/,
    );
    expect(migration).toContain(
      "residency records are retained; supersede them",
    );
    expect(migration).toContain("app.tenant_residency_writer");
  });

  it("requires a named administrator, a verified factor and an AAL2 session to declare", () => {
    expect(migration).toContain(
      "coalesce(v_role, '') not in ('admin', 'executive')",
    );
    expect(migration).toContain("app_actor_has_verified_mfa(v_uid)");
    expect(migration).toContain("app_current_aal() <> 'aal2'");
    expect(migration).toContain("declare_tenant_residency");
    expect(migration).toContain("bind_tenant_residency_path");
    expect(migration).toContain(
      "revoke all on function public.declare_tenant_residency(text, text) from public, anon, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.declare_tenant_residency(text, text) to authenticated",
    );
  });

  it("refuses undeclared, unbound, invalid and mismatched paths", () => {
    expect(migration).toContain("residency_undeclared");
    expect(migration).toContain("residency_path_unbound");
    expect(migration).toContain("residency_path_invalid");
    expect(migration).toContain("residency_region_mismatch");
    expect(migration).toContain("current_binding_matches");
    expect(migration).toContain("v_allowed boolean := false");
    expect(migration).toContain("v_bound is distinct from v_region");
    expect(migration).toContain("authorize_data_residency");
    expect(migration).toContain("authorize_service_data_residency");
    const egress = migration.slice(
      migration.indexOf("function public.evaluate_data_egress"),
    );
    expect(egress.indexOf("evaluate_data_residency")).toBeGreaterThan(-1);
    expect(egress.indexOf("evaluate_data_residency")).toBeLessThan(
      egress.indexOf("insert into public.audit_events"),
    );
    expect(egress).toContain("'ai_provider'");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("v_org uuid := public.app_current_org()");
  });

  it("refuses authenticated storage inserts that are outside the declaration", () => {
    expect(migration).toContain(
      "create policy tenant_residency_storage_insert",
    );
    expect(migration).toContain("on storage.objects");
    expect(migration).toContain("as restrictive");
    expect(migration).toContain("storage_residency_permitted(bucket_id)");
    expect(migration).toContain("for insert");
  });

  it("refuses a canonical connector run before the run row is opened", () => {
    const body = migration.slice(
      migration.indexOf("function public.begin_connector_run"),
    );
    expect(body.indexOf("evaluate_data_residency")).toBeLessThan(
      body.indexOf("insert into connector_runs"),
    );
    expect(body).toContain("data residency refused");
    expect(body).toContain("app_current_org()");
  });

  it.each(connectorPulls)("refuses %s before the transfer", (path) => {
    const source = readFileSync(path, "utf8");
    const handler = source.slice(source.indexOf("Deno.serve"));
    expect(handler).toContain("dataResidencyDenial");
    expect(handler).toContain("data_residency_denied");
    const denial = handler.indexOf("dataResidencyDenial(");
    const transfer = Math.min(
      ...["await fetch(", "ingest_azure_iot_operations_batch"].map((marker) => {
        const at = handler.indexOf(marker);
        return at === -1 ? Number.POSITIVE_INFINITY : at;
      }),
    );
    expect(denial).toBeGreaterThan(-1);
    expect(denial).toBeLessThan(transfer);
  });

  it("refuses processing routes before calculation or document intake continues", () => {
    for (const path of [
      "supabase/functions/calculation-service/index.ts",
      "supabase/functions/kb-document-intake/index.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("dataResidencyDenial");
      expect(source).toContain('"processing"');
    }
    const lake = readFileSync(
      "supabase/functions/data-lake-read-pull/index.ts",
      "utf8",
    ).slice(
      readFileSync(
        "supabase/functions/data-lake-read-pull/index.ts",
        "utf8",
      ).indexOf("Deno.serve"),
    );
    expect(lake.indexOf("dataResidencyDenial")).toBeLessThan(
      lake.indexOf("storageToken("),
    );
    expect(lake).toContain('"storage"');
  });

  it.each(storagePaths)(
    "checks residency before uploading %s",
    (path, bucket) => {
      const source = readFileSync(path, "utf8");
      expect(source.indexOf("assertDataResidency")).toBeLessThan(
        source.indexOf(`.from("${bucket}")`),
      );
      expect(source).toContain(`assertDataResidency("storage", "${bucket}")`);
    },
  );

  it("is an administrator control on Settings and does not claim plant authority", () => {
    expect(settings).toContain("<DataResidencyPanel />");
    expect(panel).toContain("Data residency");
    expect(panel).toContain("does not authorize plant action");
    expect(panel).toContain("declareTenantResidency");
    expect(panel).toContain("bindTenantResidencyPath");
    expect(service).toContain('"get_tenant_residency"');
    expect(service).toContain('"declare_tenant_residency"');
    expect(service).toContain('"bind_tenant_residency_path"');
    expect(service).toContain('"authorize_data_residency"');
    expect(service).toContain("operationalAuthority: false");
  });
});

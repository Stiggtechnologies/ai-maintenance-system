import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20271027100000_sap_s4_maintenance_order_read_adapter.sql",
);
const edge = read(
  "supabase/functions/sap-s4-maintenance-order-read-pull/index.ts",
);
const shared = read(
  "supabase/functions/_shared/sap-s4-maintenance-order-read.ts",
);
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/sapS4MaintenanceOrderRead.ts");

describe("C2.12 SAP S/4HANA maintenance order read contract", () => {
  it("reuses the canonical connector, run, staging, watermark and work order planes", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
      "public.work_orders",
      "public.assets",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type='maintenance_order_read'");
    expect(migration).toContain("register_ref='C2.12'");
  });

  it("is service-attested, tenant-bound and permanently read-only", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable",
    );
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("sourceWriteBack',false");
    expect(migration).toContain("a.organization_id=p_organization_id");
    expect(migration).toContain("c.organization_id=r.organization_id");
    expect(migration).toContain("from public,anon,authenticated");
    expect(edge).toContain('method: "GET"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).not.toContain("API_EQUIPMENT");
  });

  it("promotes only header fields and preserves closeout and approval evidence", () => {
    expect(shared).toContain("MaintenancePlanningPlant eq");
    expect(shared).toContain("/MaintenanceOrder");
    expect(migration).toContain(
      "'actual_failure_mode','actual_cause','corrective_action'",
    );
    expect(migration).not.toMatch(/actual_failure_mode\s*=/i);
    expect(migration).not.toMatch(/safety_flag\s*=/i);
    expect(migration).toContain("'human_created'");
    expect(migration).not.toContain("ai_generated");
  });

  it("bounds same-resource OData pagination and advances only a clean watermark", () => {
    expect(shared).toContain("next.origin !== firstUrl.origin");
    expect(shared).toContain("next.pathname !== firstUrl.pathname");
    expect(edge).toContain("MAX_TOTAL_BYTES - totalBytes");
    expect(edge).toContain("fetchedUrls.has(nextUrl.href)");
    expect(edge).toContain("normalizeSapMaintenanceOrderPullRequest(body)");
    expect(migration).toContain("v_bytes<>p_source_bytes");
    expect(migration).toContain("v_run.records_read<>v_expected");
    expect(migration).toContain(
      "p_status='success' and v_run.records_rejected=0",
    );
  });

  it("wires administrator configuration into Integrations without claiming deployment", () => {
    expect(page).toContain("SapS4MaintenanceOrderReadConnectorSetup");
    expect(service).toContain('"configure_sap_s4_maintenance_order_source"');
    expect(service).toContain('"sap-s4-maintenance-order-read-pull"');
    const component = read(
      "src/components/SapS4MaintenanceOrderReadConnectorSetup.tsx",
    );
    expect(component).toContain("Dry-run maintenance order pull");
    expect(component).toContain("Import maintenance order headers");
    const boundary = read("config/edge-function-boundary.json");
    const workflow = read(".github/workflows/deploy-migrations.yml");
    expect(boundary).not.toContain("sap-s4-maintenance-order-read-pull");
    expect(workflow).not.toContain("sap-s4-maintenance-order-read-pull");
  });
});

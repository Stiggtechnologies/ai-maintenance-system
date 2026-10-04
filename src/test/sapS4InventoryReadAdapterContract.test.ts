import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20270102190000_sap_s4_inventory_read_adapter.sql",
);
const edge = read("supabase/functions/sap-s4-inventory-read-pull/index.ts");
const shared = read("supabase/functions/_shared/sap-s4-inventory-read.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/sapS4InventoryRead.ts");

describe("C2.17 SAP S/4HANA inventory read contract", () => {
  it("reuses the canonical connector, run, staging, watermark and stock planes", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_staging",
      "public.ingest_watermarks",
      "public.material_stock",
      "public.materials",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type='inventory_read'");
    expect(migration).toContain("register_ref='C2.17'");
  });

  it("is service-attested, tenant-bound and permanently read-only", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain(
      "a named human administrator must configure or enable",
    );
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("sourceWriteBack',false");
    expect(migration).toContain("v_connector.inventory_site_id::text");
    expect(migration).toContain("m.organization_id=p_organization_id");
    expect(migration).toContain("c.organization_id=r.organization_id");
    expect(migration).toContain("from public,anon,authenticated");
    expect(edge).toContain('method: "GET"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  });

  it("counts only exact unrestricted non-special stock and preserves unproven quantities", () => {
    expect(shared).toContain("InventoryStockType eq '01'");
    expect(shared).toContain("InventorySpecialStockType eq ''");
    expect(shared).toContain(
      "SAP stock row escaped the approved plant/storage filter",
    );
    expect(migration).toContain(
      "SAP base unit does not exactly match the governed catalogue UOM",
    );
    expect(migration).toContain(
      "'qty_reserved','qty_on_order','expected_receipt_date'",
    );
    expect(migration).not.toMatch(/qty_reserved\s*=\s*excluded/i);
    expect(migration).not.toMatch(/qty_on_order\s*=\s*excluded/i);
  });

  it("bounds same-resource OData pagination and advances only a clean watermark", () => {
    expect(shared).toContain("next.origin !== firstUrl.origin");
    expect(shared).toContain("next.pathname !== firstUrl.pathname");
    expect(edge).toContain("MAX_TOTAL_BYTES");
    expect(edge).toContain("MAX_TOTAL_BYTES - totalBytes");
    expect(edge).toContain("fetchedUrls.has(nextUrl.href)");
    expect(edge).toContain("normalizeSapInventoryPullRequest(body)");
    expect(edge).toContain("manifest.length >= maxPages");
    expect(migration).toContain("v_bytes<>p_source_bytes");
    expect(migration).toContain("v_run.records_read<>v_expected");
    expect(migration).toContain(
      "p_status='success' and v_run.records_rejected=0",
    );
  });

  it("wires administrator configuration, dry run and committed pull into Integrations", () => {
    expect(page).toContain("SapS4InventoryReadConnectorSetup");
    expect(service).toContain('"configure_sap_s4_inventory_source"');
    expect(service).toContain('"sap-s4-inventory-read-pull"');
    const component = read(
      "src/components/SapS4InventoryReadConnectorSetup.tsx",
    );
    expect(component).toContain("Dry-run complete stock pull");
    expect(component).toContain("Import on-hand snapshot");
    expect(component).toContain(
      "Reservations and on-order quantities are never",
    );
  });
});

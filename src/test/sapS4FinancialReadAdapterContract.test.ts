import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSapGlCostMappings } from "../services/sapS4FinancialRead";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read(
  "supabase/migrations/20270102210000_sap_s4_financial_read_adapter.sql",
);
const edge = read("supabase/functions/sap-s4-financial-read-pull/index.ts");
const shared = read("supabase/functions/_shared/sap-s4-financial-read.ts");
const page = read("src/pages/IntegrationsPage.tsx");
const service = read("src/services/sapS4FinancialRead.ts");

describe("C2.18 SAP S/4HANA financial read contract", () => {
  it("extends the canonical connector and cost planes without another ledger", () => {
    for (const token of [
      "public.connectors",
      "public.connector_runs",
      "public.ingest_watermarks",
      "public.project_cost_items",
      "public.ingest_cost_actual_batch",
    ])
      expect(migration).toContain(token);
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain("connector_type='financial_read'");
    expect(migration).toContain("register_ref='C2.18'");
    expect(migration).toContain("record_cost_item");
  });

  it("is service-attested, tenant-bound and read-only", () => {
    expect(migration).toContain("coalesce(auth.role(),'')<>'service_role'");
    expect(migration).toContain("direction='read_only'");
    expect(migration).toContain("not write_enabled");
    expect(migration).toContain("sourceWriteBack',false");
    expect(migration).toContain("baselineAuthority',false");
    expect(migration).toContain("a named human administrator must configure");
    expect(migration).toContain(
      "'contract_hash',public.sap_s4_financial_contract_hash",
    );
    expect(migration).toContain(
      "not in ('planner','reliability_engineer','maintenance_manager','admin')",
    );
    expect(migration).toContain("c.organization_id=r.organization_id");
    expect(migration).toContain("from public,anon,authenticated");
    expect(edge).toContain('method: "GET"');
    expect(edge).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(edge).toContain("p_contract_hash: contractHash");
  });

  it("admits only explicit cumulative WBS/G-L mappings in one currency", () => {
    expect(shared).toContain("WBSElementInternalID eq");
    expect(shared).toContain("GLAccount eq");
    expect(shared).toContain("AmountInCompanyCodeCurrency");
    expect(shared).toContain("will not infer zero actuals");
    expect(shared).toContain("does not match approved");
    expect(migration).toContain("existing coded line");
    expect(migration).toContain("v_cost.currency<>v_currency");
  });

  it("bounds invariant OData pagination and advances only clean evidence", () => {
    expect(shared).toContain("next.origin !== firstUrl.origin");
    expect(shared).toContain("next.pathname !== firstUrl.pathname");
    expect(edge).toContain("MAX_TOTAL_BYTES");
    expect(edge).toContain("manifest.length >= maxPages");
    expect(migration).toContain("v_bytes<>p_source_bytes");
    expect(migration).toContain(
      "digest(array_to_string(v_hashes,':'),'sha256')",
    );
    expect(migration).toContain("v_run.records_read<>v_expected");
    expect(migration).toContain(
      "p_status='success' and v_run.records_rejected=0",
    );
    expect(migration).toContain("each canonical cost line exactly once");
    expect(migration).toContain("now()-interval '10 minutes'");
  });

  it("wires administrator configuration, dry run and committed pull", () => {
    expect(page).toContain("SapS4FinancialReadConnectorSetup");
    expect(service).toContain('"configure_sap_s4_financial_source"');
    expect(service).toContain('"sap-s4-financial-read-pull"');
    const component = read(
      "src/components/SapS4FinancialReadConnectorSetup.tsx",
    );
    expect(component).toContain("Validate dry run");
    expect(component).toContain("Pull cumulative actuals");
    expect(component).toContain("Missing source rows never become");
    expect(component).toContain("zero.");
  });

  it("parses the human-visible mapping format without guessing", () => {
    expect(
      parseSapGlCostMappings("WB1 | 4100 | CIVIL\nWB2 | 4200 | ELEC"),
    ).toEqual([
      { wbsElementInternalId: "WB1", glAccount: "4100", costItemRef: "CIVIL" },
      { wbsElementInternalId: "WB2", glAccount: "4200", costItemRef: "ELEC" },
    ]);
    expect(() => parseSapGlCostMappings("WB1|4100")).toThrow(/must be/i);
    expect(() =>
      parseSapGlCostMappings("WB1|4100|CIVIL\nWB1|4100|OTHER"),
    ).toThrow(/duplicates/i);
  });
});

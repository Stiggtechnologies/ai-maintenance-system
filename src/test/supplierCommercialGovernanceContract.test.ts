import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101280000_supplier_commercial_governance.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/supplierGovernanceService.ts",
  "utf8",
);
const controls = readFileSync(
  "src/components/SupplierGovernanceControls.tsx",
  "utf8",
);
const materials = readFileSync("src/pages/MaterialsPage.tsx", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const register = readFileSync(
  "docs/enterprise-readiness/capability-register.md",
  "utf8",
);

describe("E7 supplier and contractor governance", () => {
  it("extends every canonical store and creates no parallel table", () => {
    expect(migration).not.toMatch(/create table/);
    for (const canonical of [
      "public.contract_packages",
      "public.contract_performance",
      "public.warranty_terms",
      "public.warranty_claims",
      "public.supplier_deliveries",
      "public.suspect_parts",
      "public.vendor_advisories",
      "public.evidence_items",
      "public.audit_events",
    ]) {
      expect(migration).toContain(canonical);
    }
  });

  it("records immutable delivery facts without approving a supplier", () => {
    expect(migration).toContain("record_supplier_delivery");
    expect(migration).toContain("supplier delivery events are immutable");
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain("does not approve the supplier");
    expect(migration).toContain(
      "delivery supplier must belong to the same organization",
    );
  });

  it("retains suspect-part versions and keeps quarantine release human-controlled", () => {
    expect(migration).toContain("record_suspect_part_case");
    expect(migration).toContain("suspect-part case versions are immutable");
    expect(migration).toContain("quarantine release is refused");
    expect(migration).toContain("app_has_approval_authority");
    expect(migration).toContain("syncai has not declared it counterfeit");
  });

  it("separates vendor source capture from the human applicability assessment", () => {
    expect(migration).toContain("record_vendor_advisory");
    expect(migration).toContain("assess_vendor_advisory");
    expect(migration).toContain("vendor advisory versions are immutable");
    expect(migration).toContain(
      "syncai has not declared applicability or completion",
    );
    expect(migration).toContain("syncai did not execute the work");
  });

  it("is customer-reachable from Materials and links the governed commercial chain", () => {
    for (const rpc of [
      "get_supplier_governance_workspace",
      "record_supplier_delivery",
      "record_suspect_part_case",
      "record_vendor_advisory",
      "assess_vendor_advisory",
    ]) {
      expect(service).toMatch(new RegExp(`supabase\\.rpc\\(\\s*"${rpc}"`));
    }
    expect(materials).toContain("<SupplierGovernanceControls />");
    expect(controls).toContain("/develop/cases/${item.developmentCaseId}");
    expect(workflow).toContain(
      "bash scripts/ci-supplier-commercial-governance-smoke.sh",
    );
  });

  it("advances the proven supplier and warranty capabilities", () => {
    for (const id of [
      "E7.01",
      "E7.02",
      "E7.07",
      "E7.09",
      "E7.11",
      "E7.12",
      "E8.12",
    ]) {
      expect(register).toMatch(
        new RegExp(`\\| ${id.replace(".", "\\.")} \\|[^\\n]+\\| ✅`),
      );
    }
  });
});

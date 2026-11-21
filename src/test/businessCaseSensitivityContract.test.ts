import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271107120000_business_case_sensitivity.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const kernel = readFileSync("src/lib/value/sensitivity.ts", "utf8");
const surface = readFileSync("src/components/ValueManagement.tsx", "utf8");
const service = readFileSync("src/services/valueCalculationService.ts", "utf8");
const page = readFileSync("src/pages/ExecutiveIntelligence.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-value-calculation-lineage-smoke.sh",
  "utf8",
);
const recorder = readFileSync(
  "supabase/migrations/20261226090000_value_calculation_lineage.sql",
  "utf8",
);

describe("E9.11 business-case sensitivity", () => {
  it("calls the shared break-even kernel from the authenticated calculation service", () => {
    expect(kernel).toContain("findBreakEven(");
    expect(kernel).toContain("compareOptions(");
    expect(edge).toContain("analyseBusinessCaseSensitivity(");
    expect(edge).toContain('key: "business_case_sensitivity"');
    expect(edge).not.toContain("findBreakEven(");
    expect(surface).not.toContain("findBreakEven(");
    expect(surface).not.toContain("analyseBusinessCaseSensitivity(");
    expect(surface).toContain("Discount-rate sensitivity");
    expect(service).toContain('body: { action: "value_management", budget }');
    expect(page).toContain("<ValueManagement />");
  });

  it("reads tenant rows and ignores a client-supplied rate, flow, or break-even", () => {
    expect(edge).toContain('.eq("organization_id", organizationId)');
    expect(edge).not.toContain("body.discountRate");
    expect(edge).not.toContain("body.breakEven");
    expect(edge).not.toContain("body.cashFlows");
    expect(edge).not.toContain("body.sensitivity");
    expect(edge).toContain("sapActualsUsed: false");
    expect(edge).not.toContain("SAP_S4");
    expect(edge).not.toContain("sap-s4");
    expect(kernel).toContain("sapActualsUsed: false");
    expect(smoke).toContain('"discountRate":0.5');
    expect(smoke).toContain("abs(s['baseValue'] - 0.08)");
  });

  it("pins the calculation key and reuses the audited ledger", () => {
    expect(migration).toContain(
      "when p_key = 'business_case_sensitivity' then 'value-sensitivity/1/2026-11-03'",
    );
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/insert into public\.approvals/i);
    expect(migration).toContain(
      "revoke all on function public.sync_calculation_code_version(text) from public, anon",
    );
    expect(recorder).toContain("insert into public.audit_events");
    expect(recorder).toContain("insert into public.calculation_runs");
    expect(smoke).toContain(
      "business_case_sensitivity:value-sensitivity/1/2026-11-03:business_case:computed_with_refusals",
    );
    expect(smoke).toContain("entity_type='calculation_run'");
    expect(smoke).toContain("approvals_created=0");
    expect(edge).toContain("operationalAuthorization: false");
    expect(edge).toContain("do not approve a business case");
  });
});

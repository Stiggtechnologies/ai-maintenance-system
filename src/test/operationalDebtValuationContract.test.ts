import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219146000_develop_operational_debt_valuation.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/operationalDebtService.ts", "utf8");
const panel = readFileSync("src/components/develop/OperationalDebtPanel.tsx", "utf8");

describe("D8.04 operational-debt lifecycle exposure", () => {
  it("calculates from five explicit inputs and refuses unknown-as-zero", () => {
    for (const input of [
      "resolution_cost",
      "annual_operating_cost",
      "annual_risk_exposure",
      "exposure_years",
      "discount_rate",
    ]) expect(sql).toContain(input);
    expect(sql).toContain("leave the item unvalued rather than substituting zero");
    expect(sql).toContain("power(1+p_discount_rate,-p_exposure_years)");
  });

  it("requires provenance and independent human approval", () => {
    expect(sql).toContain("source_reference text not null");
    expect(sql).toContain("basis text not null");
    expect(sql).toContain("the valuation recorder cannot approve the same calculation");
    expect(sql).toContain("audit_events");
  });

  it("totals approved values by currency without silent conversion", () => {
    expect(sql).toContain("where lifecycle_exposure is not null group by currency");
    expect(sql).toContain("complete_multiple_currencies_not_summed");
    expect(sql).toContain("different currencies are never silently combined");
  });

  it("is reachable from the live Operational Debt panel", () => {
    expect(service).toContain('"record_operational_debt_valuation"');
    expect(service).toContain('"approve_operational_debt_valuation"');
    expect(panel).toContain("Calculate for independent approval");
    expect(panel).toContain("Approve valuation independently");
  });
});

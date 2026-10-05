import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102330000_verified_asset_foundation.sql",
  "utf8",
).toLowerCase();
const smoke = readFileSync(
  "scripts/ci-asset-foundation-smoke.sh",
  "utf8",
);

describe("verified asset foundation contract", () => {
  it("extends the canonical location and asset stores", () => {
    expect(migration).toContain("alter table public.asset_locations");
    expect(migration).toContain("alter table public.assets");
    expect(migration).toContain("parent_location_id");
    expect(migration).toContain("foundation_verification_id");
    expect(migration).not.toContain(
      "create table if not exists public.asset_hierarchy",
    );
  });

  it("uses a deterministic five-consequence criticality model", () => {
    expect(migration).toContain("public.asset_criticality_class");
    expect(migration).toContain(
      "greatest(p_safety,p_environmental,p_production,p_financial,p_regulatory)",
    );
    expect(migration).toContain(
      "stored criticality class must match the deterministic five-consequence model",
    );
  });

  it("requires evidence and independent named-human verification", () => {
    expect(migration).toContain("verification_status='verified'");
    expect(migration).toContain(
      "segregation of duties requires an independent hierarchy reviewer",
    );
    expect(migration).toContain(
      "segregation of duties requires an independent asset-foundation reviewer",
    );
    expect(migration).toContain(
      "hierarchy, criticality and boundary each require visible verified same-tenant evidence",
    );
  });

  it("retains decided records and protects the verified asset fields", () => {
    expect(migration).toContain("a decided hierarchy node is immutable");
    expect(migration).toContain(
      "asset foundation proposal content is immutable",
    );
    expect(migration).toContain("trg_protect_verified_asset_foundation");
    expect(migration).toContain(
      "verified hierarchy, criticality and boundary are changed only by a new independently reviewed foundation revision",
    );
  });

  it("does not create authority outside asset-definition verification", () => {
    for (const marker of [
      "'maychangework',false",
      "'mayapprove',false",
      "'mayacceptrisk',false",
      "'maycommitspend',false",
      "'maychangeoperatinglimits',false",
      "'mayreturntoservice',false",
    ]) {
      expect(migration).toContain(marker);
    }
  });

  it("uses only canonical evidence classes in the hosted runtime fixture", () => {
    const evidenceClasses = [
      "MEASURED",
      "INSPECTED",
      "CALCULATED",
      "TESTED",
      "DOCUMENTED",
      "HISTORICAL",
      "EXPERT_JUDGEMENT",
      "AI_INFERENCE",
    ];
    const fixtureClasses = Array.from(
      smoke.matchAll(/'([A-Z_]+)','verified'/g),
      (match) => match[1],
    );

    expect(fixtureClasses).toEqual([
      "DOCUMENTED",
      "CALCULATED",
      "INSPECTED",
      "DOCUMENTED",
    ]);
    expect(fixtureClasses.every((value) => evidenceClasses.includes(value))).toBe(
      true,
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219320000_multidimensional_consequence_model.sql",
  "utf8",
).toLowerCase();
const surface = readFileSync(
  "src/components/risk/RiskEnterprisePanels.tsx",
  "utf8",
);

const dimensions = [
  "fatality",
  "injury",
  "environmental_damage",
  "customer_interruption",
  "vulnerable_populations",
  "public_health",
  "transportation_disruption",
  "community_trust",
  "infrastructure_impact",
  "reputation",
  "political_regulatory",
];

describe("U9 multi-dimensional consequence model", () => {
  it("extends the canonical risk consequence model without a parallel table", () => {
    expect(migration).toContain("alter table public.risk_consequences");
    expect(migration).not.toMatch(/create table(?: if not exists)?\s+public\./);
    for (const dimension of dimensions) expect(migration).toContain(dimension);
  });

  it("requires provenance, explicit knowledge state and dimension-safe magnitude", () => {
    expect(migration).toContain("assessment_state");
    expect(migration).toContain("evidence_basis");
    expect(migration).toContain("magnitude_unit");
    expect(migration).toContain("known");
    expect(migration).toContain("estimated");
    expect(migration).toContain("predicted");
    expect(migration).toContain("unknown");
    expect(migration).toContain("conflicting");
    expect(migration).toContain(
      "magnitude and magnitude unit must be supplied together",
    );
  });

  it("enforces tenant scope and independent human verification", () => {
    expect(migration).toContain("app_current_org()");
    expect(migration).toContain("risk not found in this organization");
    expect(migration).toContain("evidence not found in this organization");
    expect(migration).toContain(
      "the author cannot verify their own consequence assessment",
    );
    expect(migration).toContain("reliability_engineer");
    expect(migration).toContain("executive");
    expect(migration).toContain("audit_events");
    expect(migration).toContain("revoke all");
    expect(migration).toMatch(/from public,\s*anon/);
  });

  it("makes full coverage visible without inventing an aggregate score", () => {
    expect(migration).toContain("get_risk_consequence_model");
    expect(migration).toContain("missing_dimensions");
    expect(migration).toContain("coverage_complete");
    expect(migration).toContain("no aggregate consequence score is calculated");
    for (const dimension of dimensions) expect(surface).toContain(dimension);
    expect(surface).toContain("Consequence coverage");
    expect(surface).toContain("No aggregate score");
  });
});

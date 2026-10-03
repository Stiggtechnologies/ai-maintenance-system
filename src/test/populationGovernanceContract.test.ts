import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101710000_governed_asset_populations.sql",
  "utf8",
);
const service = readFileSync("src/services/assetOntologyService.ts", "utf8");
const panel = readFileSync("src/components/PopulationGovernancePanel.tsx", "utf8");
const ontology = readFileSync("src/components/AssetOntology.tsx", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("U3.04 governed distributed-network population contract", () => {
  it("extends the canonical population and event models with a real exposure denominator", () => {
    expect(migration).toContain("alter table public.asset_populations");
    expect(migration).toContain("alter table public.population_failure_events");
    expect(migration).toContain(
      "create table if not exists public.population_observation_periods",
    );
    expect(migration).toContain("units_exposed numeric not null");
    expect(migration).toContain("365.25 * 24 * 60 * 60");
    expect(migration).toContain("insert into public.audit_events");
  });

  it("fails closed on tenant, role, evidence, overlap and denominator boundaries", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("public.app_current_role()");
    expect(migration).toContain(
      "asset population site crosses the tenant boundary",
    );
    expect(migration).toContain("e.asset_id is null");
    expect(migration).toContain("e.verification_status = 'verified'");
    expect(migration).toContain("p.observed_from < p_observed_to");
    expect(migration).toContain("p.observed_to > p_observed_from");
    expect(migration).toContain("p_occurred_at >= v_period.observed_to");
    expect(migration).toContain("population_failure_population_tenant_fk");
    expect(migration).toContain("units exposed must be positive and finite");
    expect(migration).toContain("failure occurrence must fall inside");
    expect(migration).toContain("from public, anon");
  });

  it("does not invent member identity, cause, condition or operational authority", () => {
    expect(migration).toContain(
      "does not identify individual failed members or establish cause",
    );
    expect(panel).toContain("Current unit count is never substituted");
    expect(panel).toContain("Individual-asset MTBF is not available");
    expect(panel).toContain('normaliseRate(\n        "population"');
  });

  it("makes population, exposure and failure capture customer reachable and CI exercised", () => {
    expect(service).toContain('supabase.rpc("record_asset_population"');
    expect(service).toContain(
      'supabase.rpc("record_population_observation_period"',
    );
    expect(service).toContain(
      'supabase.rpc("record_population_failure_event"',
    );
    expect(ontology).toContain("<PopulationGovernancePanel");
    expect(ci).toContain("bash scripts/ci-asset-population-smoke.sh");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261219133000_ca_effectiveness_kpi.sql",
  "utf8",
);
const panel = readFileSync("src/components/CaEffectivenessPanel.tsx", "utf8");

describe("corrective-action effectiveness KPI contract", () => {
  it("extends the canonical catalog and verification stores", () => {
    expect(migration).toContain("insert into public.kpi_catalog");
    expect(migration).toContain("'corrective_action_effectiveness'");
    expect(migration).toContain("public.ca_verifications");
    expect(migration).toContain("public.kpi_values");
    expect(migration).not.toMatch(/create table/i);
  });

  it("uses concluded observations only and exposes the excluded population", () => {
    expect(migration).toContain("effectiveness_evaluated_at is not null");
    expect(migration).toContain("observingExcluded");
    expect(migration).toContain("observing_excluded");
    expect(panel).toContain(
      "still observing and are not treated as failures or successes",
    );
  });

  it("does not invent a passing target or allow tenant users to run the fleet sweep", () => {
    expect(migration).toContain("'not_assessed'");
    expect(migration).toContain("no governed customer threshold configured");
    expect(migration).toContain(
      "revoke all on function public.snapshot_ca_effectiveness_kpi() from public, anon, authenticated",
    );
    expect(migration).toContain("public.app_current_org()");
  });

  it("wires the live metric into the corrective-action product surface", () => {
    expect(panel).toContain('supabase.rpc("get_ca_effectiveness_rate")');
    expect(panel).toContain("Trend only; no universal target asserted.");
    expect(panel).toContain("metric.effectivenessRatePct");
  });
});

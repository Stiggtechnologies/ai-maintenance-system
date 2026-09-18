import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219430000_project_assurance_reference_classes.sql",
  "utf8",
);
const service = readFileSync("src/services/projectAssuranceService.ts", "utf8");
const panel = readFileSync("src/components/ProjectAssurancePanel.tsx", "utf8");
const page = readFileSync("src/pages/DevelopmentPortfolioPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-project-assurance-reference-class-smoke.sh",
  "utf8",
);

describe("D5.10-D5.12 governed contract", () => {
  it("reuses canonical records and preserves immutable evidence and calculation lineage", () => {
    expect(migration).toContain("alter table public.learning_events");
    expect(migration).toContain("public.evidence_items");
    expect(migration).toContain("public.calculation_runs");
    expect(migration).toContain("enforce_verified_project_outcome_provenance");
    expect(migration).toContain("a verified project outcome is immutable");
    expect(migration).toContain("project_outcome_evidence_id");
    expect(migration).not.toMatch(
      /create table[^;]*(project_outcome|reference_class|project_benchmark)/i,
    );
  });

  it("implements all three capabilities with hard thin-history and tenant boundaries", () => {
    expect(migration).toContain(
      "p_minimum_sample:=greatest(coalesce(p_minimum_sample,5),5)",
    );
    expect(migration).toContain("h.lifecycle_type=c.lifecycle_type");
    expect(migration).toContain("e.organization_id=v_org");
    expect(migration).toContain(
      "No pattern, reference-class forecast or benchmark is claimed",
    );
    expect(migration).toContain("normalizedBenchmark");
    expect(migration).toContain("referenceForecast");
    expect(migration).toContain("assurancePatterns");
    for (const dimension of [
      "sizeBand",
      "complexityWithinOneOf",
      "geography",
      "lifecycleType",
      "technologyNoveltyWithinOneOf",
      "executionStrategy",
    ])
      expect(migration).toContain(dimension);
    for (const metric of [
      "medianStartupDelayDays",
      "medianCommissioningDefects",
      "medianSafetyIncidentRate",
      "medianStartupReliabilityPct",
      "medianEngineeringHoursPerMillionBaseline",
    ])
      expect(migration).toContain(metric);
    expect(migration).toContain("associationNotCausation");
    expect(migration).toContain("'recommendationOnly',true");
    expect(migration).toContain("'operationalAuthorization',false");
  });

  it("is reachable through the customer portfolio workspace and covered by runtime acceptance", () => {
    expect(service).toContain('"run_project_assurance_reference_class"');
    expect(service).toContain('"get_project_assurance_workspace"');
    expect(service).toContain('"record_verified_project_outcome"');
    expect(panel).toContain("Run governed comparison");
    expect(panel).toContain("Record immutable outcome");
    expect(panel).toContain("Insufficient project history");
    expect(page).toContain("<ProjectAssurancePanel />");
    expect(smoke).toContain("thin_history_refused=true");
    expect(smoke).toContain("tenant_wall=true");
    expect(smoke).toContain("lineage_snapshot=true");
  });
});

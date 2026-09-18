import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261219158000_develop_climate_concept_selection.sql",
  "utf8",
);

describe("D2.08 / D4.08 / D4.09 climate concept-selection persistence", () => {
  it("extends canonical options, evidence and audit rather than duplicating them", () => {
    expect(migration).toContain("references public.business_case_options(id)");
    expect(migration).toContain("references public.evidence_items(id)");
    expect(migration).toContain("insert into audit_events");
    expect(migration).not.toMatch(
      /create table(?: if not exists)? public\.(?:business_case_options|scenarios)\s*\(/i,
    );
    expect(migration).not.toMatch(/create table[^;]*audit/i);
  });

  it("pins all ten recorded dimensions and derives climate as the eleventh", () => {
    for (const dimension of [
      "capex",
      "opex",
      "safety",
      "reliability",
      "carbon",
      "energy",
      "water",
      "land",
      "waste",
      "social_effect",
    ]) {
      expect(migration).toContain(`'${dimension}'`);
    }
    expect(migration).toContain("'requiredDimensions',11");
    expect(migration).toContain(
      "climate_resilience is derived from its eight-hazard assessment",
    );
  });

  it("pins all eight future-condition hazards and requires all eight for review", () => {
    for (const hazard of [
      "extreme_temperature",
      "wildfire",
      "flood",
      "precipitation",
      "water_availability",
      "freeze_thaw",
      "permafrost",
      "storm_severity",
    ]) {
      expect(migration).toContain(`'${hazard}'`);
    }
    expect(migration).toContain("if v_count<>8 then");
    expect(migration).toContain("'requiredClimateHazards',8");
  });

  it("enforces tenant scope at the RPC and table walls", () => {
    expect(migration).toContain("enable row level security");
    expect(migration.match(/for select to authenticated using \(organization_id=public\.app_current_org\(\)\)/g)).toHaveLength(3);
    expect(migration).toContain("enforce_option_sustainability_scope");
    expect(migration).toContain("enforce_climate_assessment_scope");
    expect(migration).toContain("enforce_climate_hazard_scope");
    expect(migration).toContain("and organization_id=v_org");
    expect(migration).toContain("and organization_id=new.organization_id");
    expect(migration).toContain("No client write policy");
  });

  it("requires evidence, independent human review and immutable reviewed records", () => {
    expect(migration).toContain("evidence_item_id uuid not null");
    expect(migration).toContain("reviewed_by<>created_by");
    expect(migration).toContain("a.created_by=v_actor");
    expect(migration).toContain("app.climate_review_write");
    expect(migration).toContain("reviewed or superseded climate assessments are immutable");
    expect(migration).toContain("review_is_not_approval");
  });

  it("returns named gaps and never scores or selects an option", () => {
    expect(migration).toContain("'missingDimensions',missing_dimensions");
    expect(migration).toContain("'missingHazards'");
    expect(migration).toContain("SyncAI does not score, rank, certify or select an option");
    expect(migration).not.toMatch(/weighted_score|recommended_option|auto.?select/i);
  });
});

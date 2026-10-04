import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270102310000_strategy_field_learning_loop.sql",
  "utf8",
).toLowerCase();
const edge = readFileSync(
  "supabase/functions/calculation-service/index.ts",
  "utf8",
);
const service = readFileSync(
  "src/services/assetStrategyAgentService.ts",
  "utf8",
);
const workbench = readFileSync(
  "src/components/AssetStrategyAgentWorkbench.tsx",
  "utf8",
);
const smoke = readFileSync(
  "scripts/ci-strategy-field-learning-smoke.sh",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

describe("C8.10 governed strategy field-learning loop", () => {
  it("reuses canonical outcomes, learning, assessments and lifecycle plans", () => {
    for (const source of [
      "public.ca_verifications",
      "public.learning_events",
      "public.asset_strategy_assessments",
      "public.asset_lifecycle_plans",
      "public.maintenance_plans",
    ])
      expect(migration).toContain(source);
    expect(migration).not.toContain(
      "create table if not exists public.asset_strategy_recommendations",
    );
    expect(migration).not.toContain(
      "create table if not exists public.corrective_action_outcomes",
    );
  });

  it("captures only concluded, adopted-plan field outcomes with tenant provenance", () => {
    expect(migration).toContain("strategy_field_experience");
    expect(migration).toContain(
      "new.effectiveness in ('effective','ineffective')",
    );
    expect(migration).toContain("new.effectiveness_evaluated_at is not null");
    expect(migration).toContain("new.strategy_lifecycle_plan_id is not null");
    expect(migration).toContain("learning_events_ca_verification_tenant_fk");
    expect(migration).toContain(
      "corrective-action field-learning events are immutable",
    );
  });

  it("freezes the complete exact learning source set on every assessment", () => {
    expect(edge).toContain('"get_asset_strategy_source_v2"');
    expect(edge).toContain('"record_asset_strategy_run_v2"');
    expect(edge).toContain("p_learning_event_ids: fieldExperience.eventIds");
    expect(migration).toContain(
      "field-learning source set changed or does not match",
    );
    expect(migration).toContain("asset_strategy_assessment_learning_sources");
    expect(migration).toContain("source_snapshot");
    expect(migration).toContain(
      "asset-strategy field-learning provenance is immutable",
    );
  });

  it("keeps historical outcomes visible without repeatedly invalidating a new plan version", () => {
    expect(migration).toContain("appliestocurrentplanversion");
    expect(migration).toContain("appliedplanversion");
    expect(migration).toContain("currentineffectivecount");
    expect(migration).toContain("revisionrequired");
    expect(edge).toContain("fieldExperience.revisionRequired");
    expect(edge).toContain("current maintenance-plan version");
  });

  it("routes a refresh through the existing independent human adoption workflow", () => {
    expect(service).toContain('"get_asset_strategy_workspace_v2"');
    expect(workbench).toContain("Refresh from verified field experience");
    expect(workbench).toMatch(
      /Independent\s+review and named-human adoption remain mandatory/,
    );
    expect(migration).toContain("requiresindependentreviewandhumanadoption");
  });

  it("never grants operational authority to the refresh", () => {
    for (const control of [
      "'changesmaintenanceplan',false",
      "'createswork',false",
      "'acceptsrisk',false",
      "'commitsspend',false",
      "'changesoperatinglimits',false",
      "'returnstoservice',false",
    ])
      expect(migration).toContain(control);
  });

  it("is proven in the clean full-migration gate", () => {
    for (const marker of [
      "canonical_learning_event=true",
      "exact_source_set=true",
      "current_version_recurrence=true",
      "historical_version_boundary=true",
      "tenant_wall=true",
      "immutable_provenance=true",
      "no_automatic_programme_change=true",
    ])
      expect(smoke).toContain(marker);
    expect(workflow).toContain(
      "bash scripts/ci-strategy-field-learning-smoke.sh",
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220080002_eight_dimension_stage_substrate.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/developStageDimensionService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/StageDimensionSubstratePanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);

const dimensions = [
  "objective",
  "value",
  "risk",
  "evidence",
  "decision",
  "configuration",
  "work",
  "outcome",
];

describe("D11.11 eight-dimension stage substrate", () => {
  it("pins all eight dimensions and composes them beneath every framework stage", () => {
    for (const dimension of dimensions) {
      expect(migration).toContain(`'${dimension}'`);
      expect(service).toContain(`"${dimension}"`);
    }
    expect(migration).toContain("project_framework_stages");
    expect(migration).toContain("'dimensions', v_dimensions");
    expect(migration).toContain("records persist across stages");
    expect(migration).not.toMatch(/create table/i);
  });

  it("reads canonical sources and preserves explicit missing and authority states", () => {
    for (const source of [
      "risk_objectives",
      "business_cases",
      "value_metrics",
      "risks",
      "evidence_items",
      "decisions",
      "development_baselines",
      "thread_objects",
      "work_packages",
      "development_success_outcomes",
      "learning_events",
    ]) {
      expect(migration).toContain(source);
    }
    expect(migration).toContain("'missing'");
    expect(migration).toContain("not gate approval");
    expect(migration).toContain("no synthetic score");
  });

  it("is reachable from the customer workspace", () => {
    expect(service).toContain('supabase.rpc("get_case_stage_dimensions"');
    expect(panel).toContain("getCaseStageDimensions(caseId)");
    expect(panel).toContain("stage.dimensions.map");
    expect(workspace).toContain(
      "<StageDimensionSubstratePanel caseId={workspace.id} />",
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101730000_universal_mission_asset_objectives.sql",
  "utf8",
);
const service = readFileSync("src/services/missionOutcomeModels.ts", "utf8");
const panel = readFileSync("src/components/MissionOutcomeModels.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-mission-outcome-models-smoke.sh",
  "utf8",
);

describe("U1.02 universal mission asset objectives", () => {
  it("extends the canonical mission model with all four exact lenses", () => {
    expect(migration).toContain(
      "alter table public.organization_mission_outcome_models",
    );
    expect(migration).not.toContain(
      "create table public.mission_asset_objectives",
    );
    for (const dimension of [
      "safety",
      "reliability",
      "resilience",
      "economics",
    ]) {
      expect(migration).toContain(`'dimension', '${dimension}'`);
    }
    expect(migration).toContain("jsonb_array_length(p_value) = 4");
    expect(migration).toContain(
      "public.valid_universal_mission_asset_objectives(asset_objectives)",
    );
  });

  it("preserves evidence, uncertainty and human-authority boundaries", () => {
    expect(migration).toContain("evidenceRequirements");
    expect(migration).toContain("decisionBoundary");
    expect(migration).toContain("cannot be traded for financial benefit");
    expect(migration).toContain("No reliability target");
    expect(migration).toContain("remain unproven");
    expect(migration).toContain("granting work");
    expect(migration).toContain("human authority are required");
  });

  it("exposes the objectives through the existing customer workflow", () => {
    expect(migration).toContain("'assetObjectives', asset_objectives");
    expect(migration).toContain("'assetObjectives', m.asset_objectives");
    expect(service).toContain("export interface MissionAssetObjective");
    expect(panel).toContain("Universal asset objectives");
    expect(panel).toContain(
      "<AssetObjectives objectives={model.assetObjectives}",
    );
    expect(smoke).toContain("universal_asset_objectives=true");
  });
});

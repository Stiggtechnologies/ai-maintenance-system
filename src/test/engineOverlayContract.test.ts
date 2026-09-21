import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const migration = readFileSync(
  "supabase/migrations/20261220060001_cross_cutting_engine_overlays.sql",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/EngineOverlayPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
const service = readFileSync("src/services/developOverlayService.ts", "utf8");
const smoke = readFileSync("scripts/ci-engine-overlays-smoke.sh", "utf8");

describe("D11.03 eight-engine overlay contract", () => {
  it("composes exactly eight engines and all seven overlays", () => {
    for (const engine of [
      "frame",
      "value",
      "govern",
      "design",
      "control",
      "deliver",
      "ready",
      "realize",
    ])
      expect(migration).toContain(`'key','${engine}'`);
    for (const overlay of [
      "risk",
      "quality",
      "sustainability",
      "hop",
      "stakeholders",
      "evidence",
      "ai",
    ])
      expect(migration).toContain(`'key','${overlay}'`);
    expect(smoke).toContain("engines=8 overlays_each=7");
  });
  it("reads canonical stores without creating an overlay store or score", () => {
    for (const table of [
      "risks",
      "quality_requirements",
      "option_sustainability_observations",
      "human_performance_events",
      "stakeholder_commitments",
      "evidence_items",
      "recommendations",
    ])
      expect(migration).toContain(`public.${table}`);
    expect(migration).not.toMatch(/create table/i);
    expect(migration).toContain(
      "no duplicate overlay records or synthetic score",
    );
  });
  it("is reachable in the canonical case workspace with authority boundaries", () => {
    expect(service).toContain('"get_case_engine_overlays"');
    expect(page).toContain("<EngineOverlayPanel");
    expect(panel).toContain("Eight engines · seven cross-cutting overlays");
    expect(panel).toContain("authorityBoundary");
  });
});

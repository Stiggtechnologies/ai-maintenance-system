import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const m = readFileSync(
  "supabase/migrations/20261220050000_information_readiness_index.sql",
  "utf8",
);
const s = readFileSync(
  "src/services/informationReadinessIndexService.ts",
  "utf8",
);
const p = readFileSync(
  "src/components/develop/InformationReadinessIndexPanel.tsx",
  "utf8",
);
const w = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
describe("D11.23 information readiness index", () => {
  it("uses the exact §47 ratio over scoped canonical information objects", () => {
    expect(m).toContain("information_readiness_required");
    expect(m).toContain("commissioning_system_readiness_scope");
    expect(m).toContain("asset_onboarding_items");
    expect(m).toContain("100.0*v_accepted/v_total");
    expect(m).not.toMatch(/create table/i);
  });
  it("hard-blocks unresolved regulatory and safety-critical information", () => {
    expect(m).toContain("regulatory_information");
    expect(m).toContain("safety_mission_critical");
    expect(m).toContain("when v_hard>0 then 'BLOCKED'");
    expect(m).toContain("regardless of the index");
  });
  it("is reachable at project and system scope without granting authority", () => {
    expect(s).toContain('"get_case_information_readiness_index"');
    expect(p).toContain("model.systems.map");
    expect(p).toContain("hard blocker(s)");
    expect(w).toContain(
      "<InformationReadinessIndexPanel caseId={workspace.id} />",
    );
    expect(m).toContain("not regulatory certification");
  });
});

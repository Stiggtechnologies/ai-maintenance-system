import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220040000_physical_information_readiness.sql",
  "utf8",
);
const service = readFileSync(
  "src/services/physicalInformationReadinessService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/develop/PhysicalInformationReadinessPanel.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/pages/DevelopmentCaseWorkspacePage.tsx",
  "utf8",
);

describe("D11.08 physical and information readiness", () => {
  it("keeps independent project and system positions over canonical stores", () => {
    expect(migration).toContain("acceptance_tests");
    expect(migration).toContain("commissioning_systems");
    expect(migration).toContain("commissioning_system_readiness_scope");
    expect(migration).toContain("asset_onboarding_items");
    expect(migration).toContain("'physical'");
    expect(migration).toContain("'information'");
    expect(migration).not.toMatch(/create table/i);
  });
  it("preserves not-assessed and human-authority boundaries", () => {
    expect(migration).toContain("'NOT_ASSESSED'");
    expect(migration).toContain("then null else round");
    expect(migration).toContain("does not accept handover");
    expect(migration).toContain("named humans retain those authorities");
  });
  it("is reachable with project summary and system drill-down", () => {
    expect(service).toContain('"get_case_physical_information_readiness"');
    expect(panel).toContain("Project physical readiness");
    expect(panel).toContain("Project information readiness");
    expect(panel).toContain("model.systems.map");
    expect(workspace).toContain(
      "<PhysicalInformationReadinessPanel caseId={workspace.id} />",
    );
  });
});

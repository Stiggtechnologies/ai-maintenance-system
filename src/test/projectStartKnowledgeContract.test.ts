import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261220110000_project_start_knowledge_retrieval.sql",
  "utf8",
);
const service = readFileSync("src/services/developService.ts", "utf8");
const intake = readFileSync("src/pages/DevelopIntakePage.tsx", "utf8");
const surface = readFileSync("src/components/develop/RealizePanels.tsx", "utf8");

describe("D12.05 project-start knowledge retrieval", () => {
  it("composes the four required families from canonical stores", () => {
    expect(migration).toContain("screen_applicable_project_lessons(p_case_id)");
    expect(migration).toContain("e.event_type = 'project_outcome'");
    expect(migration).toContain("e.failure_mode_key = 'project_delivery.startup_failure'");
    expect(migration).toContain("get_vendor_quality_record");
    expect(migration).toContain("project_outcome_evidence_id");
    expect(migration).not.toMatch(/create table/i);
  });

  it("keeps tenant scope, provenance and unknown states explicit", () => {
    expect(migration).toContain("organization_id = v_org");
    expect(migration).toContain("independently verified project outcomes");
    expect(migration).toContain("No comparable completed-project estimate outcomes");
    expect(migration).toContain("contract_performance");
    expect(migration).toContain("No measured vendor performance period");
    expect(migration).toContain("No matching startup failure");
    expect(migration).toContain("recommendationOnly', true");
    expect(migration).toContain("authorization', false");
  });

  it("runs at case creation and remains reachable in the workspace", () => {
    expect(service).toContain('"get_project_start_knowledge"');
    expect(intake).toContain("getProjectStartKnowledge");
    expect(surface).toContain("Project-start knowledge");
    expect(surface).toContain("Historical estimates");
    expect(surface).toContain("Measured vendor records");
    expect(surface).toContain("Startup problems");
  });
});

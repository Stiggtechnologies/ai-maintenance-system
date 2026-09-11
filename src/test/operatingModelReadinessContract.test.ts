import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261219147000_develop_operating_model_readiness.sql", "utf8").toLowerCase();
const service = readFileSync("src/services/operatingModelReadinessService.ts", "utf8");
const panel = readFileSync("src/components/develop/OperatingModelReadinessPanel.tsx", "utf8");
const page = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");
const dimensions = ["organization_structure","staffing","competencies","shift_model","maintenance_strategy","supply_chain","contractors","warehouse","engineering_support","operations_procedures","emergency_response","it_ot_support","budget"];

describe("D8.01 operating-model readiness", () => {
  it("models exactly the thirteen II.10 dimensions", () => {
    for (const dimension of dimensions) expect(sql).toContain(`'${dimension}'`);
    expect(sql).toContain("'dimensioncount',13");
    expect(service).toContain("OPERATING_MODEL_DIMENSIONS");
  });
  it("keeps assessments versioned, tenant-bound and human-authored", () => {
    expect(sql).toContain("unique (development_case_id, dimension, version)");
    expect(sql).toContain("organization_id=v_org");
    expect(sql).toContain("not in ('admin','executive','maintenance_manager','reliability_engineer','planner')");
    expect(sql).toContain("coalesce(role,'')<>'ai_admin'");
    expect(sql).toContain("dimension owner must be a human member of this organization");
    expect(sql).toContain("audit_events");
  });
  it("preserves evidence provenance and refuses AI-only readiness", () => {
    for (const kind of ["measured","inspected","calculated","tested","documented","historical","expert_judgement","ai_inference"]) expect(sql).toContain(`'${kind}'`);
    expect(sql).toContain("ai inference alone cannot establish a ready");
    expect(panel).toContain("Evidence provenance");
  });
  it("is reachable and never grants transition authority", () => {
    expect(service).toContain('"record_operating_model_readiness"');
    expect(service).toContain('"get_case_operating_model_readiness"');
    expect(page).toContain("<OperatingModelReadinessPanel");
    expect(sql).toContain("does not approve handover, energization, startup or go-live");
  });
});

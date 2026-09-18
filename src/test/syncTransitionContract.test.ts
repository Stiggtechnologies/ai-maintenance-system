import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261219148000_develop_sync_transition.sql", "utf8").toLowerCase();
const service = readFileSync("src/services/syncTransitionService.ts", "utf8");
const page = readFileSync("src/pages/SyncTransitionPage.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const workspace = readFileSync("src/pages/DevelopmentCaseWorkspacePage.tsx", "utf8");

describe("D8.05 Sync Transition composition", () => {
  it("composes canonical readiness and debt families without a second workflow", () => {
    for (const fn of ["get_case_operating_model_readiness", "get_case_operational_readiness", "get_case_technical_debt", "get_case_operational_debt"]) expect(sql).toContain(fn);
    expect(sql).toContain("from early_life_failures");
    expect(sql).not.toContain("create table");
    expect(sql).toContain("record_case_early_life_failure");
  });

  it("keeps stabilization evidence honest and bounded", () => {
    expect(sql).toContain("between 1 and 365 days");
    expect(sql).toContain("no failures recorded is not proof of stable operation");
    expect(sql).toContain("timing_evidence_incomplete");
    expect(page).toContain("This is not presented as proof of stability");
  });

  it("is tenant-bound and cannot authorize a transition", () => {
    expect(sql).toContain("organization_id = v_org");
    expect(sql).toContain("does not approve handover, acceptance, energization, startup, go-live or stabilization exit");
    expect(sql).not.toContain("insert into decisions");
    expect(sql).not.toContain("insert into decisions");
  });

  it("is customer reachable as a dedicated case workspace", () => {
    expect(service).toContain('"get_case_sync_transition"');
    expect(service).toContain('"record_case_early_life_failure"');
    expect(app).toContain('path="/develop/cases/:caseId/transition"');
    expect(app).toContain("<SyncTransitionPage");
    expect(workspace).toContain("Sync Transition");
  });
});

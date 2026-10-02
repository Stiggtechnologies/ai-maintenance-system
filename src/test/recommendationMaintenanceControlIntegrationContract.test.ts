import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL = readFileSync(
  join(
    ROOT,
    "supabase/migrations/20270101471000_recommendation_maintenance_control_integration.sql",
  ),
  "utf8",
);
const WORK_BOARD = readFileSync(
  join(ROOT, "src/pages/WorkActionBoard.tsx"),
  "utf8",
);
const SERVICE = readFileSync(
  join(ROOT, "src/services/operatingLoopService.ts"),
  "utf8",
);
const E2E = readFileSync(join(ROOT, "tests/e2e/golden-path.spec.ts"), "utf8");

describe("recommendation to maintenance change-control integration", () => {
  it("routes safety-critical recommendation work through the canonical C5.17 request", () => {
    expect(SQL).toContain(
      "create or replace function public.route_safety_critical_work_request",
    );
    expect(SQL).toContain("recommendation_id, wo_number, title");
    expect(SQL).toContain("'schedule_safety_critical_work'");
    expect(SQL).toContain("'create_safety_critical_work'");
    expect(SQL).toContain("subject_revision, requested_by");
    expect(SQL).toContain("public.route_safety_critical_work_request(");
    expect(SQL).toContain("'maintenanceControlApprovalId'");
    expect(SQL).not.toMatch(/create\s+table/i);
  });

  it("preserves tenant, named-human, future-date and non-execution boundaries", () => {
    expect(SQL).toContain("v_org uuid := public.app_current_org()");
    expect(SQL).toContain("auth.uid() is null");
    expect(SQL).toContain("v_role = 'ai_admin'");
    expect(SQL).toContain("a.organization_id = v_org");
    expect(SQL).toContain("v_date <= now()");
    expect(SQL).toContain("'approval', 'critical'");
    expect(SQL).toContain("true, true, now(), now()");
    expect(SQL).toContain(
      "'independentWorkApprovalRequired', v_safety_critical",
    );
    expect(SQL).not.toContain("status = 'scheduled'");
  });

  it("does not expose the ordinary direct-approval action for safety work", () => {
    expect(WORK_BOARD).toContain("item.approvalRequired && item.safetyFlag");
    expect(WORK_BOARD).toContain("Review in Decision");
    expect(WORK_BOARD).toContain('navigate("/governance")');
    expect(SERVICE).toContain("if (work.safety_flag)");
    expect(SERVICE).toContain(
      "Safety-critical work requires an independent maintenance-manager decision",
    );
  });

  it("proves the browser path with two distinct human roles", () => {
    expect(E2E).toContain('const MANAGER_EMAIL = "manager@syncai.ca"');
    expect(E2E).toContain("Create safety-critical work");
    expect(E2E).toContain("Approve request");
    expect(E2E).toContain(
      "Approved after reviewing the condition evidence, completion date, consequence",
    );
  });
});

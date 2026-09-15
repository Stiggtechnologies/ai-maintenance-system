import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RECOVERY_OPERATING_MODES } from "../services/recoveryOperatingCommandService";

const sql = readFileSync(
  "supabase/migrations/20261219380000_emergency_restoration_command.sql",
  "utf8",
).toLowerCase();
const service = readFileSync(
  "src/services/recoveryOperatingCommandService.ts",
  "utf8",
);
const panel = readFileSync(
  "src/components/RecoveryOperatingCommand.tsx",
  "utf8",
);
const page = readFileSync("src/pages/SyncRecoveryPage.tsx", "utf8");
const smoke = readFileSync(
  "scripts/ci-emergency-restoration-command-smoke.sh",
  "utf8",
);

describe("U16.01 emergency and restoration command", () => {
  it("models exactly all eight registered modes", () => {
    expect(RECOVERY_OPERATING_MODES).toEqual([
      "normal",
      "elevated_risk",
      "emergency_response",
      "business_continuity",
      "damage_assessment",
      "restoration",
      "recovery",
      "post_event_learning",
    ]);
    for (const mode of RECOVERY_OPERATING_MODES) expect(sql).toContain(mode);
  });
  it("extends canonical recovery and evidence identities", () => {
    expect(sql).toContain("references public.restoration_events");
    expect(sql).toContain("evidence_items");
    expect(sql).toContain("left join restoration_events");
    expect(sql).not.toContain("create table public.work_");
    expect(sql).not.toContain("create table public.approval");
    expect(sql).not.toContain("create table public.evidence");
  });
  it("enforces legal transitions and event/learning gates", () => {
    expect(sql).toContain("transition from %s to %s is not permitted");
    expect(sql).toContain("this mode requires a canonical restoration event");
    expect(sql).toContain(
      "post-event learning requires the canonical restoration event to be closed",
    );
    expect(smoke).toContain("INVALID_JUMP");
  });
  it("requires tenant scope, verified evidence, and independent authority", () => {
    expect(sql).toContain("organization_id=public.app_current_org()");
    expect(sql).toContain("requester cannot authorize their own");
    expect(sql).toContain(
      "all cited canonical evidence must be independently verified",
    );
    expect(sql).toContain("revoke insert,update,delete,truncate");
    expect(smoke).toContain("FOREIGN");
  });
  it("preserves operational authority", () => {
    expect(sql).toContain(
      "no emergency declaration, dispatch, isolation, work release or return-to-service",
    );
    expect(sql).not.toContain("insert into work_orders");
    expect(sql).not.toContain("insert into approvals");
    expect(sql).not.toMatch(/update restoration_plan_versions\s+set\s+status/);
  });
  it("is customer reachable from Sync Recovery", () => {
    expect(page).toContain("<RecoveryOperatingCommand />");
    expect(page).toContain("Emergency Command");
    expect(panel).toContain("Emergency &amp; restoration command");
    for (const rpc of [
      "create_recovery_operating_command",
      "request_recovery_operating_mode",
      "review_recovery_operating_mode",
      "get_recovery_operating_command_workspace",
    ])
      expect(service).toContain(`"${rpc}"`);
  });
});

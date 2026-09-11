import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261219149000_develop_commissioning_object_family.sql",
  "utf8",
);
const service = readFileSync("src/services/commissioningService.ts", "utf8");
const panel = readFileSync(
  "src/components/develop/CommissioningPanel.tsx",
  "utf8",
);
const page = readFileSync("src/pages/SyncTransitionPage.tsx", "utf8");

describe("D8.06 commissioning object family", () => {
  it("builds the §29 decomposition above the canonical result store", () => {
    for (const table of [
      "commissioning_systems",
      "commissioning_subsystems",
      "commissioning_test_packages",
      "commissioning_procedures",
    ])
      expect(sql).toContain(`public.${table}`);
    expect(sql).toContain("alter table public.acceptance_tests");
    expect(sql).toContain("CommissioningResult is an acceptance_tests row");
    expect(sql).not.toContain("commissioning_results (");
  });
  it("preserves tenant, human authority, evidence and audit boundaries", () => {
    expect(sql).toContain("public.app_current_org()");
    expect(sql).toContain("human commissioning planning authority required");
    expect(sql).toContain("human commissioning execution authority required");
    expect(sql).toContain("same-tenant test evidence is required");
    expect(sql).toContain("insert into audit_events");
    expect(sql).not.toMatch(/commissioning_author_role[\s\S]{0,300}'ai_admin'/);
  });
  it("returns an honest per-system rollup without granting a transition decision", () => {
    for (const key of [
      "resultCount",
      "releasedCount",
      "failedCount",
      "openPunchCount",
      "pendingReleaseCount",
    ])
      expect(sql).toContain(`'${key}'`);
    expect(sql).toContain(
      "neither this read nor its writers authorize energization, operation, acceptance or handover",
    );
  });
  it("is reachable from the Sync Transition customer workspace", () => {
    expect(service).toContain('"get_case_commissioning"');
    expect(service).toContain('"record_commissioning_object"');
    expect(service).toContain('"record_commissioning_result"');
    for (const label of [
      "System → subsystem → test package → controlled procedure",
      "acceptance result.",
    ])
      expect(panel).toContain(label);
    expect(page).toContain("<CommissioningPanel");
  });
});

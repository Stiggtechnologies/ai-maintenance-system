import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("D13.14 operations readiness briefing reachability", () => {
  it("is mounted inside the live system handover surface", () => {
    const transition = read("src/pages/SyncTransitionPage.tsx");
    const handover = read("src/components/develop/SystemHandoverPanel.tsx");

    expect(transition).toContain("<SystemHandoverPanel");
    expect(handover).toContain("<OperationsReadinessBriefing");
    expect(handover).toContain("systemReadiness={systemReadiness}");
  });

  it("reuses the one tenant-scoped handover read and creates no write path", () => {
    const handover = read("src/components/develop/SystemHandoverPanel.tsx");
    const briefing = read("src/lib/develop/operationsReadinessBriefing.ts");

    expect(handover).toContain("getCaseSystemHandoverPackages(caseId)");
    expect(handover).toContain("getCaseSystemOperationalReadiness(caseId)");
    expect(briefing).toContain("Presentation-only composition");
    expect(briefing).not.toMatch(/supabase|\.rpc\(|\.from\(/);
    expect(briefing).not.toMatch(/acceptSystemHandover|assembleSystemHandover/);
  });
});

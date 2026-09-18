import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("D13.10 Operational Readiness screen contract", () => {
  it("is reachable from both Sync Develop and an individual case", () => {
    expect(read("src/App.tsx")).toContain(
      'path="/develop/operational-readiness"',
    );
    expect(read("src/pages/DevelopCasesPage.tsx")).toContain(
      'navigate("/develop/operational-readiness")',
    );
    expect(read("src/pages/DevelopmentCaseWorkspacePage.tsx")).toContain(
      "/develop/operational-readiness?case=${caseId}",
    );
  });

  it("composes the existing tenant-scoped read and creates no parallel store", () => {
    const service = read("src/services/operationalReadinessMatrixService.ts");
    expect(service).toContain("getCaseSystemOperationalReadiness");
    const builder = read("src/lib/develop/operationalReadinessMatrix.ts");
    expect(builder).not.toMatch(/supabase|\.from\(|\.rpc\(|insert|update|delete/i);
    expect(builder).toContain('readinessStore: source.readinessStore');
    expect(builder).toMatch(/not a new\s+engineering judgement/i);
  });

  it("keeps human handover and energization authority explicit", () => {
    const builder = read("src/lib/develop/operationalReadinessMatrix.ts");
    expect(builder).toMatch(/named human.*handover workflow/i);
    expect(builder).toMatch(/authorize energization/i);
    expect(builder).toMatch(/does not mean ready/i);
  });
});

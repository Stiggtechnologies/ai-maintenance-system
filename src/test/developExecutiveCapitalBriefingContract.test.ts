import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("D13.15 executive capital briefing contract", () => {
  it("is reachable from executive intelligence and uses the governed case route", () => {
    expect(read("src/App.tsx")).toContain('path="/executive/capital"');
    expect(read("src/pages/ExecutiveIntelligence.tsx")).toContain(
      "/executive/capital",
    );
  });

  it("composes the canonical reads and introduces no alternate persistence or write path", () => {
    const page = read("src/pages/ExecutiveCapitalBriefingPage.tsx");
    expect(page).toContain("getDevelopmentCase(caseId)");
    expect(page).toContain("getCasePerformance(caseId)");
    expect(page).toContain("getSinceSanctionDelta(caseId)");
    expect(page).toContain("getCaseBenefitsScreen(caseId)");
    const builder = read("src/lib/develop/executiveCapitalBriefing.ts");
    expect(builder).not.toMatch(
      /supabase|\.from\(|\.rpc\(|insert|update|delete/i,
    );
    expect(builder).toContain("performanceRunIsStale");
    expect(builder).toContain("human");
  });
});

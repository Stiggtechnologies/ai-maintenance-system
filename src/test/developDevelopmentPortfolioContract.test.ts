import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("D13.03 Development Portfolio contract", () => {
  it("is reachable from Sync Develop", () => {
    expect(read("src/App.tsx")).toContain('path="/develop/portfolio"');
    expect(read("src/pages/DevelopCasesPage.tsx")).toContain(
      'navigate("/develop/portfolio")',
    );
  });

  it("composes canonical tenant-scoped reads without another store or write path", () => {
    const service = read("src/services/developmentPortfolioService.ts");
    for (const readName of [
      "listDevelopmentCases",
      "getDevelopmentCase",
      "getGateReadiness",
      "getCasePerformance",
      "getCaseOperationalReadiness",
      "getCaseBenefitsScreen",
    ]) {
      expect(service).toContain(readName);
    }
    const builder = read("src/lib/develop/developmentPortfolio.ts");
    expect(builder).not.toMatch(
      /supabase|\.from\(|\.rpc\(|insert|update|delete/i,
    );
    expect(builder).toContain("performanceRunIsStale");
    expect(service).toMatch(/human decisions/i);
  });

  it("does not normalize unlike units or synthesize a portfolio score", () => {
    const service = read("src/services/developmentPortfolioService.ts");
    expect(service).toMatch(/not normalized into a cross-project score/i);
    expect(service).not.toMatch(/percentile|ranking|weighted score/i);
  });
});

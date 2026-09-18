import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage1ImportLivePath", () => {
  it("reuses the ingest door and #366 CMMS pull — no second connector", () => {
    const src = readFileSync("src/components/Stage1ImportLivePath.tsx", "utf8");
    expect(src).toContain('from "./ContractImport"');
    expect(src).toContain("getStage1ImportStatus");
    expect(src).toContain("/integrations");
    expect(src).toContain("/job-plans");
    expect(src).toContain("/pm-programme");
    expect(src).not.toMatch(/create table|cmms-write|write_enabled\s*=\s*true/);
  });
});

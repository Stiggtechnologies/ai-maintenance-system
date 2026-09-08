import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage1KpiOwners", () => {
  it("keeps catalog RACI and names humans only through the write door", () => {
    const src = readFileSync("src/components/Stage1KpiOwners.tsx", "utf8");
    expect(src).toContain("nameKpiOwner");
    expect(src).toContain('slot: "accountable"');
    expect(src).toContain("basis.trim().length < 20");
    expect(src).toContain("No named human recorded");
    expect(src).not.toMatch(/A\. Operator|DEMO|seed owner/i);
  });
});

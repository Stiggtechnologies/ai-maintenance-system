import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AccountabilityCascade Stage-1 adopt", () => {
  it("exposes named-human adopt and ceiling restatement on the existing ladder", () => {
    const src = readFileSync("src/components/AccountabilityCascade.tsx", "utf8");
    expect(src).toContain("adoptAuthorityLimit");
    expect(src).toContain("stateAuthorityCeiling");
    expect(src).toContain("stage1-doa-adopt");
    expect(src).toContain("instrument.trim().length < 10");
    expect(src).toMatch(/AI cannot adopt/);
  });
});

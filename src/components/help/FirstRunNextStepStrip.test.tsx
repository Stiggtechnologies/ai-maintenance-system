import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FirstRunNextStepStrip (M3)", () => {
  it("Mission Control mounts the strip", () => {
    const src = readFileSync("src/pages/MissionControl.tsx", "utf8");
    expect(src).toMatch(/FirstRunNextStepStrip/);
    expect(src).toMatch(/<FirstRunNextStepStrip\s*\/>/);
  });

  it("copy stays honest", () => {
    const src = readFileSync(
      "src/components/help/FirstRunNextStepStrip.tsx",
      "utf8",
    );
    expect(src).toMatch(/Recommend is not authorize/);
    expect(src).toMatch(/no plant execute/);
    expect(src).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(src).not.toMatch(/certified/i);
  });
});

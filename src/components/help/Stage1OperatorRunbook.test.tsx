import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGE1_GATES } from "./Stage1OperatorRunbook";

describe("Stage1OperatorRunbook (M2)", () => {
  it("exposes six Stage-1 gates with live deep-links", () => {
    expect(STAGE1_GATES).toHaveLength(6);
    expect(STAGE1_GATES.map((g) => g.id)).toEqual([
      "assessment",
      "connector",
      "learn",
      "dw-honesty",
      "job-plan",
      "authority",
    ]);
  });
  it("Mission Control mounts the runbook", () => {
    const src = readFileSync("src/pages/MissionControl.tsx", "utf8");
    expect(src).toMatch(/Stage1OperatorRunbook/);
    expect(src).toMatch(/<Stage1OperatorRunbook\s*\/>/);
  });
});

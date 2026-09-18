import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/GateReviewPage.tsx", "utf8");
const component = readFileSync(
  "src/components/develop/PmGateBriefing.tsx",
  "utf8",
);
const briefing = readFileSync("src/lib/develop/pmGateBriefing.ts", "utf8");
const register = readFileSync("docs/sync-develop/register.md", "utf8");

function registerRow(id: string) {
  return (
    register.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? ""
  );
}

describe("D13.13 PM gate briefing contract", () => {
  it("is mounted on the live human gate-review route", () => {
    expect(page).toContain("<PmGateBriefing pack={pack} />");
    expect(component).toContain('aria-label="PM gate briefing"');
  });

  it("composes the governed pack and does not fetch or recompute readiness", () => {
    expect(component).toContain("buildPmGateBriefing(pack)");
    expect(component).not.toContain("getGateReadiness");
    expect(briefing).toContain("performs no readiness");
    expect(briefing).not.toMatch(/reduce\s*\(/);
  });

  it("keeps record traceability and the human decision boundary visible", () => {
    expect(component).toContain("Record trail");
    expect(briefing).toContain("stage_gate_criteria:");
    expect(briefing).toContain("stage_gate_reviews:");
    expect(briefing).toContain("evidence_items:");
    expect(briefing).toContain("A named eligible human");
    expect(briefing).toContain("‘Not blocked’ is not approval");
  });

  it("promotes the capability only after the complete exact-head gates passed", () => {
    expect(registerRow("D13.13")).toMatch(/^\| D13\.13 \|[^|]*\|[^|]*\| ✅/);
  });
});

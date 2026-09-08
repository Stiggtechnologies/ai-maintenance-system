import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage1PilotPackPage", () => {
  it("mounts the three live-ops surfaces and the runbook", () => {
    const src = readFileSync("src/pages/Stage1PilotPackPage.tsx", "utf8");
    expect(src).toContain("Stage1ImportLivePath");
    expect(src).toContain("AccountabilityCascade");
    expect(src).toContain("Stage1KpiOwners");
    expect(src).toContain("Stage1OperatorRunbook");
    expect(src).toMatch(/historical fleet studies are not this site/);
  });

  it("is routed from App without a parallel CMMS or historian", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain(
      'import { Stage1PilotPackPage } from "./pages/Stage1PilotPackPage"',
    );
    expect(app).toContain(
      '<Route path="/stage-1" element={<Stage1PilotPackPage />} />',
    );
  });
});

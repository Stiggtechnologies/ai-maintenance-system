import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PUBLIC_SURFACES = [
  "src/components/PublicProductHeader.tsx",
  "src/components/AuthShell.tsx",
  "src/components/HelpCenterWidget.tsx",
  "src/pages/FirstCustomerPilotPage.tsx",
  "src/pages/RiaAssessmentWorkspacePage.tsx",
  "src/pages/Security.tsx",
  "src/pages/Privacy.tsx",
  "src/pages/Terms.tsx",
  "src/pages/ReliabilityEngineerPage.tsx",
];

describe("public URLs do not advertise /demo", () => {
  it("fails if a public header or CTA still points at /demo", () => {
    for (const path of PUBLIC_SURFACES) {
      const src = readFileSync(path, "utf8");
      expect(src, `${path} still links to /demo`).not.toMatch(/\/demo/);
    }
  });

  it("retires /demo/copilot as a share link in App routing", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="\/demo\/copilot"/);
    expect(app).toMatch(/Navigate to="\/workspace"/);
    expect(app).not.toMatch(
      /path="\/demo\/copilot"\s+element=\{<PublicCopilotExperience/,
    );
    expect(app).not.toMatch(
      /href="\/demo\/copilot|assign\("\/demo\/copilot|to="\/decision-cases\/demo"/,
    );
  });

  it("keeps signed-in Decision Workspace off a demo path", () => {
    const appShell = readFileSync("src/components/AppShell.tsx", "utf8");
    const palette = readFileSync("src/components/CommandSearch.tsx", "utf8");
    expect(appShell).toContain('path: "/decision-cases"');
    expect(appShell).not.toContain('path: "/decision-cases/demo"');
    expect(palette).toContain('path: "/decision-cases"');
    expect(palette).not.toContain('path: "/decision-cases/demo"');
  });
});

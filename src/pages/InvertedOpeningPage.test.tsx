import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("InvertedOpeningPage", () => {
  it("is routed at /get-started and keeps honesty bars", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const page = readFileSync("src/pages/InvertedOpeningPage.tsx", "utf8");
    expect(app).toMatch(/path="\/get-started"/);
    expect(page).toMatch(/Save this assessment and continue/);
    expect(page).toMatch(/INVERTED_OPENING_SUB/);
    expect(page).toMatch(/What are you here to accomplish/);
    expect(page).toMatch(/Never seed|never seed|Examples only|Example/i);
    expect(page).toMatch(/DecisionCaseSpine/);
    expect(page).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(page).not.toMatch(/seamless self-guided onboarding is live/i);
    expect(page).not.toMatch(/slice\(0,\s*42\)/);
    expect(page).toMatch(/SelfServeProgressChecklist/);
    expect(page).toMatch(/HelpCenterWidget/);
    const header = readFileSync(
      "src/components/PublicJourneyHeader.tsx",
      "utf8",
    );
    expect(header).not.toMatch(/Discuss purchasing/);
    expect(header).toMatch(/Talk to us/);
    expect(header).toMatch(/Create a workspace/);
    const spine = readFileSync("src/pages/DecisionCaseSpine.tsx", "utf8");
    expect(spine).toMatch(/Self-serve evaluation/);
    expect(spine).not.toMatch(/Guided evaluation/);
  });
});

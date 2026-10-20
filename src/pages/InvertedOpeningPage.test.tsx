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
    const nav = readFileSync("src/lib/onboarding/self-serve-nav.ts", "utf8");
    const css = readFileSync("src/components/public-journey.css", "utf8");
    expect(header).not.toMatch(/Discuss purchasing/);
    expect(nav).not.toMatch(/Discuss purchasing/);
    expect(nav).toMatch(/Talk to us/);
    expect(header).toMatch(/selfServeGate/);
    expect(header).toMatch(/Create a workspace/);
    expect(css).toMatch(/\[data-testid\^="inverted-example-"\]/);
    expect(css).toMatch(/white-space:\s*normal/);
    const spine = readFileSync("src/pages/DecisionCaseSpine.tsx", "utf8");
    expect(spine).toMatch(/Self-serve evaluation/);
    expect(spine).not.toMatch(/Guided evaluation/);
    const wizard = readFileSync("src/components/OnboardingWizard.tsx", "utf8");
    expect(wizard).toContain('href="mailto:support@syncai.ca"');
    expect(
      wizard.match(/href="\/get-started#first-decision-help"/g) ?? [],
    ).toHaveLength(1);
  });
});

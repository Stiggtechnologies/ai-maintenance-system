import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIRST_DECISION_HELP } from "./first-decision-help";

describe("first Decision Case help", () => {
  it("covers the self-serve path without a human walkthrough", () => {
    expect(FIRST_DECISION_HELP.title).toMatch(/first Decision Case/i);
    expect(FIRST_DECISION_HELP.content).toMatch(/Get started/);
    expect(FIRST_DECISION_HELP.content).toMatch(
      /Connect my site is optional after first value/,
    );
    expect(FIRST_DECISION_HELP.content).toMatch(/First value/);
    expect(FIRST_DECISION_HELP.content).toMatch(/not an approval/);
    expect(FIRST_DECISION_HELP.content).toMatch(/Talk me through it/);
    expect(FIRST_DECISION_HELP.content).toMatch(/stay hidden/);
    expect(FIRST_DECISION_HELP.content).not.toMatch(
      /both controls stay visible/,
    );
    expect(FIRST_DECISION_HELP.content).toMatch(
      /Talk to us stays out of the navigation until a Decision Case is saved/,
    );
    expect(FIRST_DECISION_HELP.content).not.toMatch(
      /self-guided onboarding is live/i,
    );
    expect(FIRST_DECISION_HELP.content).not.toMatch(/\/demo/);
  });

  it("is the article the in-app Help widget and Get started both show", () => {
    const help = readFileSync("src/components/HelpCenterWidget.tsx", "utf8");
    const page = readFileSync("src/pages/InvertedOpeningPage.tsx", "utf8");
    const strip = readFileSync(
      "src/components/help/FirstRunNextStepStrip.tsx",
      "utf8",
    );
    expect(help).toContain("FIRST_DECISION_HELP");
    expect(help).toMatch(/first Decision Case/);
    expect(
      readFileSync("src/lib/onboarding/first-decision-help.ts", "utf8"),
    ).toContain("Reach your first Decision Case");
    expect(page).toContain("SelfServeProgressChecklist");
    expect(page).toContain("HelpCenterWidget");
    expect(strip).toMatch(/first Decision Case/i);
  });
});

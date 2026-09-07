import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("InvertedOpeningPage", () => {
  it("is routed at /get-started and keeps honesty bars", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const page = readFileSync("src/pages/InvertedOpeningPage.tsx", "utf8");
    expect(app).toMatch(/path=\"\/get-started\"/);
    expect(page).toMatch(/Save this assessment and continue/);
    expect(page).toMatch(/Never seed|never seed|Examples only|Example/i);
    expect(page).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(page).not.toMatch(/seamless self-guided onboarding is live/i);
  });
});

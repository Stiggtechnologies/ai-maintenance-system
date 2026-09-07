import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("StartHerePage (self-guided moat floor)", () => {
  it("is routed and used as signup returnTo", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const signup = readFileSync("src/pages/Signup.tsx", "utf8");
    expect(app).toMatch(/path=\"\/start\"/);
    expect(app).toMatch(/StartHerePage/);
    expect(signup).toMatch(/returnTo=\/start/);
  });

  it("states recommend is not authorize and no plant execute", () => {
    const src = readFileSync("src/pages/StartHerePage.tsx", "utf8");
    expect(src).toMatch(/recommends; humans authorize|Recommend/i);
    expect(src).toMatch(/no plant execute/i);
    expect(src).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(src).not.toMatch(/seamless self-guided onboarding is live/i);
  });
});

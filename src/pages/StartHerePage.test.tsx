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

  it("states ~20 min setup, sequential checklist, and honesty bars", () => {
    const src = readFileSync("src/pages/StartHerePage.tsx", "utf8");
    expect(src).toMatch(/~20 min/);
    expect(src).toMatch(/Recommend is not authorize/);
    expect(src).toMatch(/No plant execute/);
    expect(src).toMatch(/id: \"ask\"/);
    expect(src).toMatch(/id: \"learn\"/);
    expect(src).toMatch(/id: \"connector\"/);
    expect(src).not.toMatch(/CAD\s*\$?\s*7\.?5/i);
    expect(src).not.toMatch(/seamless onboarding is live/i);
  });
});

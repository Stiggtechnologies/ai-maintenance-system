import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("HelpCenterWidget mount (M1)", () => {
  it("AppShell imports and renders HelpCenterWidget", () => {
    const src = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(src).toMatch(/import \{ HelpCenterWidget \} from "\.\/HelpCenterWidget"/);
    expect(src).toMatch(/<HelpCenterWidget\s*\/>/);
  });

  it("public RE shell mounts HelpCenterWidget", () => {
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).toMatch(/import \{ HelpCenterWidget \} from "\.\/components\/HelpCenterWidget"/);
    expect(src).toMatch(/function PublicCopilotExperience/);
    expect(src).toMatch(/<HelpCenterWidget\s*\/>/);
  });
});

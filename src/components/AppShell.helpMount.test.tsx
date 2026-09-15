import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("retired floating Help launcher", () => {
  it("does not mount beside the global Sync launcher", () => {
    const src = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(src).not.toContain("HelpCenterWidget");
    expect(src).toContain("<CopilotDock");
  });

  it("does not mount on the public workspace", () => {
    const src = readFileSync("src/App.tsx", "utf8");
    expect(src).toMatch(/function PublicCopilotExperience/);
    expect(src).not.toContain("HelpCenterWidget");
  });

  it("preserves the retired help component for recovery instead of deleting it", () => {
    expect(() =>
      readFileSync("src/components/HelpCenterWidget.tsx", "utf8"),
    ).not.toThrow();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOLT_SPACES_LIVE_PATH,
  COWORK_LEGACY_PATH,
  COWORK_NAV_ID,
  COWORK_NAV_LABEL,
  PUBLIC_ASK_TIE_IN,
  boltChromeTieIn,
  canExposeBoltSpaces,
} from "./public-ask-tie-in";

describe("Step 3 public-ask tie-in map", () => {
  it("maps Bolt Spaces to the existing cowork / Decision Workspace store", () => {
    const spaces = boltChromeTieIn("Spaces");
    expect(spaces?.product).toContain("cowork_workspaces");
    expect(spaces?.product).toContain(BOLT_SPACES_LIVE_PATH);
    expect(spaces?.note).toMatch(/Not a \/spaces route/);
    expect(spaces?.note).toMatch(/CoworkStudio is not live/);
    expect(boltChromeTieIn("@mention a Space")?.product).toMatch(
      /cowork_workspaces/,
    );
    expect(canExposeBoltSpaces({ signedIn: false })).toBe(false);
    expect(canExposeBoltSpaces({ signedIn: true })).toBe(true);
  });

  it("does not invent a /spaces page; /cowork already redirects", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(
      /path=["']\/cowork["'][\s\S]*Navigate to=["']\/decision-cases["']/,
    );
    expect(app).not.toMatch(/path=["']\/spaces["']/);
    expect(app).not.toMatch(/<CoworkStudio/);
    expect(readFileSync("src/pages/CoworkStudio.tsx", "utf8")).toContain(
      "export function CoworkStudio",
    );
  });

  it("keeps AppShell cowork as Decision Workspace at /decision-cases", () => {
    const shell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(shell).toContain(`id: "${COWORK_NAV_ID}"`);
    expect(shell).toContain(`label: "${COWORK_NAV_LABEL}"`);
    expect(shell).toContain(`path: "${BOLT_SPACES_LIVE_PATH}"`);
    expect(COWORK_LEGACY_PATH).toBe("/cowork");
  });

  it("keeps Discover hidden and Home as new ask", () => {
    expect(boltChromeTieIn("Discover")?.honesty).toBe("hidden");
    expect(boltChromeTieIn("Rail + / Home")?.product).toMatch(/createCase/);
    expect(PUBLIC_ASK_TIE_IN.some((row) => row.chrome === "Install")).toBe(
      true,
    );
  });
});

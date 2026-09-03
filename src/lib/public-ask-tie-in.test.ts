import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOLT_SPACES_LIVE_PATH,
  COWORK_LEGACY_PATH,
  COWORK_NAV_ID,
  COWORK_NAV_LABEL,
  DRAFT_BANNER_IS_NOT_SPACES,
  PUBLIC_ASK_TIE_IN,
  boltChromeTieIn,
  canExposeBoltSpaces,
} from "./public-ask-tie-in";

describe("Step 3 public-ask tie-in map", () => {
  it("maps Bolt Spaces to the existing cowork / Decision Workspace store", () => {
    const spaces = boltChromeTieIn("Spaces");
    expect(spaces?.product).toContain("cowork_workspaces");
    expect(spaces?.product).toContain("DecisionCaseWorkspace");
    expect(spaces?.note).toMatch(/Not a \/spaces route/);
    expect(spaces?.note).toMatch(/CoworkStudio is not live/);
    expect(boltChromeTieIn("@mention a Space")?.product).toMatch(
      /cowork_workspaces/,
    );
    expect(boltChromeTieIn("Spaces")?.note).toMatch(/DraftBanner/);
    expect(boltChromeTieIn("@mention a Space")?.note).toMatch(/DraftBanner/);
    expect(DRAFT_BANNER_IS_NOT_SPACES).toMatch(/Not cowork threads/);
    expect(canExposeBoltSpaces({ signedIn: false })).toBe(false);
    expect(canExposeBoltSpaces({ signedIn: true })).toBe(true);
  });

  it("does not treat the /decision-cases import banner as Spaces", () => {
    const page = readFileSync(
      "src/pages/GovernedDecisionWorkspacePage.tsx",
      "utf8",
    );
    expect(page).toContain("function DraftBanner");
    expect(page).toContain("Browser drafts — import or discard");
    expect(page).toContain('data-testid="browser-draft-row"');
    const draftFn = page.slice(
      page.indexOf("function DraftBanner"),
      page.indexOf("function OptionsMatrix"),
    );
    expect(draftFn).not.toMatch(/<Link/);
    expect(draftFn).not.toMatch(/<a[\s>]/);
    expect(DRAFT_BANNER_IS_NOT_SPACES).toMatch(/Import or Discard/);
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

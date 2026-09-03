import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPSHELL_COWORK_PATH,
  COWORK_ASK_PATH,
  COWORK_IS_NOT_DEVELOP_ONLY,
  COWORK_LEGACY_PATH,
  COWORK_NAV_ID,
  COWORK_NAV_LABEL,
  DEVELOP_NEW_PATH,
  DRAFT_BANNER_IS_NOT_SPACES,
  PUBLIC_ASK_TIE_IN,
  boltChromeTieIn,
  canExposeBoltSpaces,
  coworkAskRequiresDevelopmentCase,
} from "./public-ask-tie-in";

const BOLT_CLONE_SURFACES = [
  "src/lib/public-ask-intents.ts",
  "src/components/public-ask/PublicAskRail.tsx",
  "src/components/public-ask/PublicAskEmpty.tsx",
  "src/components/public-ask/PublicAskBar.tsx",
  "src/components/public-ask/BoltSpacesPanel.tsx",
];

describe("Step 3 public-ask tie-in map", () => {
  it("maps Home and Spaces to /workspace cowork, not Develop", () => {
    expect(boltChromeTieIn("Rail + / Home")?.product).toMatch(/\/workspace/);
    expect(boltChromeTieIn("Rail + / Home")?.product).toMatch(
      /cowork_workspaces/,
    );
    expect(boltChromeTieIn("Rail + / Home")?.note).toMatch(
      /Not \/develop\/new/,
    );
    const spaces = boltChromeTieIn("Spaces");
    expect(spaces?.product).toContain("cowork_workspaces");
    expect(spaces?.note).toMatch(/Not the Develop case list/);
    expect(spaces?.note).toMatch(/Not DraftBanner/);
    expect(spaces?.note).toMatch(/CoworkStudio is not live/);
    expect(boltChromeTieIn("@mention a Space")?.product).toMatch(
      /cowork_workspaces/,
    );
    expect(boltChromeTieIn("@mention a Space")?.note).toMatch(
      /Not the Develop case list/,
    );
    expect(COWORK_ASK_PATH).toBe("/workspace");
    expect(DEVELOP_NEW_PATH).toBe("/develop/new");
    expect(coworkAskRequiresDevelopmentCase()).toBe(false);
    expect(COWORK_IS_NOT_DEVELOP_ONLY).toMatch(/not a Develop-only feature/i);
    expect(canExposeBoltSpaces({ signedIn: false })).toBe(false);
    expect(canExposeBoltSpaces({ signedIn: true })).toBe(true);
  });

  it("does not funnel collaboration pills through /develop/new", () => {
    for (const id of [
      "Compare",
      "Troubleshoot",
      "Health",
      "Learn",
      "Fact Check",
    ]) {
      expect(boltChromeTieIn(id)?.note).toMatch(/Not \/develop\/new/);
    }
    expect(boltChromeTieIn("Ask bar send")?.note).toMatch(/Not \/develop\/new/);
    expect(boltChromeTieIn("Develop")?.note).toMatch(/Do not funnel/);
    for (const path of BOLT_CLONE_SURFACES) {
      expect(readFileSync(path, "utf8"), path).not.toContain(DEVELOP_NEW_PATH);
    }
    expect(
      readFileSync("src/pages/DecisionCaseWorkspacePage.tsx", "utf8"),
    ).not.toContain(DEVELOP_NEW_PATH);
  });

  it("treats the /decision-cases banner as one-time draft cleanup, not Spaces", () => {
    const page = readFileSync(
      "src/pages/GovernedDecisionWorkspacePage.tsx",
      "utf8",
    );
    expect(page).toContain("function DraftBanner");
    expect(page).toContain("Browser drafts — import or discard");
    expect(page).toContain("One-time cleanup");
    expect(page).toContain("not how new cowork starts");
    expect(page).toContain('data-testid="browser-draft-row"');
    const draftFn = page.slice(
      page.indexOf("function DraftBanner"),
      page.indexOf("function OptionsMatrix"),
    );
    expect(draftFn).not.toMatch(/<Link/);
    expect(draftFn).not.toMatch(/<a[\s>]/);
    expect(DRAFT_BANNER_IS_NOT_SPACES).toMatch(/one-time cleanup/);
    expect(DRAFT_BANNER_IS_NOT_SPACES).toMatch(/Not how new cowork starts/);
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

  it("records AppShell cowork as the governed-decision surface, not Spaces", () => {
    const shell = readFileSync("src/components/AppShell.tsx", "utf8");
    expect(shell).toContain(`id: "${COWORK_NAV_ID}"`);
    expect(shell).toContain(`label: "${COWORK_NAV_LABEL}"`);
    expect(shell).toContain(`path: "${APPSHELL_COWORK_PATH}"`);
    expect(APPSHELL_COWORK_PATH).toBe("/decision-cases");
    expect(COWORK_LEGACY_PATH).toBe("/cowork");
    expect(PUBLIC_ASK_TIE_IN.some((row) => row.chrome === "Install")).toBe(
      true,
    );
  });
});

/**
 * Step 3 — Bolt chrome → existing product. Clone the layout first; then
 * map. Do not invent a Spaces page, a Discover page, or a parallel store.
 *
 * Orville 2026-09-03 ruling: cowork / Spaces is NOT a Develop-only
 * feature. Not all projects are development projects. Compare,
 * Troubleshoot, Health, Learn, Fact Check, and open ask must not require
 * creating a development case.
 *
 * Home / + = new ask on public and signed-in `/workspace` (Mode A → Mode
 * B), persisted to `cowork_workspaces` / decision-case chat — NOT
 * `/develop/new`.
 *
 * Spaces / @mention a Space = existing cowork threads / cases of any
 * intent, not the Develop case list. Reuse `cowork_workspaces` /
 * `cowork_messages`. `CoworkStudio.tsx` is not a live route.
 *
 * The amber `/decision-cases` DraftBanner is one-time cleanup of leftover
 * localStorage DecisionCase drafts (Import / Discard). It is not how new
 * cowork starts and must not become the Spaces UX.
 *
 * AppShell nav id `cowork` still points at `/decision-cases` (governed
 * `decisions` + `scenarios` bound to a development case). That is a
 * different surface from Bolt Spaces. `/cowork` redirects there.
 * Develop remains one destination for work that actually is a development
 * case — do not funnel Health / Compare / etc. through it.
 */
export const COWORK_ASK_PATH = "/workspace";
export const APPSHELL_COWORK_PATH = "/decision-cases";
export const COWORK_LEGACY_PATH = "/cowork";
export const COWORK_NAV_ID = "cowork";
export const COWORK_NAV_LABEL = "Decision Workspace";
export const DEVELOP_NEW_PATH = "/develop/new";

/** @deprecated Use COWORK_ASK_PATH. Spaces is /workspace threads, not this. */
export const BOLT_SPACES_LIVE_PATH = COWORK_ASK_PATH;

/** Leftover localStorage DecisionCase rows on /decision-cases. Not Spaces. */
export const DRAFT_BANNER_IS_NOT_SPACES =
  "The /decision-cases amber banner is one-time cleanup of leftover localStorage DecisionCase drafts (Import or Discard). Not how new cowork starts. Not cowork threads, not Spaces, not governed decisions rows.";

export const COWORK_IS_NOT_DEVELOP_ONLY =
  "Cowork / Spaces is not a Develop-only feature. Collaboration asks persist to cowork_workspaces and must not require /develop/new.";

export type BoltChromeHonesty =
  "live" | "live-intent" | "gated" | "visual-only" | "hidden";

export type BoltChromeTieIn = {
  chrome: string;
  product: string;
  honesty: BoltChromeHonesty;
  note?: string;
};

export const PUBLIC_ASK_TIE_IN: readonly BoltChromeTieIn[] = [
  {
    chrome: "Ask bar send",
    product: "sendMessage → askDecisionCase → cowork_workspaces",
    honesty: "live",
    note: "Not /develop/new.",
  },
  {
    chrome: "Compare",
    product: "first-paint seed 0 + Decision record on /workspace",
    honesty: "live-intent",
    note: "Not a development case. Not /develop/new.",
  },
  {
    chrome: "Troubleshoot",
    product: "first-paint seed 4 + Evidence record on /workspace",
    honesty: "live-intent",
    note: "Not a development case. Not /develop/new.",
  },
  {
    chrome: "Health",
    product: "first-paint seed 1 + Decision record on /workspace",
    honesty: "live-intent",
    note: "Not a development case. Not /develop/new.",
  },
  {
    chrome: "Learn",
    product: "first-paint seed 3 + Value record on /workspace",
    honesty: "live-intent",
    note:
      "Shows the verified-value model. Not the Learning Loop recorder. Not /develop/new.",
  },
  {
    chrome: "Fact Check",
    product: "first-paint seed 2 + Evidence record on /workspace",
    honesty: "live-intent",
    note: "Not a development case. Not /develop/new.",
  },
  {
    chrome: "@mention a Space",
    product: "existing cowork_workspaces threads of any intent",
    honesty: "visual-only",
    note: "Placeholder grammar. Spaces in the rail lists cowork threads. Not the Develop case list. Not DraftBanner.",
  },
  {
    chrome: "Compass",
    product: "none — not Discover",
    honesty: "visual-only",
  },
  {
    chrome: "Rail + / Home",
    product: "createCase() on /workspace — new ask, cowork_workspaces",
    honesty: "live",
    note: "Public and signed-in Mode A. Not /develop/new.",
  },
  {
    chrome: "Discover",
    product: "none",
    honesty: "hidden",
    note: "Bolt clicks changed no view. Stay hidden until a real destination exists.",
  },
  {
    chrome: "Spaces",
    product:
      "existing cowork_workspaces / DecisionCaseWorkspace threads of any intent",
    honesty: "hidden",
    note: "Public anonymous: hidden. Signed-in Mode A/B: cowork thread list on /workspace. Not a /spaces route. Not the Develop case list. Not DraftBanner. CoworkStudio is not live.",
  },
  {
    chrome: "Install",
    product: "none",
    honesty: "hidden",
    note: "Omitted on web.",
  },
  {
    chrome: "Assess",
    product: "/setup",
    honesty: "live",
  },
  {
    chrome: "Sign in",
    product: "/signin",
    honesty: "live",
  },
  {
    chrome: "Search / globe / link",
    product: "none",
    honesty: "gated",
    note: "Disabled. Behind + under 480px.",
  },
  {
    chrome: "Image / attach",
    product: "plus-sheet after a case exists",
    honesty: "gated",
  },
  {
    chrome: "Mic",
    product: "useDictation",
    honesty: "live",
    note: "When the browser supports it. Behind + under 480px.",
  },
  {
    chrome: "Mode B thread",
    product: "case + recommendation + Simulate + packet + Learn pointer",
    honesty: "live",
    note: "Decision-case chat on /workspace. Not a Develop case.",
  },
  {
    chrome: "Develop",
    product: "/develop — only when the work actually is a development case",
    honesty: "live",
    note: "Do not funnel Compare / Troubleshoot / Health / Learn / Fact Check / open ask through it.",
  },
];

export function boltChromeTieIn(chrome: string): BoltChromeTieIn | undefined {
  return PUBLIC_ASK_TIE_IN.find((row) => row.chrome === chrome);
}

/**
 * Bolt Spaces is cowork_workspaces threads of any intent on /workspace.
 * Public anonymous has no real destination — hide it.
 * Signed-in Mode A/B exposes that store (Home = new ask, Spaces = threads).
 * Do not treat DraftBanner or the Develop case list as Spaces.
 */
export function canExposeBoltSpaces(input: { signedIn: boolean }): boolean {
  return input.signedIn;
}

export function coworkAskRequiresDevelopmentCase(): boolean {
  return false;
}

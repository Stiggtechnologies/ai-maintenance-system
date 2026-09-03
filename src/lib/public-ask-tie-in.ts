/**
 * Step 3 — Bolt chrome → existing product. Clone the layout first; then
 * map. Do not invent a Spaces page, a Discover page, or a parallel store.
 *
 * Orville 2026-09-03: Bolt "Spaces" / "@mention a Space" is the cowork
 * surface this product already has. `/cowork` redirects to `/decision-cases`.
 * AppShell nav id `cowork` is labeled "Decision Workspace" and points at
 * `/decision-cases`. Conversations resume from `cowork_workspaces` /
 * `cowork_messages`. `CoworkStudio.tsx` is the old 15-agent studio and is
 * not a live route.
 *
 * Orville 2026-09-03 (follow-up): the amber **unsaved local drafts**
 * banner on `/decision-cases` (`DraftBanner`) is leftover localStorage
 * `DecisionCase` drafts. Rows are Import / Discard only — not cowork
 * threads, not Spaces, not governed `decisions` rows. The clickable
 * governed list is below that banner (`Link` to `/decision-cases/:id`).
 */
export const BOLT_SPACES_LIVE_PATH = "/decision-cases";
export const COWORK_LEGACY_PATH = "/cowork";
export const COWORK_NAV_ID = "cowork";
export const COWORK_NAV_LABEL = "Decision Workspace";

/** Leftover localStorage DecisionCase rows on /decision-cases. Not Spaces. */
export const DRAFT_BANNER_IS_NOT_SPACES =
  "The /decision-cases amber banner is leftover localStorage DecisionCase drafts (Import or Discard). Not cowork threads, not Spaces, not governed decisions rows.";

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
    product: "sendMessage → askDecisionCase",
    honesty: "live",
  },
  {
    chrome: "Compare",
    product: "first-paint seed 0",
    honesty: "live-intent",
  },
  {
    chrome: "Troubleshoot",
    product: "first-paint seed 4",
    honesty: "live-intent",
  },
  {
    chrome: "Health",
    product: "first-paint seed 1",
    honesty: "live-intent",
  },
  {
    chrome: "Learn",
    product: "first-paint seed 3",
    honesty: "live-intent",
    note: "Not the Learning Loop recorder",
  },
  {
    chrome: "Fact Check",
    product: "first-paint seed 2",
    honesty: "live-intent",
  },
  {
    chrome: "@mention a Space",
    product: "cowork_workspaces / signed-in DecisionCaseWorkspace threads",
    honesty: "visual-only",
    note: "Placeholder grammar. Spaces in the rail is the live cowork list when signed in. Not the /decision-cases DraftBanner import rows.",
  },
  {
    chrome: "Compass",
    product: "none — not Discover",
    honesty: "visual-only",
  },
  {
    chrome: "Rail + / Home",
    product: "createCase() — new ask",
    honesty: "live",
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
      "cowork_workspaces / cowork_messages + signed-in DecisionCaseWorkspace threads",
    honesty: "hidden",
    note: "Public anonymous: hidden. Signed-in Mode A/B: existing cowork threads. Not a /spaces route. CoworkStudio is not live. Not the amber DraftBanner import rows on /decision-cases.",
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
  },
];

export function boltChromeTieIn(chrome: string): BoltChromeTieIn | undefined {
  return PUBLIC_ASK_TIE_IN.find((row) => row.chrome === chrome);
}

/**
 * Bolt Spaces is real cowork_workspaces / signed-in DecisionCaseWorkspace
 * threads. Public anonymous has no real destination — hide it.
 * Signed-in Mode A/B exposes that store (Home = new ask, Spaces = threads).
 * Do not treat DraftBanner import rows as Spaces.
 */
export function canExposeBoltSpaces(input: { signedIn: boolean }): boolean {
  return input.signedIn;
}

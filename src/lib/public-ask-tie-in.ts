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
 */
export const BOLT_SPACES_LIVE_PATH = "/decision-cases";
export const COWORK_LEGACY_PATH = "/cowork";
export const COWORK_NAV_ID = "cowork";
export const COWORK_NAV_LABEL = "Decision Workspace";

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
    product: "cowork_workspaces / Decision Workspace cases",
    honesty: "visual-only",
    note: "Placeholder grammar. Spaces in the rail is the live list when signed in.",
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
    product: "cowork_workspaces / cowork_messages + /decision-cases",
    honesty: "hidden",
    note: "Public anonymous: hidden. Signed-in Mode A/B: existing cowork / decision-case list. Not a /spaces route. CoworkStudio is not live.",
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
 * Bolt Spaces is the existing cowork / Decision Workspace list.
 * Public anonymous has no real destination — hide it.
 * Signed-in Mode A/B exposes the store (Home = new ask, Spaces = threads).
 */
export function canExposeBoltSpaces(input: { signedIn: boolean }): boolean {
  return input.signedIn;
}

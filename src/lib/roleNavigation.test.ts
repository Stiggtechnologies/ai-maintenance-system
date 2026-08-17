/**
 * Navigation integrity — the sidebar, the command palette, the routes, and the
 * per-role allow-lists are four lists of the same thing maintained in four
 * files.
 *
 * Deleting the fabricated /performance dashboard meant removing its route, its
 * nav item, and its id from three separate role allow-lists; missing any one of
 * them leaves a menu entry that navigates to the catch-all, or an allow-list
 * naming a surface that no longer exists. Nothing in the repository checked
 * that the three agreed, so the drift would have been discovered by a user.
 *
 * The command palette was the fourth list and was not covered here, which is
 * how it kept offering /scenarios and /autonomy after both pages were deleted
 * for inventing their figures. A palette entry is a navigation destination like
 * any other — it is searched by name, so a dead one is arguably worse than a
 * dead sidebar item — and it is checked alongside the sidebar below.
 *
 * Redirect targets are checked too. Two deleted pages kept their paths as
 * redirects so that existing bookmarks land on the screen that answers the
 * question honestly rather than on the catch-all. That only holds while the
 * target still exists: delete /governance and /autonomy silently resumes
 * dropping people on Mission Control, which is the failure the redirect was
 * added to prevent.
 *
 * The sources are read as text rather than imported because AppShell pulls in
 * the Supabase client and the whole component tree to answer a question about
 * two string literals.
 */
import { readFileSync } from "node:fs";
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";

/** Text between a declaration and the line that closes it. */
function block(source: string, opener: string, closer: string): string {
  const start = source.indexOf(opener);
  expect(start, `${opener} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(closer, start);
  expect(end, `${closer} not found after ${opener}`).toBeGreaterThan(-1);
  return source.slice(start, end);
}

const NAV_GROUPS = block(
  readFileSync("src/components/AppShell.tsx", "utf8"),
  "const navGroups: NavGroup[] = [",
  "\n];",
);

const NAV_ALLOW = block(
  readFileSync("src/lib/roleNavigation.ts", "utf8"),
  "const NAV_ALLOW:",
  "\n};",
);

const PALETTE = block(
  readFileSync("src/components/CommandSearch.tsx", "utf8"),
  "const allResults: SearchResult[] = [",
  "\n];",
);

const APP = readFileSync("src/App.tsx", "utf8");

// An id paired with the next path declared before any other id — which is what
// a leaf nav item is, and what a group (whose next id belongs to its first
// child) deliberately is not.
const navItems = [
  ...NAV_GROUPS.matchAll(
    /id:\s*"([^"]+)"(?:(?!id:)[\s\S])*?path:\s*"([^"]+)"/g,
  ),
].map((m) => ({ id: m[1], path: m[2] }));

// Palette entries are keyed by a two-letter search abbreviation, so they are
// identified here by the label the user actually reads.
const paletteItems = [
  ...PALETTE.matchAll(
    /label:\s*"([^"]+)"(?:(?!label:)[\s\S])*?path:\s*"([^"]+)"/g,
  ),
].map((m) => ({ label: m[1], path: m[2] }));

// Both lists are navigation destinations. A failure names the file and the
// entry, because the two are edited by different people for different reasons.
const destinations = [
  ...navItems.map(({ id, path }) => ({ source: "AppShell", name: id, path })),
  ...paletteItems.map(({ label, path }) => ({
    source: "CommandSearch",
    name: label,
    path,
  })),
];

const allowListIds = [...NAV_ALLOW.matchAll(/^\s*"([a-z-]+)",?$/gm)].map(
  (m) => m[1],
);

// Both catch-alls — the signed-out "/*" and the in-shell "*" — are excluded:
// either one matches every path, which would let a nav item that points
// nowhere pass as routed. A route whose element is a bare <Navigate> records
// where it forwards to; anything else, including the conditional element on
// /signin, is a page in its own right.
const declaredRoutes = APP.split("<Route")
  .slice(1)
  .flatMap((chunk) => {
    const path = /path="([^"]+)"/.exec(chunk)?.[1];
    if (path === undefined || /(^|\/)\*$/.test(path)) return [];
    const redirectsTo = /element=\{<Navigate\s+to="([^"]+)"/.exec(chunk)?.[1];
    return [{ path, redirectsTo }];
  });

const routes = declaredRoutes.map(({ path }) => ({ path }));

describe("navigation integrity", () => {
  it("parses the four sources it compares", () => {
    expect(navItems.length).toBeGreaterThan(20);
    expect(paletteItems.length).toBeGreaterThan(20);
    expect(allowListIds.length).toBeGreaterThan(20);
    expect(routes.length).toBeGreaterThan(20);
  });

  it("routes every navigation destination to a declared route", () => {
    const unrouted = destinations.filter(
      (item) => !matchRoutes(routes, item.path),
    );
    expect(unrouted).toEqual([]);
  });

  it("keeps every role allow-list entry pointing at a navigation item", () => {
    const ids = new Set(navItems.map((item) => item.id));
    expect([...new Set(allowListIds)].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("forwards every surviving redirect to a route that still exists", () => {
    const dangling = declaredRoutes.filter(
      (route) =>
        route.redirectsTo !== undefined &&
        !matchRoutes(routes, route.redirectsTo),
    );
    expect(dangling).toEqual([]);
  });
});

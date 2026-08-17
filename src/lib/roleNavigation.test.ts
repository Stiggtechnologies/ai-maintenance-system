/**
 * Navigation integrity — the nav, the routes, and the per-role allow-lists are
 * three lists of the same thing maintained in three files.
 *
 * Deleting the fabricated /performance dashboard meant removing its route, its
 * nav item, and its id from three separate role allow-lists; missing any one of
 * them leaves a menu entry that navigates to the catch-all, or an allow-list
 * naming a surface that no longer exists. Nothing in the repository checked
 * that the three agreed, so the drift would have been discovered by a user.
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

const APP = readFileSync("src/App.tsx", "utf8");

// An id paired with the next path declared before any other id — which is what
// a leaf nav item is, and what a group (whose next id belongs to its first
// child) deliberately is not.
const navItems = [
  ...NAV_GROUPS.matchAll(
    /id:\s*"([^"]+)"(?:(?!id:)[\s\S])*?path:\s*"([^"]+)"/g,
  ),
].map((m) => ({ id: m[1], path: m[2] }));

const allowListIds = [...NAV_ALLOW.matchAll(/^\s*"([a-z-]+)",?$/gm)].map(
  (m) => m[1],
);

// Both catch-alls — the signed-out "/*" and the in-shell "*" — are excluded:
// either one matches every path, which would let a nav item that points
// nowhere pass as routed.
const routes = APP.split("<Route")
  .slice(1)
  .map((chunk) => /path="([^"]+)"/.exec(chunk)?.[1])
  .filter((p): p is string => p !== undefined && !/(^|\/)\*$/.test(p))
  .map((path) => ({ path }));

describe("navigation integrity", () => {
  it("parses the three sources it compares", () => {
    expect(navItems.length).toBeGreaterThan(20);
    expect(allowListIds.length).toBeGreaterThan(20);
    expect(routes.length).toBeGreaterThan(20);
  });

  it("routes every navigation destination to a declared route", () => {
    const unrouted = navItems.filter((item) => !matchRoutes(routes, item.path));
    expect(unrouted).toEqual([]);
  });

  it("keeps every role allow-list entry pointing at a navigation item", () => {
    const ids = new Set(navItems.map((item) => item.id));
    expect([...new Set(allowListIds)].filter((id) => !ids.has(id))).toEqual([]);
  });
});

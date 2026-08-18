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
 * The counts are under test as well (navigation-lifecycle-ia.md §5 Step 6):
 * the sidebar total and per-group sizes drifted twice during the IA's own
 * drafting (36 vs 37), and the §3 role-matrix sizes were mis-stated by two
 * separate critiques — so both are snapshotted from source here, not prose.
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

// Each group declares exactly one icon, and item paths only occur after it —
// so splitting on `icon:` yields one chunk per group whose path count is that
// group's size. (The chunk also contains the NEXT group's id and label, which
// carry no path.)
const groupSizes = NAV_GROUPS.split(/icon:\s/)
  .slice(1)
  .map((chunk) => [...chunk.matchAll(/path:\s*"/g)].length);

// Per-role allow-list sizes, read from the same text the ids come from.
// null = full navigation.
const allowSizes = Object.fromEntries(
  [...NAV_ALLOW.matchAll(/^\s{2}(\w+):\s*(null|new Set\(\[)/gm)].map((m) => {
    if (m[2] === "null") return [m[1], null];
    const setStart = NAV_ALLOW.indexOf(m[0]) + m[0].length;
    const setEnd = NAV_ALLOW.indexOf("])", setStart);
    const entries = [
      ...NAV_ALLOW.slice(setStart, setEnd).matchAll(/"([a-z-]+)"/g),
    ];
    return [m[1], entries.length];
  }),
);

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

/**
 * The §3 rule: a role is shown a nav item only where it holds at least one
 * UNGATED action on the destination, or the surface is explicitly read-only.
 * Exceptions are listed here one by one with their evidence, because an
 * absolute rule invites silent exceptions.
 *
 * technician → notifications is the sole entry: three of the four screening
 * RPCs gate to planner/RE/MM/admin (20260906090000:88,141,192), but
 * raise_maintenance_notification (:32-50) is ungated and raising is the
 * technician's actual job. It qualifies only because the page surfaces the
 * server's refusal for the gated acts — which the test below pins.
 *
 * This is materially unlike executive → approvals (removed outright): there
 * the RLS predicate denies every write and the page used to broadcast
 * success on a zero-row rejection. The two must not be treated as one class.
 */
const DOCUMENTED_EXCEPTIONS = [
  {
    role: "technician",
    itemId: "notifications",
    // The page whose writes the server may refuse for this role; it must
    // surface the refusal rather than swallow it.
    page: "src/pages/NotificationScreening.tsx",
  },
];

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

  it("keeps the §2 tree at 37 items in 9 groups — the count that drifted twice", () => {
    expect(groupSizes).toEqual([4, 4, 3, 2, 2, 8, 7, 3, 4]);
    expect(navItems.length).toBe(37);
  });

  it("keeps the §3 role-matrix sizes — enumerated sets, not add/lose prose", () => {
    expect(allowSizes).toEqual({
      admin: null,
      ai_admin: null,
      operator: 6,
      technician: 8,
      planner: 17,
      reliability_engineer: 25,
      maintenance_manager: 25,
      executive: 18,
    });
  });

  it("keeps the ungated-action rule's exception list at its single documented entry", () => {
    // Growing this list is a design decision, not a wiring change: each new
    // entry needs the same evidence trail as technician → notifications.
    expect(
      DOCUMENTED_EXCEPTIONS.map(({ role, itemId }) => ({ role, itemId })),
    ).toEqual([{ role: "technician", itemId: "notifications" }]);

    // Every exception must point at a real allow-list entry and a real nav
    // item, or the documentation is about nothing.
    const ids = new Set(navItems.map((item) => item.id));
    for (const exception of DOCUMENTED_EXCEPTIONS) {
      expect(allowListIds).toContain(exception.itemId);
      expect(ids.has(exception.itemId)).toBe(true);
      expect(NAV_ALLOW).toContain(`${exception.role}: new Set(`);
    }
  });

  it("surfaces the server's refusal on every excepted page instead of swallowing it", () => {
    // The exception is only tolerable because a technician who tries a gated
    // screening act reads the RPC's own refusal sentence. The page's call
    // helper does that two ways: RPCs that return {error} have it rendered
    // (setFlash), and RPCs that fail outright have their message thrown to
    // the same handler.
    for (const exception of DOCUMENTED_EXCEPTIONS) {
      const page = readFileSync(exception.page, "utf8");
      expect(page).toContain("setFlash(result.error)");
      expect(page).toContain("throw new Error(error.message)");
    }
  });
});

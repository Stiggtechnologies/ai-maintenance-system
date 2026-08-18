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

// Per-role allow-list entries, read from the same text the ids come from.
// null = full navigation. Entries (not just sizes) are kept because the two
// org-layer roles added in 2026-08 are pinned by membership below — a size
// that stays 8 while the set swaps an item is exactly the drift a count
// cannot catch.
const allowEntries: Record<string, string[] | null> = Object.fromEntries(
  [...NAV_ALLOW.matchAll(/^\s{2}(\w+):\s*(null|new Set\(\[)/gm)].map((m) => {
    if (m[2] === "null") return [m[1], null];
    const setStart = NAV_ALLOW.indexOf(m[0]) + m[0].length;
    const setEnd = NAV_ALLOW.indexOf("])", setStart);
    const entries = [
      ...NAV_ALLOW.slice(setStart, setEnd).matchAll(/"([a-z-]+)"/g),
    ].map((entry) => entry[1]);
    return [m[1], entries];
  }),
);

const allowSizes = Object.fromEntries(
  Object.entries(allowEntries).map(([role, entries]) => [
    role,
    entries === null ? null : entries.length,
  ]),
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
 * technician → notifications: three of the four screening RPCs gate to
 * planner/RE/MM/admin (20260906090000:88,141,192), but
 * raise_maintenance_notification (:32-50) is ungated and raising is the
 * technician's actual job. It qualifies only because the page surfaces the
 * server's refusal for the gated acts — which the test below pins.
 *
 * supervisor → notifications is the same class with the same evidence: the
 * supervisor's crews raise notifications through the ungated RPC, the
 * screening gates exclude the role identically, and the same page surfaces
 * the same refusal sentence. One idiom, two frontline roles.
 *
 * Both are materially unlike executive → approvals (removed outright): there
 * the RLS predicate denies every write and the page used to broadcast
 * success on a zero-row rejection. The two classes must not be merged.
 */
const DOCUMENTED_EXCEPTIONS = [
  {
    role: "technician",
    itemId: "notifications",
    // The page whose writes the server may refuse for this role; it must
    // surface the refusal rather than swallow it.
    page: "src/pages/NotificationScreening.tsx",
  },
  {
    role: "supervisor",
    itemId: "notifications",
    page: "src/pages/NotificationScreening.tsx",
  },
];

/**
 * Surfaces granted under the rule's OTHER arm — no ungated action, explicitly
 * designated read-only. Each entry pins the two mechanisms that keep the
 * designation true: the page's client-side gate must not name the role (no
 * promised button the server would refuse), and the server's own refusal must
 * be rendered if the write is ever attempted anyway.
 *
 * supervisor → scheduling is the entry that created the list: the supervisor
 * reads the week's options and the crew capacity behind them, while
 * release_schedule_option gates to planner/mm/admin/ai_admin
 * (20260806190000:176) and SchedulerPanel's RELEASE_ROLES mirrors that set.
 *
 * board and supervisor → mission-control joined when adversarial
 * verification showed the approve flow was ungated for both: the page showed
 * every role the Approve/act buttons, and recommendations_org_rw
 * (00000000000001:489) would have accepted the write. Now
 * RECOMMENDATION_ACT_ROLES omits both roles (every pre-existing role keeps
 * exactly what it had) and the restrictive policies in 20260912123000 refuse
 * the write server-side — the update gate deliberately in WITH CHECK so the
 * refusal is an error the page flashes, never a zero-row success. board's
 * remaining surfaces stay read-only by construction (SELECT-only grants);
 * mission-control was its one surface with a write path, and it is pinned
 * here instead of exempted.
 */
const DOCUMENTED_READ_ONLY = [
  {
    role: "supervisor",
    itemId: "scheduling",
    page: "src/components/SchedulerPanel.tsx",
    clientGate: "const RELEASE_ROLES",
    refusal: "setMessage(r.error)",
  },
  {
    role: "supervisor",
    itemId: "mission-control",
    page: "src/pages/MissionControl.tsx",
    clientGate: "const RECOMMENDATION_ACT_ROLES",
    refusal: "flash(e instanceof Error ? e.message",
  },
  {
    role: "board",
    itemId: "mission-control",
    page: "src/pages/MissionControl.tsx",
    clientGate: "const RECOMMENDATION_ACT_ROLES",
    refusal: "flash(e instanceof Error ? e.message",
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

  it("keeps the §2 tree at 38 items in 9 groups — the count that drifted twice", () => {
    // 37 became 38 when Reliability by Design cleared the P-7 disqualifier
    // (the RAM allocation stopped being pinned to the demo project code) and
    // joined Whole Life.
    expect(groupSizes).toEqual([4, 4, 3, 2, 3, 8, 7, 3, 4]);
    expect(navItems.length).toBe(38);
  });

  it("keeps the §3 role-matrix sizes — enumerated sets, not add/lose prose", () => {
    expect(allowSizes).toEqual({
      admin: null,
      ai_admin: null,
      operator: 6,
      technician: 8,
      supervisor: 8,
      planner: 17,
      reliability_engineer: 26, // 25 + design (unpinned, read-only)
      maintenance_manager: 25,
      executive: 19, // 18 + design (unpinned, read-only)
      board: 6,
    });
  });

  it("pins the two org-layer roles by membership, not size alone", () => {
    // supervisor is the frontline slice §3 named as maintenance_manager's
    // second job — crew focus, no approval authority, no decision rights.
    expect(allowEntries.supervisor).toEqual([
      "mission-control",
      "work",
      "notifications",
      "scheduling",
      "handover",
      "emergency",
      "briefing",
      "settings",
    ]);
    // board is the executive-review read surface and nothing else: no
    // approvals, no governance, no execution or strategy surfaces.
    expect(allowEntries.board).toEqual([
      "mission-control",
      "executive",
      "value",
      "benchmarking",
      "trust",
      "settings",
    ]);
  });

  it("grants the two new roles no approval authority — the server contract is untouched", () => {
    // The owner approved navigation and read access, not authority. The
    // approval-authority contract (the USING and WITH CHECK predicate on
    // every approvals table) must not have quietly grown either role, and
    // the decision-rights seed must not have gained rows for them.
    const authorityContract = readFileSync(
      "supabase/migrations/00000000000022_approval_authority_contract.sql",
      "utf8",
    );
    const decisionRights = readFileSync(
      "supabase/migrations/00000000000024_decision_rights_matrix.sql",
      "utf8",
    );
    for (const role of ["supervisor", "board"]) {
      expect(authorityContract).not.toContain(`'${role}'`);
      expect(decisionRights).not.toContain(`'${role}'`);
    }
  });

  it("keeps every read-only designation honest — no promised button, no swallowed refusal", () => {
    for (const entry of DOCUMENTED_READ_ONLY) {
      expect(allowEntries[entry.role]).toContain(entry.itemId);
      const page = readFileSync(entry.page, "utf8");
      // The client-side gate exists and does not name the read-only role…
      const gateStart = page.indexOf(entry.clientGate);
      expect(gateStart, `${entry.clientGate} not found`).toBeGreaterThan(-1);
      const gate = page.slice(gateStart, page.indexOf("]);", gateStart));
      expect(gate).not.toContain(`"${entry.role}"`);
      // …and the server's own refusal is rendered, never swallowed.
      expect(page).toContain(entry.refusal);
    }
  });

  it("serves board packs through every server path — the policy AND the cascade's own filter", () => {
    // 20260912090000 admitted the board to board_packs_read, but the RPC that
    // actually serves the board record (get_accountability_cascade,
    // 20260808210000:512) filters packs on its own in-function role list — a
    // third server filter the IA doc's §3 inventory missed. 20260912120000
    // recreates the function with the board included; this pins the filter as
    // text so the pack path cannot silently regress to policy-only access.
    const cascade = readFileSync(
      "supabase/migrations/20260912120000_board_cascade_access.sql",
      "utf8",
    );
    expect(cascade).toContain(
      "create or replace function public.get_accountability_cascade()",
    );
    const packsFilter = /from board_packs[\s\S]*?v_role in \(([^)]*)\)/.exec(
      cascade,
    );
    expect(packsFilter, "packs role filter not found").not.toBeNull();
    // The board joins; nobody the original filter admitted is lost.
    for (const role of ["board", "executive", "admin", "ai_admin"]) {
      expect(packsFilter![1]).toContain(`'${role}'`);
    }
    // And the write gate that keeps the board (and supervisor) read-only on
    // mission-control refuses loudly: the update gate must live in WITH
    // CHECK, because a USING denial is a zero-row success the page would
    // report as approval.
    const writeGate = readFileSync(
      "supabase/migrations/20260912123000_readonly_recommendation_write_gate.sql",
      "utf8",
    );
    const updatePolicy = /for update[\s\S]*?with check \(([\s\S]*?)\);/.exec(
      writeGate,
    );
    expect(updatePolicy, "restrictive update policy not found").not.toBeNull();
    expect(updatePolicy![1]).toContain("not in ('board', 'supervisor')");
  });

  it("keeps the ungated-action rule's exception list at its documented entries", () => {
    // Growing this list is a design decision, not a wiring change: each new
    // entry needs the same evidence trail as technician → notifications.
    expect(
      DOCUMENTED_EXCEPTIONS.map(({ role, itemId }) => ({ role, itemId })),
    ).toEqual([
      { role: "technician", itemId: "notifications" },
      { role: "supervisor", itemId: "notifications" },
    ]);

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

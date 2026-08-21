/**
 * Navigation integrity keeps the sidebar, command palette, routes and role
 * allow-lists synchronized. These are deliberately source-contract tests: a
 * dead or unauthorized navigation surface must fail CI before it reaches a
 * user.
 */
import { readFileSync } from "node:fs";
import { matchRoutes } from "react-router-dom";
import { describe, expect, it } from "vitest";

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

const navItems = [
  ...NAV_GROUPS.matchAll(
    /id:\s*"([^"]+)"(?:(?!id:)[\s\S])*?path:\s*"([^"]+)"/g,
  ),
].map((match) => ({ id: match[1], path: match[2] }));

const groupSizes = NAV_GROUPS.split(/icon:\s/)
  .slice(1)
  .map((chunk) => [...chunk.matchAll(/path:\s*"/g)].length);

const allowEntries: Record<string, string[] | null> = Object.fromEntries(
  [...NAV_ALLOW.matchAll(/^\s{2}(\w+):\s*(null|new Set\(\[)/gm)].map((match) => {
    if (match[2] === "null") return [match[1], null];
    const setStart = NAV_ALLOW.indexOf(match[0]) + match[0].length;
    const setEnd = NAV_ALLOW.indexOf("])", setStart);
    const entries = [
      ...NAV_ALLOW.slice(setStart, setEnd).matchAll(/"([a-z-]+)"/g),
    ].map((entry) => entry[1]);
    return [match[1], entries];
  }),
);

const allowSizes = Object.fromEntries(
  Object.entries(allowEntries).map(([role, entries]) => [
    role,
    entries === null ? null : entries.length,
  ]),
);

const paletteItems = [
  ...PALETTE.matchAll(
    /label:\s*"([^"]+)"(?:(?!label:)[\s\S])*?path:\s*"([^"]+)"/g,
  ),
].map((match) => ({ label: match[1], path: match[2] }));

const destinations = [
  ...navItems.map(({ id, path }) => ({ source: "AppShell", name: id, path })),
  ...paletteItems.map(({ label, path }) => ({
    source: "CommandSearch",
    name: label,
    path,
  })),
];

const allowListIds = [...NAV_ALLOW.matchAll(/^\s*"([a-z-]+)",?$/gm)].map(
  (match) => match[1],
);

const declaredRoutes = APP.split("<Route")
  .slice(1)
  .flatMap((chunk) => {
    const path = /path="([^"]+)"/.exec(chunk)?.[1];
    if (path === undefined || /(^|\/)\*$/.test(path)) return [];
    const redirectsTo = /element=\{<Navigate\s+to="([^"]+)"/.exec(chunk)?.[1];
    return [{ path, redirectsTo }];
  });
const routes = declaredRoutes.map(({ path }) => ({ path }));

const DOCUMENTED_EXCEPTIONS = [
  {
    role: "technician",
    itemId: "notifications",
    page: "src/pages/NotificationScreening.tsx",
  },
  {
    role: "supervisor",
    itemId: "notifications",
    page: "src/pages/NotificationScreening.tsx",
  },
];

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
    expect(destinations.filter((item) => !matchRoutes(routes, item.path))).toEqual([]);
  });

  it("keeps every role allow-list entry pointing at a navigation item", () => {
    const ids = new Set(navItems.map((item) => item.id));
    expect([...new Set(allowListIds)].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("forwards every surviving redirect to a route that still exists", () => {
    expect(
      declaredRoutes.filter(
        (route) => route.redirectsTo !== undefined && !matchRoutes(routes, route.redirectsTo),
      ),
    ).toEqual([]);
  });

  it("keeps the §2 tree at 41 items in 9 groups", () => {
    // Sync Recovery is the ninth Work Management surface and owns the governed
    // downtime-event orchestration flow.
    expect(groupSizes).toEqual([5, 4, 3, 2, 3, 9, 7, 3, 5]);
    expect(navItems.length).toBe(41);
  });

  it("keeps the §3 role-matrix sizes after Recovery is added", () => {
    expect(allowSizes).toEqual({
      admin: null,
      ai_admin: null,
      operator: 7,
      technician: 9,
      supervisor: 9,
      planner: 19,
      reliability_engineer: 28,
      maintenance_manager: 27,
      executive: 20,
      board: 6,
      assessment_sponsor: 2,
    });
  });

  it("makes Sync Recovery reachable from shell, palette and router", () => {
    expect(navItems).toContainEqual({ id: "recovery", path: "/recovery" });
    expect(paletteItems).toContainEqual({ label: "Sync Recovery", path: "/recovery" });
    expect(matchRoutes(routes, "/recovery")).not.toBeNull();
    expect(APP).toContain('import SyncRecoveryPage from "./pages/SyncRecoveryPage"');
  });

  it("pins frontline supervisor navigation and keeps board operationally isolated", () => {
    expect(allowEntries.supervisor).toEqual([
      "mission-control",
      "work",
      "notifications",
      "scheduling",
      "recovery",
      "handover",
      "emergency",
      "briefing",
      "settings",
    ]);
    expect(allowEntries.board).toEqual([
      "mission-control",
      "executive",
      "value",
      "benchmarking",
      "trust",
      "settings",
    ]);
  });

  it("grants supervisor and board no approval authority", () => {
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

  it("keeps every documented read-only designation honest", () => {
    for (const entry of DOCUMENTED_READ_ONLY) {
      expect(allowEntries[entry.role]).toContain(entry.itemId);
      const page = readFileSync(entry.page, "utf8");
      const gateStart = page.indexOf(entry.clientGate);
      expect(gateStart, `${entry.clientGate} not found`).toBeGreaterThan(-1);
      const gate = page.slice(gateStart, page.indexOf("]);", gateStart));
      expect(gate).not.toContain(`"${entry.role}"`);
      expect(page).toContain(entry.refusal);
    }
  });

  it("serves board packs through policy and cascade filters", () => {
    const cascade = readFileSync(
      "supabase/migrations/20260912120000_board_cascade_access.sql",
      "utf8",
    );
    const packsFilter = /from board_packs[\s\S]*?v_role in \(([^)]*)\)/.exec(cascade);
    expect(packsFilter, "packs role filter not found").not.toBeNull();
    for (const role of ["board", "executive", "admin", "ai_admin"]) {
      expect(packsFilter![1]).toContain(`'${role}'`);
    }

    const writeGate = readFileSync(
      "supabase/migrations/20260912123000_readonly_recommendation_write_gate.sql",
      "utf8",
    );
    const updatePolicy = /for update[\s\S]*?with check \(([\s\S]*?)\);/.exec(writeGate);
    expect(updatePolicy, "restrictive update policy not found").not.toBeNull();
    expect(updatePolicy![1]).toContain("not in ('board', 'supervisor')");
  });

  it("keeps the ungated-action exception list at its documented entries", () => {
    expect(
      DOCUMENTED_EXCEPTIONS.map(({ role, itemId }) => ({ role, itemId })),
    ).toEqual([
      { role: "technician", itemId: "notifications" },
      { role: "supervisor", itemId: "notifications" },
    ]);

    const ids = new Set(navItems.map((item) => item.id));
    for (const exception of DOCUMENTED_EXCEPTIONS) {
      expect(allowListIds).toContain(exception.itemId);
      expect(ids.has(exception.itemId)).toBe(true);
      expect(NAV_ALLOW).toContain(`${exception.role}: new Set(`);
    }
  });

  it("surfaces server refusal on every excepted page", () => {
    for (const exception of DOCUMENTED_EXCEPTIONS) {
      const page = readFileSync(exception.page, "utf8");
      expect(page).toContain("setFlash(result.error)");
      expect(page).toContain("throw new Error(error.message)");
    }
  });
});

const TOUR_SOURCE = readFileSync("scripts/capture-role-tour.mjs", "utf8");
const RUNBOOK_MD = readFileSync("docs/demo-runbook-ahs-fleet.md", "utf8");

const tourRoles = [
  ...block(TOUR_SOURCE, "const TOUR = [", "\n];").matchAll(
    /key:\s*"(\w+)"[\s\S]*?routes:\s*\[([^\]]*)\]/g,
  ),
].map((match) => ({
  key: match[1],
  stops: [...match[2].matchAll(/"([^"]+)"/g)].map((route) => route[1]),
}));

const tourAccounts: Record<string, string> = Object.fromEntries(
  [
    ...block(TOUR_SOURCE, "const ACCOUNT = {", "\n};").matchAll(
      /(\w+):\s*"([^"]+)"/g,
    ),
  ].map((match) => [match[1], match[2]]),
);

const runbookLogins = [
  ...RUNBOOK_MD.matchAll(/\|\s*[^|]+?\s*\|\s*(\S+@\S+)\s*\|\s*\S+\s*\|/g),
].map((match) => match[1].toLowerCase());

describe("role tour integrity", () => {
  it("parses the tour, accounts and runbook credentials", () => {
    expect(tourRoles.length).toBeGreaterThan(3);
    expect(Object.keys(tourAccounts).length).toBeGreaterThan(3);
    expect(runbookLogins.length).toBeGreaterThan(3);
  });

  it("tours maintenance_manager", () => {
    expect(tourRoles.map((role) => role.key)).toContain("maintenance_manager");
  });

  it("gives every toured role a demo account with runbook credentials", () => {
    for (const { key } of tourRoles) {
      const email = tourAccounts[key];
      expect(email, `no ACCOUNT entry for tour role ${key}`).toBeTruthy();
      expect(runbookLogins, `no runbook credentials row for ${email} (${key})`).toContain(email);
    }
  });

  it("routes every tour stop to a declared route", () => {
    const unrouted = tourRoles.flatMap(({ key, stops }) =>
      stops
        .filter((stop) => !matchRoutes(routes, stop))
        .map((stop) => ({ key, stop })),
    );
    expect(unrouted).toEqual([]);
  });

  it("keeps every tour stop inside the toured role's navigation", () => {
    const idByPath = new Map(navItems.map((item) => [item.path, item.id]));
    const escapes = tourRoles.flatMap(({ key, stops }) => {
      const allowed = allowEntries[key];
      if (allowed === undefined) return [{ key, stop: "(no NAV_ALLOW entry)" }];
      if (allowed === null) return [];
      return stops
        .filter((stop) => {
          const id = idByPath.get(stop);
          return id !== undefined && !allowed.includes(id);
        })
        .map((stop) => ({ key, stop }));
    });
    expect(escapes).toEqual([]);
  });
});

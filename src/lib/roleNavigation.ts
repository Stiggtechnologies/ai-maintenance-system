/**
 * Role-based command centers: where each organizational level lands after
 * sign-in, and which navigation items form that role's working surface.
 * Data access is enforced server-side (RLS + audience-filtered RPCs);
 * this layer shapes the EXPERIENCE per role — board room down.
 *
 * The allow-lists implement the role matrix of
 * docs/enterprise-readiness/navigation-lifecycle-ia.md §3, whose rule is
 * stated once and applied uniformly: a role is shown a nav item only if it
 * has at least one UNGATED action on the destination, or the surface is
 * explicitly read-only for it. The one documented exception (technician →
 * notifications) is listed in roleNavigation.test.ts with its evidence.
 *
 * THIS IS MENU VISIBILITY, NOT ENTITLEMENT. What a role may DO is decided by
 * the RPC gates and RLS the matrix cites — and by nothing in this file.
 */

export type AppRoleKey =
  | "admin"
  | "ai_admin"
  | "executive"
  | "board"
  | "maintenance_manager"
  | "supervisor"
  | "reliability_engineer"
  | "planner"
  | "technician"
  | "operator"
  | string;

/** Landing route (the role's command center) after sign-in. */
export function getRoleHome(role: AppRoleKey | null | undefined): string {
  switch (role) {
    case "executive":
    case "board":
      return "/executive";
    case "maintenance_manager":
    case "supervisor":
    case "technician":
      return "/work";
    case "planner":
      return "/briefing";
    case "admin":
    case "ai_admin":
    case "reliability_engineer":
    default:
      return "/mission-control";
  }
}

/**
 * Navigation allow-list per role (nav item ids from AppShell). null = full
 * navigation, reserved for the admin roles. Groups with no visible items
 * disappear automatically. Set sizes are snapshotted by
 * roleNavigation.test.ts so §3's counts cannot drift silently.
 */
const NAV_ALLOW: Record<string, Set<string> | null> = {
  admin: null,
  ai_admin: null,
  // operator is a strict reduction: a real server-side role that had no
  // entry here and therefore fell through to the FULL navigation. It gets
  // handover because release_equipment/accept_equipment are gated TO it,
  // and notifications because raise_maintenance_notification is ungated.
  // It does NOT get the Work Action Board (spec P-9).
  operator: new Set([
    "mission-control",
    "assets",
    "notifications",
    "handover",
    "emergency",
    "settings",
  ]),
  // technician gains notifications (raising one is the technician's job —
  // the documented exception) and handover (return_equipment is ungated
  // because returning equipment is the maintenance act in the three-party
  // loop).
  technician: new Set([
    "mission-control",
    "work",
    "notifications",
    "handover",
    "emergency",
    "cowork",
    "learning-loop",
    "settings",
  ]),
  // supervisor is the frontline layer the IA doc named as a gap: until it
  // existed, maintenance_manager carried both the department-head and the
  // crew-assignment job (§3). The set is the crew-facing slice and nothing
  // above it. Qualifying evidence, item by item:
  //   work          — work_orders is org-scoped RLS with no role gate
  //                   (00000000000001 org_rw policy): ungated actions.
  //   notifications — raise_maintenance_notification is ungated
  //                   (20260906090000:32-50); the screening RPCs exclude
  //                   supervisor and the page surfaces the server's refusal
  //                   (the technician→notifications idiom, second entry in
  //                   the test's exception list).
  //   scheduling    — READ-ONLY, documented: release_schedule_option gates
  //                   to planner/mm/admin/ai_admin (20260806190000:176), so
  //                   the supervisor reads the week's options and the crew
  //                   capacity behind them; SchedulerPanel hides the release
  //                   action client-side and surfaces the server refusal.
  //   handover      — return_equipment is deliberately ungated
  //                   (20260812140000:120-150): returning equipment is the
  //                   maintenance act, and the supervisor's crew does it.
  //                   release/accept remain operations acts the page's own
  //                   flash surfaces as refusals.
  //   emergency, briefing — the shift ritual and the emergency surface are
  //                   the frontline's own screens (briefing renders briefs
  //                   from reads; no gated write on the page).
  // NO approvals, NO decision-governance: the role holds no approval
  // authority (app_role_has_approval_authority excludes it) and no
  // decision-rights rows — granting the menu item would promise authority
  // the server denies.
  supervisor: new Set([
    "mission-control",
    "work",
    "notifications",
    "scheduling",
    "handover",
    "emergency",
    "briefing",
    "settings",
  ]),
  // planner loses value — a programme-benefits review surface with no
  // planner action; planning accuracy and schedule compliance stay
  // reachable on /oee and /briefing.
  planner: new Set([
    "mission-control",
    "cowork",
    "assets",
    "onboarding",
    "pm-programme",
    "job-plans",
    "reliability",
    "notifications",
    "work",
    "scheduling",
    "materials",
    "briefing",
    "playbooks",
    "oee",
    "learning-loop",
    "integrations",
    "settings",
  ]),
  // reliability_engineer narrows from full nav to its working surface:
  // scheduling and handover are server-denied to the role; the execution
  // and executive-review surfaces are not its job. oee and integrations are
  // deliberately kept (spec P-11) — availability loss is the RE's primary
  // input, and the RE owns the condition-monitoring feeds. design joined
  // when the RAM allocation stopped being pinned to the demo project code
  // (the P-7 disqualifier): a read-only surface (all seven tables are
  // SELECT-only RLS) whose operations-to-design feedback loop is the RE's
  // own E2 edge.
  reliability_engineer: new Set([
    "mission-control",
    "command-centers",
    "readiness",
    "cowork",
    "assets",
    "asset-ontology",
    "asset-twins",
    "onboarding",
    "reliability",
    "intervals",
    "risk",
    "lifecycle",
    "lifecycle-decisions",
    "design",
    "job-plans",
    "pm-programme",
    "notifications",
    "work",
    "briefing",
    "approvals",
    "decision-governance",
    "oee",
    "learning-loop",
    "integrations",
    "integration-health",
    "settings",
  ]),
  // maintenance_manager: set rebuilt (spec P-12) — loses the executive
  // review surfaces, gains the work-management and strategy surfaces,
  // including handover so the returning party can see the
  // awaiting-acceptance limbo it creates.
  maintenance_manager: new Set([
    "mission-control",
    "cowork",
    "assets",
    "onboarding",
    "reliability",
    "intervals",
    "risk",
    "lifecycle-decisions",
    "job-plans",
    "pm-programme",
    "notifications",
    "work",
    "scheduling",
    "materials",
    "handover",
    "briefing",
    "playbooks",
    "emergency",
    "approvals",
    "decision-governance",
    "oee",
    "learning-loop",
    "integrations",
    "integration-health",
    "settings",
  ]),
  // executive loses approvals (app_role_has_approval_authority excludes the
  // role — the RLS predicate on every approvals table) and the scheduling/
  // job-plan surfaces whose writes are server-denied (spec P-3); it gains
  // intervals, lifecycle, lifecycle-decisions and handover — every one a
  // gate the server already opens to the role. design joined when the RAM
  // allocation stopped being pinned to the demo project code: it is the one
  // screen where a project's availability promise meets arithmetic, and it
  // is read-only for every role.
  executive: new Set([
    "mission-control",
    "command-centers",
    "readiness",
    "executive",
    "oee",
    "value",
    "benchmarking",
    "trust",
    "learning-loop",
    "assets",
    "reliability",
    "intervals",
    "lifecycle",
    "lifecycle-decisions",
    "design",
    "risk",
    "decision-governance",
    "handover",
    "settings",
  ]),
  // board is a strict READ surface — the executive-review set and nothing
  // else. Migration 20260912090000 is what makes these pages non-empty for
  // the role: the four Board-accountable KPI audience arrays and
  // board_packs_read now admit 'board'. Three of those four KPIs are seeded
  // computable=false and the KPI screen says so in words (Awaiting source) —
  // granting the seat grants one live number and three named gaps, which is
  // the honest state. The role holds NO write anywhere: no approvals, no
  // decision-rights rows, no authority_limits tier.
  board: new Set([
    "mission-control",
    "executive",
    "value",
    "benchmarking",
    "trust",
    "settings",
  ]),
};

/**
 * The fall-through for a role string nobody vetted. It used to be the FULL
 * navigation — an unrecognised role saw every item — so the default is now
 * the smallest read surface that keeps the app usable (spec §3,
 * unknown-role default).
 */
const UNKNOWN_ROLE_NAV: ReadonlySet<string> = new Set([
  "mission-control",
  "settings",
]);

export function isNavItemVisible(
  role: AppRoleKey | null | undefined,
  itemId: string,
): boolean {
  // Admin-only surfaces are hidden from every non-admin role, even those
  // that otherwise get the full navigation.
  if (itemId === "security-log") return role === "admin" || role === "ai_admin";
  const allow = role ? NAV_ALLOW[role] : undefined;
  if (allow === null) return true; // full nav — admin roles only
  if (allow === undefined) return UNKNOWN_ROLE_NAV.has(itemId);
  return allow.has(itemId);
}

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
  | "maintenance_manager"
  | "reliability_engineer"
  | "planner"
  | "technician"
  | "operator"
  | string;

/** Landing route (the role's command center) after sign-in. */
export function getRoleHome(role: AppRoleKey | null | undefined): string {
  switch (role) {
    case "executive":
      return "/executive";
    case "maintenance_manager":
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
  // input, and the RE owns the condition-monitoring feeds.
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
  // gate the server already opens to the role.
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
    "risk",
    "decision-governance",
    "handover",
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

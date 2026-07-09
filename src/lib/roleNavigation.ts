/**
 * Role-based command centers: where each organizational level lands after
 * sign-in, and which navigation items form that role's working surface.
 * Data access is enforced server-side (RLS + audience-filtered RPCs);
 * this layer shapes the EXPERIENCE per role — board room down.
 */

export type AppRoleKey =
  | "admin"
  | "ai_admin"
  | "executive"
  | "maintenance_manager"
  | "reliability_engineer"
  | "planner"
  | "technician"
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
 * navigation. Groups with no visible items disappear automatically.
 */
const NAV_ALLOW: Record<string, Set<string> | null> = {
  admin: null,
  ai_admin: null,
  reliability_engineer: null,
  executive: new Set([
    "mission-control",
    "command-centers",
    "readiness",
    "executive",
    "performance",
    "oee",
    "learning-loop",
    "value",
    "benchmarking",
    "trust",
    "assets",
    "reliability",
    "risk",
    "decision-governance",
    "approvals",
    "settings",
  ]),
  maintenance_manager: new Set([
    "mission-control",
    "command-centers",
    "readiness",
    "cowork",
    "ai-workforce",
    "autonomy",
    "autonomy-maturity",
    "approvals",
    "decision-governance",
    "assets",
    "onboarding",
    "reliability",
    "risk",
    "work",
    "scenario-simulator",
    "briefing",
    "playbooks",
    "emergency",
    "executive",
    "performance",
    "oee",
    "learning-loop",
    "value",
    "benchmarking",
    "trust",
    "integrations",
    "integration-health",
    "settings",
  ]),
  planner: new Set([
    "mission-control",
    "cowork",
    "assets",
    "onboarding",
    "reliability",
    "work",
    "scenario-simulator",
    "briefing",
    "playbooks",
    "performance",
    "oee",
    "learning-loop",
    "value",
    "integrations",
    "settings",
  ]),
  technician: new Set([
    "mission-control",
    "work",
    "emergency",
    "cowork",
    "learning-loop",
    "settings",
  ]),
};

export function isNavItemVisible(
  role: AppRoleKey | null | undefined,
  itemId: string,
): boolean {
  const allow = role ? NAV_ALLOW[role] : undefined;
  if (allow === null || allow === undefined) return true; // full nav
  return allow.has(itemId);
}

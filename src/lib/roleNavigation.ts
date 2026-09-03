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
    case "assessment_sponsor":
      return "/assessments";
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
  // Recovery is visible because the operator may open an event and is one of
  // the two roles permitted to accept final return-to-service; Recovery's
  // server RPCs remain the authority for every button.
  // cowork is omitted: operator's working surface is field execution and
  // the three-party handover (release_equipment/accept_equipment gated TO
  // it). Field collaboration already lives on Field and Handover. Cowork
  // is a workspace-authoring surface; technician already has it for the
  // maintenance-side collaboration job. Expanding this deliberately
  // reduced set would blur operator vs technician. MENU VISIBILITY ONLY —
  // an operator who bookmarks /cowork still hits the same RLS.
  operator: new Set([
    "mission-control",
    "assets",
    "notifications",
    "field",
    "recovery",
    "handover",
    "emergency",
    "settings",
  ]),
  // technician gains notifications (raising one is the technician's job —
  // the documented exception) and handover (return_equipment is ungated
  // because returning equipment is the maintenance act in the three-party
  // loop). Recovery gives the technician the controlled live-execution lane;
  // planning/release/RTS controls remain server-denied.
  // cowork is the field/handover collaboration surface (page framing).
  // NO decision-workspace: technician has neither Develop nor
  // decision-governance.
  technician: new Set([
    "mission-control",
    "work",
    "notifications",
    "field",
    "recovery",
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
  //   work          — work_orders is org-scoped RLS with no role gate.
  //   notifications — raise_maintenance_notification is ungated.
  //   scheduling    — READ-ONLY; release remains planner/mm/admin/ai_admin.
  //   recovery      — event scope/blockers/live execution are supervisor
  //                   actions; plan generation/release and RTS are not.
  //   handover      — return_equipment is the maintenance act.
  //   emergency, briefing — the frontline shift surfaces.
  //   cowork        — crew/work/recovery collaboration of any intent;
  //                   page copy adapts; persistence is existing
  //                   cowork_workspaces / cowork_messages RLS.
  // NO approvals, NO decision-governance, NO decision-workspace: the
  // role holds no approval authority, no decision-rights rows, and no
  // Develop / decision-governance working surface.
  supervisor: new Set([
    "mission-control",
    "work",
    "notifications",
    "field",
    "scheduling",
    "recovery",
    "handover",
    "emergency",
    "briefing",
    "cowork",
    "settings",
  ]),
  // planner owns the event-plan authoring lane: scope, constraints, verified
  // concurrency, deterministic plan generation, submission and approved-plan
  // release. Approval itself remains independent in the canonical queue.
  // decision-workspace — planner already has Develop; the governed
  // Decision Workspace is the Develop-bound record, not Cowork.
  planner: new Set([
    "mission-control",
    "develop",
    "decision-workspace",
    "cowork",
    "assessments",
    "assets",
    "onboarding",
    "pm-programme",
    "job-plans",
    "reliability",
    "notifications",
    "work",
    "scheduling",
    "recovery",
    "materials",
    "briefing",
    "playbooks",
    "oee",
    "learning-loop",
    "integrations",
    "settings",
  ]),
  // reliability_engineer narrows from full nav to its working surface. Recovery
  // is included for engineering constraints, concurrency verification, plan
  // generation and independent plan approval; field execution/RTS remain
  // server-gated to operating roles.
  // decision-workspace — already has Develop + decision-governance.
  reliability_engineer: new Set([
    "mission-control",
    "develop",
    "decision-workspace",
    "command-centers",
    "readiness",
    "assessments",
    "cowork",
    "assets",
    "asset-ontology",
    "asset-twins",
    "onboarding",
    "reliability",
    "intervals",
    "risk",
    "knowledge",
    "lifecycle",
    "lifecycle-decisions",
    "design",
    "job-plans",
    "pm-programme",
    "notifications",
    "work",
    "recovery",
    "briefing",
    "approvals",
    "decision-governance",
    "oee",
    "learning-loop",
    "integrations",
    "integration-health",
    "settings",
  ]),
  // maintenance_manager owns the full maintenance-side Recovery lane and can
  // participate in final RTS acceptance, while independent approval remains
  // enforced by the canonical authority contract and generator!=approver rule.
  maintenance_manager: new Set([
    "mission-control",
    "develop",
    "decision-workspace",
    "cowork",
    "assessments",
    "assets",
    "onboarding",
    "reliability",
    "intervals",
    "risk",
    "knowledge",
    "lifecycle-decisions",
    "job-plans",
    "pm-programme",
    "notifications",
    "work",
    "scheduling",
    "recovery",
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
  // executive receives Recovery as an explicitly read-oriented operating/value
  // view. The page may render controls, but every mutation is denied by the
  // Recovery RPC role gates; menu visibility never grants authority.
  // cowork — portfolio collaboration (value/risk framing on the page).
  // decision-workspace — executive already has develop + decision-governance.
  executive: new Set([
    "mission-control",
    "develop",
    "decision-workspace",
    "cowork",
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
    "knowledge",
    "decision-governance",
    "recovery",
    "handover",
    "settings",
  ]),
  // board is a strict READ surface — executive-review surfaces only. Recovery
  // is deliberately excluded because the event workspace exposes operational
  // detail beyond the board governance job; aggregate value remains /value.
  // cowork is included as portfolio collaboration (page framing; writes
  // remain RLS-gated). decision-workspace is excluded: board has neither
  // Develop nor decision-governance.
  board: new Set([
    "mission-control",
    "executive",
    "value",
    "benchmarking",
    "trust",
    "cowork",
    "settings",
  ]),
  // Assessment sponsors remain limited to the engagement workspace/settings.
  assessment_sponsor: new Set(["assessments", "settings"]),
};

/**
 * The fall-through for a role string nobody vetted. It used to be the FULL
 * navigation — an unrecognised role saw every item — so the default is now
 * the smallest read surface that keeps the app usable.
 */
const UNKNOWN_ROLE_NAV: ReadonlySet<string> = new Set([
  "mission-control",
  "settings",
]);

export function isNavItemVisible(
  role: AppRoleKey | null | undefined,
  itemId: string,
): boolean {
  if (itemId === "security-log" || itemId === "pilot-leads")
    return role === "admin" || role === "ai_admin";
  const allow = role ? NAV_ALLOW[role] : undefined;
  if (allow === null) return true;
  if (allow === undefined) return UNKNOWN_ROLE_NAV.has(itemId);
  return allow.has(itemId);
}

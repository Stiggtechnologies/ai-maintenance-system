/**
 * Cowork Studio role-band mapping.
 *
 * MENU VISIBILITY is decided in roleNavigation.ts. This file only adapts
 * copy, template order, and empty-state framing once a signed-in profile
 * is already on /cowork. It does not grant or deny persistence — that
 * remains cowork_workspaces / cowork_messages RLS.
 *
 * Bands (one surface, role-adapted):
 *   portfolio   — board, executive
 *   crew        — maintenance_manager, supervisor
 *   engineering — reliability_engineer, planner, admin/ai_admin, unknown
 *   field       — technician, operator (operator is not shown the nav item)
 *
 * Cowork is collaboration of any intent, not Develop-only. Templates are
 * reordered, not hidden: every band can start any workspace.
 */

export type CoworkRoleBand =
  | "portfolio"
  | "crew"
  | "engineering"
  | "field";

export function coworkRoleBand(
  role: string | null | undefined,
): CoworkRoleBand {
  switch (role) {
    case "board":
    case "executive":
      return "portfolio";
    case "maintenance_manager":
    case "supervisor":
      return "crew";
    case "technician":
    case "operator":
      return "field";
    default:
      return "engineering";
  }
}

export interface CoworkBandCopy {
  subtitle: string;
  emptyHint: string;
  placeholder: string;
  collaborationTitle: string;
  collaborationBlurb: string;
}

export const COWORK_BAND_COPY: Record<CoworkRoleBand, CoworkBandCopy> = {
  portfolio: {
    subtitle:
      "Portfolio collaboration — value, risk, and briefing spaces. Not plant control.",
    emptyHint:
      "No spaces yet. Start a briefing, risk review, or value conversation — collaboration of any intent, not a development case.",
    placeholder: "e.g., Brief the board on fleet risk and deferred work.",
    collaborationTitle: "Portfolio collaboration",
    collaborationBlurb:
      "Cowork is a shared space for any intent — briefings, risk, and value conversations. Starting a workspace persists to cowork_workspaces; chat replies through the Reliability Engineering agent. This is not plant control and not the governed Decision Workspace.",
  },
  crew: {
    subtitle:
      "Crew and work collaboration — recovery, shutdown, and the week's work.",
    emptyHint:
      "No spaces yet. Start a recovery, shutdown, or crew-coordination workspace — collaboration of any intent.",
    placeholder: "e.g., Coordinate tonight's recovery and crew assignments.",
    collaborationTitle: "Crew collaboration",
    collaborationBlurb:
      "Cowork is a shared space for any intent — recovery, shutdown, and the week's work. Starting a workspace persists to cowork_workspaces; chat replies through the Reliability Engineering agent. This is not plant control and not the governed Decision Workspace.",
  },
  engineering: {
    subtitle:
      "Collaborative workspaces for maintenance, reliability, and mission assurance.",
    emptyHint:
      "No spaces yet. Start an RCA, PM, programme, or shutdown workspace — collaboration of any intent, not a development case.",
    placeholder: "e.g., Structure an RCA for a repeating seal failure.",
    collaborationTitle: "Engineering collaboration",
    collaborationBlurb:
      "Cowork is a shared space for any intent — RCA, PM, programme, and shutdown work. Starting a workspace persists to cowork_workspaces; chat replies through the Reliability Engineering agent. This is not plant control and not the governed Decision Workspace.",
  },
  field: {
    subtitle:
      "Field and handover collaboration — observations, shift notes, and return-to-service.",
    emptyHint:
      "No spaces yet. Start a handover, field observation, or return-to-service workspace — collaboration of any intent.",
    placeholder: "e.g., Capture the shift handover and open observations.",
    collaborationTitle: "Field collaboration",
    collaborationBlurb:
      "Cowork is a shared space for any intent — handover notes, field observations, and return-to-service. Starting a workspace persists to cowork_workspaces; chat replies through the Reliability Engineering agent. This is not plant control and not the governed Decision Workspace.",
  },
};

/** Lead template ids per band. Remaining templates follow in declaration order. */
export const COWORK_TEMPLATE_LEAD_IDS: Record<CoworkRoleBand, readonly string[]> =
  {
    // Value / risk / briefing first. Do not lead with field-execution templates.
    portfolio: ["t-5", "t-8", "t-9", "t-1", "t-7"],
    // Crew / work / recovery first.
    crew: ["t-10", "t-4", "t-7", "t-3", "t-11"],
    // RCA / PM / programme / shutdown — the historical default order.
    engineering: ["t-1", "t-2", "t-3", "t-4"],
    // Field / handover first. Do not lead with Executive Briefing.
    field: ["t-11", "t-12", "t-13", "t-10"],
  };

export function orderCoworkTemplates<T extends { id: string }>(
  templates: readonly T[],
  band: CoworkRoleBand,
): T[] {
  const lead = COWORK_TEMPLATE_LEAD_IDS[band];
  const rank = new Map(lead.map((id, index) => [id, index]));
  return [...templates].sort((a, b) => {
    const aRank = rank.get(a.id) ?? lead.length + templates.indexOf(a);
    const bRank = rank.get(b.id) ?? lead.length + templates.indexOf(b);
    return aRank - bRank;
  });
}

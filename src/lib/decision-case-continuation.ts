import type { DecisionCase } from "./decision-case";

export type ContinuationCommand =
  | "reconsider"
  | "verification_return"
  | "record_share"
  | "revoke_share"
  | "propose_rollout"
  | "record_rollout_result"
  | "decide_rollout";
export const ROLLOUT_PHASES = [
  "pilot",
  "site",
  "fleet",
  "enterprise",
  "handover",
] as const;
export type RolloutPhase = (typeof ROLLOUT_PHASES)[number];
export interface RolloutProposal {
  phase: RolloutPhase;
  siteIds: string[];
  assetIds: string[];
  metric: string;
  unit: string;
  baseline: number;
  target: number;
  direction: "at_most" | "at_least";
  minimumObservations: number;
  windowEnd: string;
  acceptanceEvidenceIds: string[];
  rollbackPlan: string;
  handoverPlan: string;
  residualRiskBasis: string;
  receivingOwnerId: string;
}
export interface CaseShare {
  id: string;
  recipientId: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  version: number;
  status: "active" | "revoked";
}
declare module "./decision-case" {
  interface DecisionCase {
    reconsideration?: {
      reason: string;
      recordedAt: string;
      previousApprovalVersion: number;
    };
    verificationReturn?: {
      ownerId: string;
      dueAt: string;
      status: "scheduled" | "snoozed" | "acknowledged" | "completed";
      delivery: "in_app_only";
    };
    shares?: CaseShare[];
    rollout?: {
      status: "proposed" | "accepted" | "rejected";
      proposal: RolloutProposal;
      proposedBy: string;
      acceptedPhase?: RolloutPhase;
      result?: {
        actual: number;
        observations: number;
        evidenceId: string;
        criteriaMet: boolean;
        recordedBy: string;
      };
    };
  }
}
export function nextRolloutPhase(
  decisionCase: DecisionCase,
): RolloutPhase | null {
  const accepted = decisionCase.rollout?.acceptedPhase;
  return (
    ROLLOUT_PHASES[accepted ? ROLLOUT_PHASES.indexOf(accepted) + 1 : 0] ?? null
  );
}
export function verificationReturnDue(
  decisionCase: DecisionCase,
  now = Date.now(),
): boolean {
  const reminder = decisionCase.verificationReturn;
  return Boolean(
    reminder &&
    reminder.status !== "completed" &&
    Number.isFinite(Date.parse(reminder.dueAt)) &&
    Date.parse(reminder.dueAt) <= now,
  );
}
export function caseReplayPath(caseId: string, share: CaseShare): string {
  return `/get-started?case=${encodeURIComponent(caseId)}&view=evaluation&replayVersion=${share.version}&share=${encodeURIComponent(share.id)}`;
}

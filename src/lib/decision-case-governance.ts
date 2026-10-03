import "./decision-case";

export interface DecisionActor {
  id: string;
  name: string;
  role: string;
}

export interface HumanDispositionRecord {
  disposition: "accept" | "reject" | "need_more_evidence" | "park" | "escalate";
  rationale: string;
  counterfactual?: string;
  expiresOn?: string;
  actor?: DecisionActor;
  recordedAt: string;
}

export interface RequiredDecisionPerson {
  userId: string;
  name: string;
  email?: string;
  authorityRole: string;
  invitationStatus: "not_sent" | "sent";
  recordedBy?: DecisionActor;
  recordedAt: string;
}

export interface HumanApprovalRecord {
  decision: "approved" | "rejected" | "changes_requested" | "delegated";
  reason: string;
  delegatedTo?: string | null;
  actor?: DecisionActor;
  recordedAt: string;
  /** Canonical case version whose governed basis the person reviewed. */
  basisVersion: number;
  /** SHA-256 of the server-projected recommendation/decision basis. */
  basisSha256: string;
  /** Version created by the approval command itself. */
  approvalVersion: number;
}

declare module "./decision-case" {
  interface DecisionMessage {
    actorId?: string;
    actorRole?: string;
  }

  interface DecisionEvidence {
    persistence?: "embedded" | "governed_reference" | "pending";
    durableReference?: string;
  }

  interface DecisionCase {
    revision?: number;
    humanDecision?: HumanDispositionRecord;
    requiredPerson?: RequiredDecisionPerson;
    humanApproval?: HumanApprovalRecord;
  }
}

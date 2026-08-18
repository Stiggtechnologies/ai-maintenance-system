/**
 * SyncStreamEvent — the transport-independent streaming event contract from
 * the Sync specification (§17), with the block/evidence shapes it references
 * (§18 AssistantBlock, §10.10 / FR-090 EvidenceReference).
 *
 * WHY THIS EXISTS NOW. The repository has no streaming mechanism at all —
 * zero hits for text/event-stream or ReadableStream across src/ and
 * supabase/functions/ — so §17's "use the repository's existing streaming
 * mechanism if one exists" resolves to "none exists; normalize to a
 * transport-independent event model". This file is that model. It is a
 * contract, not a feature: nothing user-visible consumes it while
 * sync_global_shell is off (which it is, everywhere, by seed).
 *
 * The rule the contract enforces (§17 closing line): UI components must
 * never parse model prose to determine tool state. Tool progress, approval
 * waits, and errors are typed events, full stop.
 *
 * Referenced shapes (ProposedAction, CalculationRecord, Recommendation,
 * EntityReference) are defined here at the minimum the spec states.
 * They carry no engineering semantics of their own — thresholds, risk
 * classifications, and approval requirements remain server-decided
 * (SEC-005: client-supplied risk levels are never authoritative).
 */

/** §10.10 FR-090 — evidence as data, not markdown. */
export interface EvidenceReference {
  id: string;
  sourceType: string;
  sourceId: string;
  title?: string;
  excerpt?: string;
  locator?: {
    page?: number;
    section?: string;
    timestamp?: string;
    recordId?: string;
  };
  applicationUrl?: string;
  retrievedAt?: string;
}

/** §18 / §25 — a link to an application entity, never a fabricated URL. */
export interface EntityReference {
  type: string;
  id: string;
  displayName?: string;
}

/** §18 — a calculation the assistant surfaced, reproducible by reference. */
export interface CalculationRecord {
  id: string;
  title: string;
  method?: string;
  inputs?: Record<string, unknown>;
  result?: unknown;
  units?: string;
}

/** §18 / FR-064 — a recommendation block, distinct from an action. */
export interface Recommendation {
  id: string;
  summary: string;
  rationale?: string;
  evidenceRefs?: EvidenceReference[];
}

/**
 * §10.9 / §17 — an action the model PROPOSES. Proposal is not execution:
 * risk and approval come from the server-side tool definition (FR-083/084),
 * and the context revision pins the proposal to the entity state it was made
 * against (FR-045: stale context must not execute against a new entity).
 */
export interface ProposedAction {
  proposalId: string;
  toolId: string;
  title: string;
  params?: Record<string, unknown>;
  targetEntity?: EntityReference;
  risk?: "read" | "low" | "medium" | "high" | "critical";
  requiresApproval?: boolean;
  contextRevisionId?: string;
  reason?: string;
}

/** §18 — structured assistant content; renderers must tolerate new kinds. */
export type AssistantBlock =
  | { kind: "markdown"; content: string }
  | { kind: "evidence"; items: EvidenceReference[] }
  | { kind: "facts"; items: string[] }
  | { kind: "hypotheses"; items: string[] }
  | { kind: "missing_evidence"; items: string[] }
  | { kind: "calculation"; calculation: CalculationRecord }
  | { kind: "recommendation"; recommendation: Recommendation }
  | { kind: "action_proposal"; action: ProposedAction }
  | { kind: "warning"; severity: string; content: string }
  | { kind: "entity_links"; entities: EntityReference[] };

/** §17 — the event union, verbatim from the specification. */
export type SyncStreamEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "transcript.partial"; text: string }
  | { type: "transcript.final"; text: string }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.block"; block: AssistantBlock }
  | { type: "retrieval.started"; query?: string }
  | { type: "retrieval.completed"; evidence: EvidenceReference[] }
  | { type: "agent.started"; agentId: string }
  | { type: "agent.completed"; agentId: string; status: string }
  | { type: "tool.proposed"; proposal: ProposedAction }
  | { type: "tool.awaiting_approval"; proposalId: string }
  | { type: "tool.started"; executionId: string }
  | { type: "tool.completed"; executionId: string; result: unknown }
  | { type: "tts.started"; audioId: string }
  | { type: "tts.stopped"; audioId: string }
  | { type: "turn.completed"; turnId: string }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type SyncStreamEventType = SyncStreamEvent["type"];

export const SYNC_STREAM_EVENT_TYPES: readonly SyncStreamEventType[] = [
  "turn.started",
  "transcript.partial",
  "transcript.final",
  "assistant.delta",
  "assistant.block",
  "retrieval.started",
  "retrieval.completed",
  "agent.started",
  "agent.completed",
  "tool.proposed",
  "tool.awaiting_approval",
  "tool.started",
  "tool.completed",
  "tts.started",
  "tts.stopped",
  "turn.completed",
  "error",
] as const;

/** Events after which a consumer should expect no further events this turn. */
export function isTerminalEvent(event: SyncStreamEvent): boolean {
  return (
    event.type === "turn.completed" ||
    (event.type === "error" && !event.recoverable)
  );
}

/**
 * Normalize one wire payload into a SyncStreamEvent, or null.
 *
 * Unknown event types return null rather than throwing: §18 requires
 * renderers to accept new block kinds without redesign, and the stream gets
 * the same courtesy — a newer server may emit event types an older client
 * does not know, and the client must skip them, not crash mid-turn. A
 * malformed payload (no object, no recognised type) is also null; the
 * transport decides whether that is fatal.
 */
export function parseSyncStreamEvent(raw: unknown): SyncStreamEvent | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  if (!(SYNC_STREAM_EVENT_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  return value as SyncStreamEvent;
}

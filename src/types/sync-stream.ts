/**
 * SyncStreamEvent — the transport-independent event contract shared by the
 * global Sync interaction layer. Tool state, investigation state, evidence,
 * specialist execution and latency milestones are data, never inferred from
 * model prose.
 */

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

export interface EntityReference {
  type: string;
  id: string;
  displayName?: string;
}

export interface CalculationRecord {
  id: string;
  title: string;
  method?: string;
  inputs?: Record<string, unknown>;
  result?: unknown;
  units?: string;
}

export interface Recommendation {
  id: string;
  summary: string;
  rationale?: string;
  evidenceRefs?: EvidenceReference[];
}

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

export interface SyncAttachmentReference {
  id: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number;
  extractionStatus?: "pending" | "extracting" | "ready" | "unsupported" | "failed";
}

export type InvestigationCategory =
  | "operations"
  | "data_integrity"
  | "safety"
  | "asset"
  | "work"
  | "recommendations"
  | "evidence"
  | "attachments"
  | "risk"
  | "specialist";

export type InvestigationCheckState = "ok" | "attention" | "unavailable";

export interface InvestigationCheckRecord {
  id: string;
  label: string;
  category: InvestigationCategory;
  state: InvestigationCheckState;
  detail?: string;
  durationMs?: number;
  evidence?: EvidenceReference[];
}

export interface SyncTurnTelemetry {
  firstActivityMs?: number | null;
  firstEvidenceMs?: number | null;
  firstTokenMs?: number | null;
  retrievalMs?: number | null;
  specialistMs?: number | null;
  modelMs?: number | null;
  totalMs?: number | null;
  sourceCount?: number;
  checkCount?: number;
}

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

export type SyncStreamEvent =
  | { type: "turn.started"; turnId: string; conversationId?: string }
  | { type: "investigation.started"; turnId: string; plannedChecks: number }
  | {
      type: "investigation.check.started";
      checkId: string;
      label: string;
      category: InvestigationCategory;
    }
  | {
      type: "investigation.check.completed";
      check: InvestigationCheckRecord;
    }
  | {
      type: "investigation.completed";
      checks: InvestigationCheckRecord[];
      evidence: EvidenceReference[];
    }
  | { type: "transcript.partial"; text: string }
  | { type: "transcript.final"; text: string }
  | { type: "assistant.delta"; text: string; sequence?: number }
  | { type: "assistant.block"; block: AssistantBlock }
  | { type: "retrieval.started"; query?: string }
  | { type: "retrieval.completed"; evidence: EvidenceReference[] }
  | {
      type: "agent.started";
      agentId: string;
      label?: string;
      executionMode?: "executed" | "applied";
    }
  | {
      type: "agent.completed";
      agentId: string;
      label?: string;
      status: string;
      executionMode?: "executed" | "applied";
      durationMs?: number;
    }
  | { type: "telemetry.updated"; telemetry: SyncTurnTelemetry }
  | { type: "tool.proposed"; proposal: ProposedAction }
  | { type: "tool.awaiting_approval"; proposalId: string }
  | { type: "tool.started"; executionId: string }
  | { type: "tool.completed"; executionId: string; result: unknown }
  | { type: "tts.started"; audioId: string }
  | { type: "tts.stopped"; audioId: string }
  | {
      type: "turn.completed";
      turnId: string;
      telemetry?: SyncTurnTelemetry;
      checks?: InvestigationCheckRecord[];
    }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type SyncStreamEventType = SyncStreamEvent["type"];

export const SYNC_STREAM_EVENT_TYPES: readonly SyncStreamEventType[] = [
  "turn.started",
  "investigation.started",
  "investigation.check.started",
  "investigation.check.completed",
  "investigation.completed",
  "transcript.partial",
  "transcript.final",
  "assistant.delta",
  "assistant.block",
  "retrieval.started",
  "retrieval.completed",
  "agent.started",
  "agent.completed",
  "telemetry.updated",
  "tool.proposed",
  "tool.awaiting_approval",
  "tool.started",
  "tool.completed",
  "tts.started",
  "tts.stopped",
  "turn.completed",
  "error",
] as const;

export function isTerminalEvent(event: SyncStreamEvent): boolean {
  return (
    event.type === "turn.completed" ||
    (event.type === "error" && !event.recoverable)
  );
}

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

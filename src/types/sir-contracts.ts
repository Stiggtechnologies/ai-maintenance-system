/**
 * Typed I/O contracts for the three-plane architecture.
 *
 * See docs/architecture/canonical-plane-ownership.md for the canonical
 * plane ownership decision:
 *   - Autonomous = Control/Governance Plane (decisions, approvals, actions)
 *   - OpenClaw   = Intelligence Plane (agent runtime, tool orchestration)
 *   - SIR        = Interaction/Logging (sessions, transcripts, costs)
 *
 * These contracts define the typed envelope every Intelligence Plane
 * call must carry, plus the typed result shape every agent capability
 * must return. The DB does not enforce these — they are enforced at
 * the boundary of every Edge Function (added in PR 3).
 *
 * Doctrine alignment:
 *   - Intelligence Plane outputs must be structured (no free prose
 *     as the only return value).
 *   - Every run carries a correlation_id and an idempotency_key so the
 *     Control Plane can retry, gate, and audit safely.
 *   - autonomy_level is first-class on every envelope and result.
 *
 * Audit truth:
 *   Autonomous (autonomous_decisions + autonomous_actions) is the ONLY
 *   canonical audit chain. SIR interaction logs and OpenClaw runtime
 *   traces are observational — they support debugging and UX but are
 *   NOT authoritative for compliance, governance, or operational audit.
 */

/**
 * Governed Autonomy doctrine levels.
 *
 * - `advisory`    — recommend only, no execution.
 * - `conditional` — prepared but blocked until human approval.
 * - `controlled`  — allowlisted automatic execution within policy bounds.
 *
 * Mirrors the Postgres `autonomy_level` enum on `sir_orchestration_runs`,
 * `sir_tool_calls`, and `autonomous_decisions`.
 */
export type AutonomyLevel = "advisory" | "conditional" | "controlled";

/** Mirrors `sir_orchestration_runs.status`. */
export type OrchestrationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

/** Mirrors `approval_workflows.status` (Autonomous Control/Governance Plane). */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

/**
 * Generic envelope every call into the OpenClaw Intelligence Plane must carry.
 * The Control Plane (Edge Function) is responsible for enforcing
 * `autonomy_level` and `idempotency_key` at runtime.
 */
export interface AgentTaskEnvelope<TInput extends object> {
  /** Tenant (organization) scoping the call. Maps to `tenant_id` columns. */
  tenant_id: string;

  /** Stable code identifying which capability to run. */
  task_code: string;

  /** Agent implementation to route to (e.g. `reliability_engineer`). */
  agent_code: string;

  /**
   * Autonomy level the caller is requesting.
   * Policy can downgrade (e.g. from `controlled` to `conditional`)
   * but can never upgrade.
   */
  autonomy_level: AutonomyLevel;

  /**
   * Caller-supplied idempotency key. Paired with `tenant_id` by the
   * partial unique index on `sir_orchestration_runs` to guarantee
   * at-most-once orchestration creation for retried requests.
   *
   * Derive from something stable at the call site, e.g.
   * `${work_order_id}:${task_code}:${prompt_version}`.
   */
  idempotency_key: string;

  /**
   * Shared correlation id that threads every downstream record produced
   * by this call (orchestration run, messages, tool calls, costs,
   * approval requests, audit events).
   */
  correlation_id: string;

  /** Schema version of `input`. Persisted on `sir_orchestration_runs`. */
  input_schema_version: string;

  /** Prompt version. Persisted on `sir_orchestration_runs`. */
  prompt_version: string;

  /** Capability-specific input payload. */
  input: TInput;
}

/**
 * Structured output every agent capability must return.
 *
 * Free-form prose goes in `raw_summary` (rendered to humans);
 * machine-consumable fields go in `output`.
 */
export interface AgentTaskResult<TOutput extends object> {
  /** Semver-ish schema version of the typed `output`. */
  output_schema_version: string;

  /** Confidence in [0, 1]. Enforced by DB CHECK on `sir_orchestration_runs.confidence`. */
  confidence: number;

  /**
   * Whether this result must block on human approval before any linked
   * tool_call executes. The Control Plane can also force this regardless
   * of what the agent reports.
   */
  requires_human_review: boolean;

  /** Plain-language summary for the operator UI / recommendation card. */
  raw_summary: string;

  /** Typed, machine-checkable result payload. */
  output: TOutput;
}

// ---------------------------------------------------------------------------
// First capability: draft reliability assessment for a work order.
//
// This is the one capability wired up by PR 3 and exercised by the golden
// path E2E rail in PR 4.
// ---------------------------------------------------------------------------

export interface DraftReliabilityAssessmentInput {
  work_order_id: string;
  asset_id: string;
  trigger_reason: "manual_request" | "failure_event" | "priority_review";
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DraftReliabilityAssessmentOutput {
  likely_causes: string[];
  recommended_actions: string[];
  risk_level: RiskLevel;
  evidence: Array<{
    source_type:
      | "work_order_history"
      | "condition_data"
      | "document"
      | "inference";
    source_ref?: string;
    note: string;
  }>;
}

export type DraftReliabilityAssessmentEnvelope =
  AgentTaskEnvelope<DraftReliabilityAssessmentInput>;

export type DraftReliabilityAssessmentResult =
  AgentTaskResult<DraftReliabilityAssessmentOutput>;

/** Stable code persisted in `sir_orchestration_runs.workflow_definition_code`. */
export const DRAFT_RELIABILITY_ASSESSMENT_TASK_CODE =
  "draft_reliability_assessment" as const;

export const DRAFT_RELIABILITY_ASSESSMENT_INPUT_SCHEMA_VERSION =
  "1.0.0" as const;

export const DRAFT_RELIABILITY_ASSESSMENT_OUTPUT_SCHEMA_VERSION =
  "1.0.0" as const;

// ---------------------------------------------------------------------------
// Approval authority — central constant for role codes that may approve
// Autonomous decisions. Used by the trigger (in SQL), RLS policies (in SQL),
// and edge functions (in TypeScript). If this list changes, the SQL trigger
// and RLS policies must be updated in a migration to match.
// ---------------------------------------------------------------------------

/**
 * Role codes with approval authority over Autonomous decisions.
 * Source of truth: supabase/seed/001_core_seed_data.sql.
 * Mirrored in:
 *   - create_approval_workflow() trigger (20260410010000 + 20260410020000)
 *   - "Managers can approve decisions" RLS policy (20260410010000)
 */
export const APPROVAL_AUTHORITY_ROLE_CODES = [
  "maintenance_manager",
  "plant_manager",
  "operations_manager",
  "reliability_engineer",
] as const;

export type ApprovalAuthorityRoleCode =
  (typeof APPROVAL_AUTHORITY_ROLE_CODES)[number];

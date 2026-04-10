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

/** Standardized risk levels used by all governed capability outputs. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Constrained evidence source types. Every governed capability must cite
 * evidence using one of these categories. This enables consistent
 * rendering, filtering, and audit analytics across capabilities.
 */
export type EvidenceSourceType =
  | "work_order_history"
  | "asset_record"
  | "condition_data"
  | "document"
  | "user_input"
  | "inference";

/**
 * A single piece of evidence supporting a governed recommendation.
 * Used in GovernedOutputBase.evidence.
 */
export interface EvidenceEntry {
  source_type: EvidenceSourceType;
  source_ref?: string;
  note: string;
}

/**
 * How deep in the lifecycle this capability goes.
 * - `advisory`    — produces a recommendation only, never triggers execution
 * - `decision`    — produces a decision that may require approval
 * - `executable`  — can produce a governed action after approval
 */
export type ExecutionMode = "advisory" | "decision" | "executable";

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

// ===========================================================================
// GOVERNED CAPABILITY PATTERN
//
// Every governed capability in the system must define a registration object
// that satisfies GovernedCapabilityDefinition. This enforces:
//   - three-plane model (can't skip Autonomous or bypass approval)
//   - governed autonomy (autonomy_level, decision_type, approval_type are required)
//   - standardized output (risk_level, evidence, confidence are structural)
//   - lifecycle clarity (input → intelligence → decision → approval → execution)
//
// See docs/architecture/governed-capability-pattern.md for the full checklist.
// ===========================================================================

/**
 * Base output shape every governed capability must include.
 * Capability-specific fields extend this interface.
 *
 * Standardizes the fields that the UI, audit chain, and approval
 * workflow all depend on — regardless of what the capability does.
 */
export interface GovernedOutputBase {
  /** Operational risk level of the recommendation. */
  risk_level: RiskLevel;

  /**
   * Evidence trail supporting the recommendation.
   * Each entry cites a source type and a human-readable note.
   * This is what a reviewer reads before approving or rejecting.
   */
  evidence: EvidenceEntry[];
}

/**
 * Compile-time registration for a governed capability.
 *
 * Every capability must define one of these as a const object. The type
 * system enforces that no field is skippable — if you forget to specify
 * `decision_type` or `default_autonomy_level`, it won't compile.
 *
 * This is NOT a runtime class or factory. It is a typed configuration
 * record that documents the capability's contract and is referenced by
 * edge functions, UI components, and tests.
 *
 * @template TTaskCode  - Literal string type for the task_code
 * @template TDecision  - Literal string type for the Autonomous decision_type
 *
 * Input/output types are enforced at the registration site via the
 * companion Envelope and Result type aliases, not in this interface.
 */
export interface GovernedCapabilityDefinition<
  TTaskCode extends string,
  TDecision extends string,
> {
  // --- Identity ---

  /** Stable task_code persisted in sir_orchestration_runs.workflow_definition_code. */
  task_code: TTaskCode;

  /** Agent implementation code routed to by ai-agent-processor. */
  agent_code: string;

  /** Human-readable name for UI display and audit logs. */
  display_name: string;

  /** One-line description for the UI help text. */
  description: string;

  // --- Governance ---

  /**
   * Default autonomy level. Policy or the caller can downgrade
   * (e.g. from 'controlled' to 'conditional') but never upgrade.
   */
  default_autonomy_level: AutonomyLevel;

  /**
   * The value written to `autonomous_decisions.decision_type`.
   * Must be a stable string unique to this capability.
   */
  decision_type: TDecision;

  /**
   * Whether this capability ALWAYS requires human review, regardless
   * of confidence or risk level. If false, the agent's output
   * `requires_human_review` field is respected.
   */
  always_requires_human_review: boolean;

  /**
   * Approval policy code used for routing. Two capabilities may share
   * the same decision_type but require different approval routing.
   * This value is available to the approval trigger and policy layer.
   */
  approval_policy_code: string;

  /**
   * How deep in the lifecycle this capability goes.
   * - `advisory`   — recommendation only, no execution path
   * - `decision`   — produces a decision requiring approval, no auto-execute
   * - `executable` — can produce a governed action after approval
   */
  execution_mode: ExecutionMode;

  // --- Schema versioning ---

  input_schema_version: string;
  output_schema_version: string;
  prompt_version: string;
}

/**
 * Convenience type: the full typed envelope for a governed capability.
 */
export type CapabilityEnvelope<TInput extends object> =
  AgentTaskEnvelope<TInput>;

/**
 * Convenience type: the full typed result for a governed capability.
 * TOutput must extend GovernedOutputBase, which is enforced at the
 * definition site — not here, so existing code continues to compile.
 */
export type CapabilityResult<TOutput extends GovernedOutputBase> =
  AgentTaskResult<TOutput>;

// ===========================================================================
// CAPABILITY REGISTRY
//
// Each governed capability is defined below as:
//   1. Input interface
//   2. Output interface (extends GovernedOutputBase)
//   3. GovernedCapabilityDefinition const (the registration)
//   4. Envelope + Result type aliases (convenience)
//
// To add a new capability:
//   - Define its input, output, and registration below
//   - Follow the checklist in docs/architecture/governed-capability-pattern.md
//   - DO NOT skip governance fields — the type system will catch you
// ===========================================================================

// ---------------------------------------------------------------------------
// Capability #1: draft_reliability_assessment
//
// Wired up in PR 3. Exercised by the golden-path E2E rail in PR 4.
// ---------------------------------------------------------------------------

export interface DraftReliabilityAssessmentInput {
  work_order_id: string;
  asset_id: string;
  trigger_reason: "manual_request" | "failure_event" | "priority_review";
}

export interface DraftReliabilityAssessmentOutput extends GovernedOutputBase {
  likely_causes: string[];
  recommended_actions: string[];
}

/** Registration for draft_reliability_assessment. */
export const DRAFT_RELIABILITY_ASSESSMENT: GovernedCapabilityDefinition<
  "draft_reliability_assessment",
  "reliability_recommendation"
> = {
  task_code: "draft_reliability_assessment",
  agent_code: "reliability_engineer",
  display_name: "Draft Reliability Assessment",
  description:
    "Analyzes a work order for reliability risks and recommends maintenance actions.",
  default_autonomy_level: "conditional",
  decision_type: "reliability_recommendation",
  always_requires_human_review: false,
  approval_policy_code: "reliability_assessment_review",
  execution_mode: "decision",
  input_schema_version: "1.0.0",
  output_schema_version: "1.0.0",
  prompt_version: "1.0.0",
};

export type DraftReliabilityAssessmentEnvelope =
  CapabilityEnvelope<DraftReliabilityAssessmentInput>;

export type DraftReliabilityAssessmentResult =
  CapabilityResult<DraftReliabilityAssessmentOutput>;

/** @deprecated Use DRAFT_RELIABILITY_ASSESSMENT.task_code instead. */
export const DRAFT_RELIABILITY_ASSESSMENT_TASK_CODE =
  DRAFT_RELIABILITY_ASSESSMENT.task_code;

/** @deprecated Use DRAFT_RELIABILITY_ASSESSMENT.input_schema_version instead. */
export const DRAFT_RELIABILITY_ASSESSMENT_INPUT_SCHEMA_VERSION =
  DRAFT_RELIABILITY_ASSESSMENT.input_schema_version;

/** @deprecated Use DRAFT_RELIABILITY_ASSESSMENT.output_schema_version instead. */
export const DRAFT_RELIABILITY_ASSESSMENT_OUTPUT_SCHEMA_VERSION =
  DRAFT_RELIABILITY_ASSESSMENT.output_schema_version;

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

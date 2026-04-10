# Governed Capability Pattern

Every AI-driven capability in SyncAI must follow this pattern. No exceptions.

---

## Why this pattern exists

Without a shared structure:

- Capability 2 looks clean
- Capability 3 slightly diverges
- Capability 5 becomes ungovernable

This pattern prevents that by making the three-plane model, governed autonomy, and standardized output structural — enforced by types, not discipline.

---

## The lifecycle

Every governed capability follows this flow:

```
input → intelligence → structured result → decision → approval → (optional execution)
  │          │                │                │           │              │
  │     OpenClaw         OpenClaw         Autonomous  Autonomous    Autonomous
  │  (sir_orchestration  (sir_orchestration  (autonomous_ (approval_   (autonomous_
  │    _runs.input)       _runs.output)      decisions)  workflows)    actions)
  │          │                │                │           │              │
  └──────────┴────────────────┴────────────────┴───────────┴──────────────┘
                         correlation_id links all of it
```

SIR logs the interaction (sir_sessions, sir_messages, sir_costs) alongside but is never part of the decision/approval chain.

---

## Type contract

Every capability must define these in `src/types/sir-contracts.ts`:

### 1. Input interface

What the capability needs to run. Must include at minimum:

```typescript
interface MyCapabilityInput {
  work_order_id: string; // or asset_id, or both
  asset_id: string;
  trigger_reason: "manual_request" | "failure_event" | "...";
}
```

### 2. Output interface (extends `GovernedOutputBase`)

What the agent returns. Must include `risk_level` and `evidence`:

```typescript
interface MyCapabilityOutput extends GovernedOutputBase {
  // capability-specific fields
  my_field: string;
  my_other_field: number;
}
```

The `AgentTaskResult<TOutput>` wrapper adds:

- `confidence: number` (0-1)
- `requires_human_review: boolean`
- `raw_summary: string`
- `output_schema_version: string`

So every capability returns the same structural envelope regardless of its domain logic.

### 3. Registration (`GovernedCapabilityDefinition`)

A const object that ties identity, governance, and versioning together:

```typescript
export const MY_CAPABILITY: GovernedCapabilityDefinition<
  "my_task_code",
  "my_decision_type"
> = {
  task_code: "my_task_code",
  agent_code: "my_agent",
  display_name: "My Capability",
  description: "One-line description for UI.",
  default_autonomy_level: "conditional",
  decision_type: "my_decision_type",
  always_requires_human_review: false,
  approval_policy_code: "my_approval_policy",
  execution_mode: "decision",
  input_schema_version: "1.0.0",
  output_schema_version: "1.0.0",
  prompt_version: "1.0.0",
};
```

### 4. Envelope + Result type aliases

```typescript
export type MyCapabilityEnvelope = CapabilityEnvelope<MyCapabilityInput>;
export type MyCapabilityResult = CapabilityResult<MyCapabilityOutput>;
```

---

## Governance rules enforced by the pattern

| Rule                                       | How it's enforced                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Every result has a risk level              | `GovernedOutputBase` requires `risk_level: RiskLevel`                                             |
| Every result has typed evidence            | `GovernedOutputBase` requires `evidence: EvidenceEntry[]` with constrained `EvidenceSourceType`   |
| Every result has confidence                | `AgentTaskResult` requires `confidence: number`                                                   |
| Every result declares human-review need    | `AgentTaskResult` requires `requires_human_review: boolean`                                       |
| Every capability has a decision type       | `GovernedCapabilityDefinition` requires `decision_type`                                           |
| Every capability has an autonomy level     | `GovernedCapabilityDefinition` requires `default_autonomy_level`                                  |
| Every capability declares approval routing | `GovernedCapabilityDefinition` requires `approval_policy_code`                                    |
| Every capability declares lifecycle depth  | `GovernedCapabilityDefinition` requires `execution_mode` (`advisory` / `decision` / `executable`) |
| Autonomy cannot be upgraded at runtime     | Enforced in `ai-agent-processor` — policy can downgrade only                                      |
| All outputs are structured                 | `AgentTaskResult.output` is typed, not free prose                                                 |

---

## Plane responsibilities per capability

| Plane                                    | Writes                                                     | Reads                                                     |
| ---------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| **OpenClaw** (ai-agent-processor)        | `sir_orchestration_runs` (intelligence trace)              | `work_orders`, `assets` (task-scoped, tenant-scoped)      |
| **SIR** (ai-agent-processor)             | `sir_sessions`, `sir_messages`, `sir_costs`                | Nothing                                                   |
| **Autonomous** (autonomous-orchestrator) | `autonomous_decisions`, `approval_workflows` (via trigger) | Nothing (receives result from OpenClaw via internal call) |

OpenClaw NEVER writes to Autonomous. Autonomous NEVER writes to SIR/OpenClaw. SIR NEVER writes to Autonomous.

---

## Implementation checklist

Use this for every new capability. All items must be complete before merge.

### Type contracts

- [ ] Input interface defined in `sir-contracts.ts`
- [ ] Output interface defined, extends `GovernedOutputBase`
- [ ] `GovernedCapabilityDefinition` const defined with all fields
- [ ] `CapabilityEnvelope` + `CapabilityResult` type aliases defined
- [ ] `risk_level` and `evidence` are in the output (enforced by type)
- [ ] `decision_type` is unique (not reused from another capability)

### Intelligence Plane (OpenClaw)

- [ ] System prompt written in `ai-agent-processor` for this task_code
- [ ] System prompt requests JSON with the output schema fields
- [ ] Data access is task-scoped and tenant-scoped (no broad queries)
- [ ] `sir_orchestration_runs` row created with all control-plane columns
- [ ] `duration_ms` populated on both success and failure

### Control/Governance Plane (Autonomous)

- [ ] `autonomous_decisions` row created via `create_intelligence_decision`
- [ ] `decision_type` matches the registration
- [ ] `requires_approval` set correctly (from `always_requires_human_review` or agent output)
- [ ] `approval_workflows` row auto-created by trigger (verified)
- [ ] `correlation_id` threads the decision back to the intelligence run

### Interaction/Logging Plane (SIR)

- [ ] `sir_sessions` row created with `correlation_id` in context
- [ ] `sir_messages` rows created (user + assistant)
- [ ] `sir_costs` row created with token counts

### UI

- [ ] Button/action added to the relevant page
- [ ] Recommendation card shows: confidence, risk level, evidence, approval status
- [ ] "Governed by Autonomous" footer or equivalent trust signal
- [ ] Correlation ID displayed (first 8 chars)
- [ ] Error boundary wraps the capability UI section
- [ ] Failure state shows structured error, not generic message

### E2E test

- [ ] Happy-path test added to `tests/e2e/golden-path.spec.ts`
- [ ] Asserts `sir_orchestration_runs` row with correct `workflow_definition_code`
- [ ] Asserts `autonomous_decisions` row with correct `decision_type`
- [ ] Asserts `approval_workflows` row exists
- [ ] Asserts all records share one `correlation_id`
- [ ] Failure-path test added
- [ ] Asserts `autonomous_decisions.status = 'failed'` (not `'rejected'`)
- [ ] Asserts audit chain survives failure

### Audit

- [ ] `get_full_audit_chain(correlation_id)` returns records for this capability
- [ ] Canonical audit truth is in Autonomous (not SIR, not OpenClaw)

---

## Anti-patterns

Do NOT:

- Return free prose as the only output (always use `GovernedOutputBase`)
- Skip `decision_type` or reuse another capability's type
- Let OpenClaw write to `autonomous_decisions` directly
- Let the frontend call `autonomous-orchestrator` directly for decision creation (use the single-call flow via `ai-agent-processor`)
- Set `autonomy_level` to `'controlled'` for a new capability without explicit architectural approval
- Hardcode approval routing (use the RBAC trigger; override only via the registration's `always_requires_human_review`)
- Skip the E2E test ("I'll add it later" = it never gets added)

---

## Adding a new capability — step by step

1. Define input + output + registration in `sir-contracts.ts`
2. Add a prompt case in `ai-agent-processor/index.ts` for the new `task_code`
3. Verify the existing `create_intelligence_decision` action handles the new `decision_type` (it's generic — usually no change needed)
4. Add a UI button + recommendation card on the relevant page
5. Add E2E happy-path + failure-path tests
6. Run the checklist above
7. Commit as a single PR with the capability name in the message

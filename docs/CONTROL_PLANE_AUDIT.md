# Control Plane Substrate Audit

**Status:** Decision proposed, awaiting approval
**Date:** 2026-04-09
**Branch:** `claude/code-review-analysis-kEFhq`
**Purpose:** Pick one canonical control-plane substrate. Freeze the rest. Do not add new orchestration tables until consolidation is complete.

---

## Why this audit exists

SyncAI's product doctrine requires a three-plane architecture (Intelligence / Control / Governance & Execution), governed autonomy, ISO 55000 alignment, and operational trust over AI novelty. The repository is conceptually aligned with this, but operationally fragmented: multiple overlapping orchestration substrates each implement part of the doctrine, none implements all of it, and no substrate is designated canonical.

A proposal was made in parallel review to land a greenfield "Control Plane" migration pack (`workflow_definitions`, `workflow_runs`, `workflow_steps`, `agent_runs`, `policy_rules`, `approval_requests`, `execution_actions`, `system_events`, `control_plane_audit_events`). That proposal was **rejected** for this repository because adding it would make it the sixth parallel substrate, further fragmenting governance — the opposite of doctrine items 8, 9, and 10.

---

## The substrates that already exist

Five substrates, all partially implemented, all (except one) live:

| # | Substrate | Defining migration(s) | Table count | Tenant isolation | Live callers | Completeness |
|---|---|---|---|---|---|---|
| 1 | **SIR** (formerly OpenClaw) | `20260305000000_add_openclaw_core.sql` + phase 2 + enterprise + `20260405500000_rename_openclaw_to_sir.sql` | 15–18 (`sir_agents`, `sir_sessions`, `sir_messages`, `sir_memory`, `sir_tools`, `sir_tool_calls`, `sir_orchestration_runs`, `sir_events`, `sir_event_runs`, `sir_notifications`, `sir_costs`, `sir_skills`, `sir_errors`, `sir_queues`, `sir_queue_items`, `sir_audit_log`) | ✅ `tenant_id` on all core tables | `ai-agent-processor`, `sir-orchestrator`, `javis-orchestrator`, `sir-health`, `openclaw-orchestrator`, `gateway`, `openclaw-health`, `IntelligenceRuntimePanel`, `OpenClawControlPanel`, `OnboardingWizard`, `MetricsDashboard` | **3.5 / 5** |
| 2 | **Autonomous** | `20251021185821_create_autonomous_system_tables.sql` | 6 (`autonomous_decisions`, `autonomous_actions`, `approval_workflows`, `asset_health_monitoring`, `system_alerts`, `user_profiles`) | ❌ no `tenant_id` anywhere | `autonomous-orchestrator`, `job-processor`, `AutonomousDashboard`, `ApprovalQueue`, `autonomousMonitoring`, `dashboardServices`, `TacticalDashboard` | **4 / 5 (shape), 0 / 5 (isolation)** |
| 3 | **Job Processor** | `20260323061318_..._add_realtime_pubsub_and_job_processor.sql` | 6 (`job_definitions`, `job_queue`, `job_executions`, `realtime_channels`, `realtime_subscriptions`, `realtime_messages`) | ❌ no `tenant_id` anywhere | `gateway`, `job-processor` | **2.5 / 5** |
| 4 | **Runbooks** | `20260323062733_..._add_runbooks_system.sql` | 4 (`runbooks`, `runbook_steps`, `runbook_executions`, `runbook_step_results`) | ❌ no `tenant_id` anywhere | `runbook-executor` | **4 / 5 (shape), 0 / 5 (isolation)** |
| 5 | **Governance core (001)** | `001_core_platform.sql` + `004_governance_core.sql` | 8 (`autonomy_modes`, `approval_policies`, `decision_logs`, `audit_events`, `escalation_policies`, `decision_rules`, `approvals`, `overrides`) | ✅ `organization_id` | **None.** RLS references undefined `current_user_org_id()`. Zero callers in `supabase/functions/` or `src/` | **2 / 5 (dead code)** |

### Cross-cutting facts
- **No substrate has `correlation_id`**.
- **No substrate has `idempotency_key`**.
- **No substrate has a structured output-schema contract** — all `output jsonb` is free-form.
- **Only Autonomous and Governance have `confidence`** columns. SIR has none.
- **Only Governance has an explicit `autonomy_modes` table**, and it is dead code.
- **`public.current_tenant_id()` does not exist**. RLS elsewhere uses `auth.uid()` joined through `user_role_assignments` (`009_auth_rbac_phase2.sql`).
- **Migration ordering anomaly**: after `20260405500000_rename_openclaw_to_sir.sql` renames all tables, later migrations `20260408102253_..._add_openclaw_core.sql`, `20260408102256_..._phase2.sql`, `20260408102300_..._enterprise.sql` re-apply the original OpenClaw creation scripts using `IF NOT EXISTS`. These are effectively no-ops on a clean DB, but any partial state could produce duplicate `openclaw_*` and `sir_*` tables. Flagged for separate cleanup PR.

---

## Decision

**The canonical control-plane substrate is SIR (formerly OpenClaw).**

### Rationale

1. **Only live substrate with working multi-tenant isolation.** Autonomous, Job Processor, and Runbooks all lack `tenant_id` entirely. Governance has `organization_id` but broken RLS. Adding tenant isolation to any of those three is a multi-migration retrofit. SIR already has it, everywhere, with working RLS.
2. **Most complete shape.** 15+ tables covering agents, sessions, messages, memory, tool registry, tool calls, orchestration runs, events, event runs, queues, costs, skills, errors, and audit log. No other substrate comes close.
3. **The current golden-path target already writes to it.** `supabase/functions/ai-agent-processor/index.ts:202-225` writes to `sir_sessions`, `sir_messages`, `sir_costs`. Choosing SIR means zero substrate refactor for Step 1 of the E2E rail.
4. **Has a tool registry** (`sir_tools` + `sir_tool_calls`). This is the hook for enforcing "agents never mutate systems of record directly — they call allowlisted tools" — a core doctrine requirement. No other substrate has this primitive.
5. **Has cost tracking** (`sir_costs`). Aligns directly with the pilot-measurement GTM requirement surfaced by the website review (90-day pilot ROI, per-tenant cost attribution).
6. **Has an audit table** (`sir_audit_log`). Becomes the single source of truth for Governance Plane audit events.

The gaps in SIR (listed below) are all **additive column changes** on existing tables, plus possibly one minimal bridging table (`sir_approval_requests`) that has no equivalent anywhere else. No other substrate can be chosen without rewriting tenant isolation — a far larger change.

---

## Kill list

| Substrate | Decision | Action |
|---|---|---|
| **Autonomous** | **Kill** after porting approval semantics | Freeze. Port `confidence`, `approval_workflows` concept, and `approval_deadline` into SIR as a new `sir_approval_requests` table. Then deprecate tables + rewire `autonomous-orchestrator`, `AutonomousDashboard`, `ApprovalQueue`, `autonomousMonitoring`, `dashboardServices`, `TacticalDashboard` onto SIR. Separate PR. |
| **Job Processor** | **Freeze, do not kill** | Not a control plane. Reposition as a background-task runner that SIR *schedules onto*. Do not let new workflow logic accumulate here. Revisit when SIR has enough coverage to replace it. |
| **Runbooks** | **Kill** after salvaging vocabulary | Freeze. Borrow the `step_type` enum (`query`/`action`/`decision`/`notification`/`wait`/`approval`) and the `waiting_approval` status as additive concepts in SIR. Then deprecate tables + `runbook-executor`. Separate PR. |
| **Governance core (from 001)** | **Delete** (dead code with broken RLS) | Remove `autonomy_modes`, `approval_policies`, `decision_logs`, `audit_events`, `escalation_policies`, `decision_rules`, `approvals`, `overrides` in a separate cleanup PR. **But rescue the `autonomy_modes` doctrine intent** by creating an `autonomy_level` enum and adding it to SIR. |
| **`ai_agent_logs`** (simple log table) | **Deprecate** | All new writes go to `sir_orchestration_runs` + `sir_messages` + `sir_costs`. Drop after one release with no callers. |

---

## Doctrine Mapping Table (for SIR)

| Doctrine Concept | Current State in SIR | Gap | Minimal Fix |
|---|---|---|---|
| **Intelligence Plane — agent reasoning** | `sir_agents`, `sir_orchestration_runs`, `sir_skills`, `sir_memory` | No typed output contract; no `confidence`; no `correlation_id`; no schema version | Add columns on `sir_orchestration_runs`: `confidence numeric(4,3) CHECK (0 ≤ confidence ≤ 1)`, `correlation_id uuid`, `output_schema_version text`, `prompt_version text`. Create `src/types/sir-contracts.ts` for typed I/O. **No new tables.** |
| **Control Plane — workflow state + policy** | `sir_events`, `sir_event_runs`, `sir_queues`, `sir_orchestration_runs` | No idempotency; no autonomy level; no workflow definition concept; no policy evaluation | Add columns on `sir_orchestration_runs`: `idempotency_key text`, `autonomy_level autonomy_level`, `workflow_definition_code text`, `requires_human_review boolean`. Add `UNIQUE (tenant_id, idempotency_key)` partial index. Policy evaluation starts as a TypeScript function in an Edge Function — schema comes later if needed. **Workflow definitions start as seeded config rows in `sir_skills` or `sir_events`; new table only if that proves insufficient after implementation.** |
| **Governance Plane — approvals + audit + execution** | `sir_audit_log`, `sir_errors`, `sir_costs`, `sir_tools` + `sir_tool_calls` | No approval concept; autonomy not enforced on tool calls; no unified execution-action record | Add column `autonomy_level` on `sir_tool_calls`. Add column `approval_required boolean` on `sir_tool_calls`. **One new bridging table: `sir_approval_requests`** — genuinely required, has no equivalent anywhere, roughly 10 columns. Reuse `sir_tool_calls` as the Execution Action record — the doctrine's "only place that calls execution tools" maps directly to this existing table. |
| **Autonomy Levels — Advisory / Conditional / Controlled** | Referenced in `autonomy_modes` (001, dead); not enforced anywhere | Not enforced at runtime. Not a type. | Create `autonomy_level` enum. Add column on `sir_orchestration_runs`, `sir_tool_calls`. Enforce in Edge Functions: advisory never executes, conditional blocked until approval, controlled only via allowlisted tool codes. |

### Minimum additive footprint (what actually lands)

**No new tables** except at most `sir_approval_requests`.

**Enum:** `autonomy_level` (advisory, conditional, controlled)

**Column additions:**
- `sir_orchestration_runs`: `correlation_id uuid`, `idempotency_key text`, `autonomy_level autonomy_level`, `confidence numeric(4,3) CHECK (0 ≤ confidence ≤ 1)`, `output_schema_version text`, `prompt_version text`, `requires_human_review boolean DEFAULT false`, `workflow_definition_code text`
- `sir_tool_calls`: `autonomy_level autonomy_level`, `approval_required boolean DEFAULT false`, `approval_request_id uuid`

**One index:** `UNIQUE (tenant_id, idempotency_key)` on `sir_orchestration_runs` (partial, WHERE `idempotency_key IS NOT NULL`)

**One new typed file:** `src/types/sir-contracts.ts` — defines `DraftReliabilityAssessmentInput`, `DraftReliabilityAssessmentOutput`, `AutonomyLevel`, etc.

**One possibly-new bridging table (requires explicit approval):** `sir_approval_requests`.

---

## Do Not Build list

Under this decision, the following are explicitly **not** to be added to the repo:

- ❌ `workflow_runs` (use `sir_orchestration_runs`)
- ❌ `workflow_definitions` as a new table (start with seeded config rows)
- ❌ `workflow_steps` (orchestration is recorded via nested `sir_orchestration_runs` + `sir_tool_calls`; a steps table may come later if proven necessary, not pre-emptively)
- ❌ `agent_runs` (use `sir_orchestration_runs`)
- ❌ `execution_actions` (use `sir_tool_calls`)
- ❌ `policy_rules` as a new table (start with policy logic in Edge Functions; introduce a table only when there are enough rules to justify it)
- ❌ `system_events` as a new table (use `sir_events`)
- ❌ `control_plane_audit_events` (use `sir_audit_log`)
- ❌ `public.current_tenant_id()` helper (use the repo's existing `auth.uid()` + `user_role_assignments` pattern from `009_auth_rbac_phase2.sql`)
- ❌ The full greenfield migration pack proposed in parallel review

---

## Updated Step 1 golden-path rail (targets SIR)

Same shape as the previously agreed plan, new assertions:

**Happy path**
1. Login as seeded user for tenant `00000000-0000-0000-0000-000000000001`
2. Open seeded asset `...000000000100` ("Primary Feed Pump A")
3. Navigate to seeded work order `...000000000201` ("Pump Seal Inspection", `pending`)
4. Click "Start Work" → asserts a row is inserted into `work_order_status_history`
5. Click "Draft Reliability Assessment" (new minimal button in `WorkOrderDetailPage`) → triggers Edge Function `ai-agent-processor` (refactored to honor `LLM_BASE_URL` and use a typed contract) with `autonomy_level='conditional'`, `correlation_id=<uuid>`, `idempotency_key=<derived>`
6. Mock LLM returns deterministic structured JSON matching `DraftReliabilityAssessmentOutput`
7. Assertions:
   - `sir_orchestration_runs` row exists with `status='completed'`, `autonomy_level='conditional'`, `requires_human_review=true`, matching `correlation_id`, non-null `confidence`, populated `output_schema_version`
   - `sir_messages` has user + assistant messages linked to the session
   - `sir_costs` has a row for this run
   - `sir_approval_requests` has a pending row (if the bridging table is approved)
   - `work_order_status_history` has the "Start Work" transition
   - **One `correlation_id` threads all of the above**
8. UI shows "Recommendation pending approval" with confidence + source

**Failure path** (`LLM_MOCK_FAIL=1`)
1. Same flow until step 5
2. Mock LLM returns HTTP 500
3. Assertions:
   - `sir_orchestration_runs.status = 'failed'`
   - `sir_errors` row exists with `correlation_id`
   - Structured log line: `event=agent_invocation_failed agent=ai-agent-processor correlation_id=<uuid>`
   - `AgentErrorBoundary` renders a non-generic error with the correlation ID
   - No write to `sir_tool_calls` (nothing executed)

**Frontend-direct-write assertion** (doctrine enforcement)
- Supabase client with an authenticated tenant JWT attempts a direct `INSERT INTO sir_orchestration_runs` → RLS rejects it. Test asserts the insert fails. This proves Intelligence Plane writes only happen via Edge Functions.

---

## Sequence of PRs after this audit is approved

1. **This PR** — commit this audit doc only. No code, no SQL.
2. **PR 2** — Enum + column additions on `sir_orchestration_runs` and `sir_tool_calls`. Typed contracts in `src/types/sir-contracts.ts`. RLS tightening: writes to `sir_orchestration_runs`, `sir_tool_calls`, `sir_audit_log` restricted to `service_role` only. Forward-compatible with existing callers (no breaking changes).
3. **PR 3** — `LLM_BASE_URL` env seam in `ai-agent-processor`. Structured failure logging. `AgentErrorBoundary` targeted around the agent invocation UI. Minimal "Draft Reliability Assessment" button on `WorkOrderDetailPage`.
4. **PR 4** — Playwright harness + `golden-path.spec.ts` + mock LLM fixture server + `scripts/dev-full.sh` + GitHub Actions CI.
5. **PR 5** (optional, requires approval) — `sir_approval_requests` table + wire it into the golden-path rail.
6. **PR 6+** — Decommission Autonomous, Runbooks, Governance-core-001, `ai_agent_logs`. Separate PR per substrate, each with a "zero callers" proof.

---

## What this audit does NOT decide

- The final shape of workflow definitions. Start with config rows; graduate to a table only if warranted by real usage.
- The final shape of policy evaluation. Start in Edge Function code; graduate to `policy_rules` table only if warranted.
- Whether `workflow_steps` is ever needed. Maybe — but not until real orchestration experience says so.
- Whether Job Processor eventually gets merged into SIR or becomes a separate background-runner plane. Defer.
- How executive vs. operator UX splits. Separate concern, separate audit.

---

## Acceptance note

**What this decision proves:** The repo has a single canonical control-plane substrate (SIR), a kill list for the others, and a minimum additive path to doctrine compliance without adding parallel systems.

**What this decision does not prove:** That SIR is doctrinally complete. It is not. The column additions, approval table, enum, RLS tightening, and typed contracts in PRs 2 and 3 are required before SIR can credibly enforce Governed Autonomy at runtime.

**Single directive:** No new orchestration tables outside SIR until this consolidation is complete.

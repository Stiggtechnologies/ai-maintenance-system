# Canonical Plane Ownership and Cross-Plane Handoff Spec

**Status:** Proposed, awaiting approval
**Date:** 2026-04-10
**Branch:** `claude/code-review-analysis-kEFhq`
**Supersedes:** `docs/CONTROL_PLANE_AUDIT.md` § "Decision" section (that doc recommended SIR as the single canonical substrate; this spec replaces that recommendation with a three-plane split. The audit's survey facts and defect findings remain valid.)

---

## 1. Decision

**Autonomous** = canonical Control/Governance Plane.
**OpenClaw** = canonical Intelligence Plane.
**SIR** = interaction/logging support only.

This remains the target despite current Autonomous defects documented in §5. Those defects are a readiness issue, not a substrate reversal.

No new orchestration substrate may be created without explicit architectural approval.

---

## 2. Why this mapping

- **Autonomous** already aligns best with decisions, actions, approvals, and operational UI wiring. It has `autonomous_decisions`, `autonomous_actions`, `approval_workflows`, plus triggers and RLS policies for approval gating. Its current consumers (`autonomous-orchestrator`, `AutonomousDashboard`, `ApprovalQueue`, `autonomousMonitoring.ts`, `dashboardServices.ts`, `TacticalDashboard`) are governance/operational UIs.

- **OpenClaw** is the richer agent/runtime/tool substrate. Post-rename its tables live under the `sir_*` prefix but logically represent agent definitions (`sir_agents`), tool registry (`sir_tools`), tool calls (`sir_tool_calls`), orchestration runs (`sir_orchestration_runs`), semantic memory (`sir_memory`), event scheduling (`sir_events`), skills (`sir_skills`), and runtime cost tracking. PR 2 already added `correlation_id`, `idempotency_key`, `autonomy_level`, and `confidence` to `sir_orchestration_runs`.

- **SIR** is thinner and best kept to session/transcript/logging support: `sir_sessions`, `sir_messages`, `sir_costs`. These are the tables `ai-agent-processor` currently writes to (silently failing due to the anon-key bug documented in PR 2). SIR should not own operational truth.

**Physical naming note:** The 20260405500000 rename migration moved all `openclaw_*` tables to `sir_*`. Logically, the Intelligence Plane tables are still "OpenClaw" — they just have a `sir_` prefix in the database today. This spec uses the logical names (OpenClaw, SIR) when discussing plane ownership and the physical names (`sir_orchestration_runs`, `autonomous_decisions`, etc.) when referencing actual tables.

---

## 3. Cross-plane ownership table

| Concern                                | Canonical Plane                     | Physical table(s)                                                                               |
| -------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Agent runtime / definitions            | OpenClaw (Intelligence)             | `sir_agents`                                                                                    |
| Tool registry                          | OpenClaw (Intelligence)             | `sir_tools`                                                                                     |
| Tool calls / execution trace           | OpenClaw (Intelligence)             | `sir_tool_calls`                                                                                |
| Orchestration run / intelligence trace | OpenClaw (Intelligence)             | `sir_orchestration_runs`                                                                        |
| Memory / context                       | OpenClaw (Intelligence)             | `sir_memory`                                                                                    |
| Skills / capability registry           | OpenClaw (Intelligence)             | `sir_skills`                                                                                    |
| Event scheduling                       | OpenClaw (Intelligence)             | `sir_events`, `sir_event_runs`                                                                  |
| Runtime cost telemetry                 | OpenClaw (Intelligence)             | `sir_costs` (shared with SIR for session-level cost)                                            |
| **Decision record**                    | **Autonomous (Control/Governance)** | `autonomous_decisions`                                                                          |
| **Approval workflow**                  | **Autonomous (Control/Governance)** | `approval_workflows`                                                                            |
| **Action record**                      | **Autonomous (Control/Governance)** | `autonomous_actions`                                                                            |
| **Execution state**                    | **Autonomous (Control/Governance)** | `autonomous_decisions.status` + `autonomous_actions`                                            |
| **Canonical audit**                    | **Autonomous (Control/Governance)** | `autonomous_decisions` + `autonomous_actions` (audit linkage via `correlation_id`, to be added) |
| **Asset health monitoring**            | **Autonomous (Control/Governance)** | `asset_health_monitoring`                                                                       |
| **System alerts**                      | **Autonomous (Control/Governance)** | `system_alerts`                                                                                 |
| Chat / session history                 | SIR (Interaction/Logging)           | `sir_sessions`                                                                                  |
| User-visible assistant transcript      | SIR (Interaction/Logging)           | `sir_messages`                                                                                  |
| Session-level cost logging             | SIR (Interaction/Logging)           | `sir_costs`                                                                                     |

---

## 4. Cross-plane handoff contract

Every record that participates in a governed workflow must carry or be linkable through these shared identifiers:

| Identifier                   | Meaning                                                              | Planes that use it                                                  |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `correlation_id` (uuid)      | Single id threading all records from one logical workflow invocation | All three                                                           |
| `tenant_id` (uuid)           | Organization id — maps to `organizations.id`                         | All three                                                           |
| `asset_id` (uuid)            | Target asset                                                         | OpenClaw input, Autonomous decision/action                          |
| `work_order_id` (uuid)       | Target work order                                                    | OpenClaw input, Autonomous decision/action                          |
| `decision_id` (uuid)         | `autonomous_decisions.id` — the canonical decision                   | Autonomous (primary), OpenClaw (reference via correlation_id)       |
| `action_id` (uuid)           | `autonomous_actions.id` — the canonical action                       | Autonomous                                                          |
| `approval_request_id` (uuid) | `approval_workflows.id` — the approval record                        | Autonomous                                                          |
| `agent_run_id` (uuid)        | `sir_orchestration_runs.id` — the intelligence trace                 | OpenClaw                                                            |
| `interaction_id` (uuid)      | `sir_sessions.id` — the user-facing session                          | SIR                                                                 |
| `autonomy_level` (enum)      | `advisory` / `conditional` / `controlled`                            | All three (set by Autonomous, passed to OpenClaw, displayed by SIR) |

Cross-plane references use `correlation_id` as a soft link — no foreign keys between planes. Each plane's tables reference only their own plane's tables via hard FKs.

---

## 5. Hard handoff rule

**No intelligence result may affect operational state until it is represented as an Autonomous decision/action and passes policy/approval.**

This means:

- OpenClaw may reason, recommend, and produce structured output.
- SIR may log the interaction.
- But neither OpenClaw nor SIR may write to `work_orders`, `assets`, or any operational system-of-record table.
- Only Autonomous, after recording a decision and evaluating policy/approval, may authorize downstream execution.

---

## 6. Must not own

| Plane          | Must not own                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| **SIR**        | Approvals, action truth, governance truth, policy truth, operational execution state |
| **OpenClaw**   | Approval truth, execution authority, final operational audit truth                   |
| **Autonomous** | Chat transcripts, agent memory, tool registry, intelligence runtime traces           |

---

## 7. OpenClaw customer-data access model

OpenClaw is permitted to access customer data only through governed, tenant-scoped, task-scoped interfaces approved by the Control/Governance Plane. It is not granted broad persistent access to customer data stores and is not a system of record for customer data.

**Allowed:** asset metadata, work order history, failure history, condition indicators, approved manuals/SOP snippets — when task-relevant and scoped to a single tenant + asset + work order.

**Not allowed:** unrestricted database access, cross-tenant visibility, blanket access to all customer records, direct writes to operational records, access to HR/personnel, billing, legal/commercial, or credential data.

**Implementation pattern (for PR 3):** Autonomous passes a minimal starter context (asset_id, work_order_id, tenant_id). OpenClaw receives that context and may call a small allowlist of tenant-safe read tools. Every tool call is logged in `sir_tool_calls` with `correlation_id`.

---

## 8. Confirmed blockers: Autonomous is not implementation-ready

Autonomous is the correct long-term Control/Governance Plane. It is currently runtime-broken and must be repaired before any vertical-slice work.

### Blocker A — Trigger dependency on dropped column

**Migration:** `20251021185821_create_autonomous_system_tables.sql` lines 325-349.
**Function:** `create_approval_workflow()` — trigger on `autonomous_decisions` AFTER INSERT.
**Problem:** Queries `SELECT id INTO manager_id FROM user_profiles WHERE role IN ('admin', 'manager') ORDER BY random() LIMIT 1`.
**Why it's broken:** `20260403044307_008_industrial_platform_merged_v2.sql` line 47 runs `DROP TABLE IF EXISTS user_profiles CASCADE` and recreates the table without a `role` column. The current `user_profiles` schema has: `id, organization_id, default_site_id, full_name, email, title, status, metadata, created_at, updated_at`. No `role`.
**Effect:** Any insert into `autonomous_decisions` with `requires_approval = true` triggers a function that queries a non-existent column. This is a runtime error. The approval workflow is never created.

### Blocker B — RLS dependency on dropped column

**Migration:** `20251021185821_create_autonomous_system_tables.sql` lines 209-224.
**Policy:** `"Managers can approve decisions"` on `autonomous_decisions` FOR UPDATE.
**Problem:** `USING (EXISTS (SELECT 1 FROM user_profiles WHERE user_profiles.id = auth.uid() AND user_profiles.role IN ('admin', 'manager')))`.
**Why it's broken:** Same as Blocker A — `user_profiles.role` does not exist after the v2 migration.
**Effect:** No authenticated user can update (approve/reject) an `autonomous_decisions` row. The policy evaluation fails at runtime.

### Blocker C — Zero tenant isolation on Autonomous

**Tables affected:** `autonomous_decisions`, `autonomous_actions`, `approval_workflows`, `asset_health_monitoring`, `system_alerts`.
**Problem:** None of these tables have a `tenant_id` or `organization_id` column. All SELECT RLS policies are `USING (true)` — every authenticated user can see every tenant's decisions, actions, and alerts.
**Effect:** Multi-tenant governance is impossible. A user in Tenant A can see and potentially approve decisions belonging to Tenant B.

### Blocker D — PR 2 created `sir_approval_requests` (doctrine violation)

**Migration:** `20260410000000_sir_control_plane_baseline.sql` (committed in PR 2 on this branch).
**Problem:** Created `sir_approval_requests` table and FK from `sir_tool_calls.approval_request_id`. Under the canonical ownership decision, Autonomous owns approval truth via `approval_workflows`. Having `sir_approval_requests` in the SIR/OpenClaw layer is a duplicate approval system.
**Fix:** PR 2.5 must drop `sir_approval_requests`, the FK constraint `sir_tool_calls_approval_request_id_fkey`, and the `sir_tool_calls.approval_request_id` column. Nothing in the codebase references them yet; this is a clean removal.

### Blocker E — `auto_approve_decisions` trigger has the same column dependency

**Migration:** `20251021185821_create_autonomous_system_tables.sql` lines 308-322.
**Function:** `auto_approve_decisions()` — trigger on `autonomous_decisions` BEFORE INSERT.
**Problem:** This trigger checks `NEW.confidence_score >= 90 AND NEW.requires_approval = false`. It does NOT reference `user_profiles.role` directly — it only reads columns on the NEW row. **This trigger is NOT broken.** Listed here for completeness because it was initially suspected. No fix needed.

### Summary

| Blocker                                              | Severity            | Blocks PR 3? | Fix in |
| ---------------------------------------------------- | ------------------- | ------------ | ------ |
| A: Trigger queries dropped `role` column             | Runtime error       | **Yes**      | PR 2.5 |
| B: RLS policy queries dropped `role` column          | Runtime error       | **Yes**      | PR 2.5 |
| C: No tenant isolation on Autonomous                 | Multi-tenant safety | **Yes**      | PR 2.5 |
| D: `sir_approval_requests` duplicate approval system | Doctrine violation  | **Yes**      | PR 2.5 |
| E: `auto_approve_decisions` trigger                  | Not broken          | No           | N/A    |

---

## 9. PR 2.5 — Autonomous readiness repair

**Scope:** Repair Autonomous so it can serve as the canonical Control/Governance Plane. No feature expansion, no new substrate, no UI work.

**One new migration file:** `supabase/migrations/20260410010000_autonomous_readiness_repair.sql`

### 9a. Repair trigger (Blocker A)

Replace `create_approval_workflow()` function body. Instead of querying `user_profiles.role`, query the repo's actual RBAC model:

```sql
SELECT ura.user_id INTO manager_id
FROM user_role_assignments ura
JOIN roles r ON r.id = ura.role_id
WHERE r.code IN ('maintenance_manager', 'plant_manager', 'operations_manager')
  AND ura.organization_id = NEW.tenant_id   -- requires Blocker C fix first
ORDER BY random()
LIMIT 1;
```

Role codes confirmed from `supabase/seed/001_core_seed_data.sql`: `maintenance_manager`, `plant_manager`, `operations_manager`, `reliability_engineer`, `maintenance_planner`, `maintenance_supervisor`.

The trigger also needs to propagate `tenant_id` and `correlation_id` from the decision to the workflow row. Extend the INSERT to include these columns (added by the tenant isolation fix below).

### 9b. Repair RLS (Blocker B)

Drop the broken policy and replace with one that uses `user_role_assignments`:

```sql
DROP POLICY IF EXISTS "Managers can approve decisions" ON autonomous_decisions;

CREATE POLICY "Managers can approve decisions"
  ON autonomous_decisions FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_role_assignments ura
      JOIN roles r ON r.id = ura.role_id
      WHERE ura.user_id = auth.uid()
        AND r.code IN ('maintenance_manager', 'plant_manager', 'operations_manager', 'admin')
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT organization_id FROM user_profiles WHERE id = auth.uid())
  );
```

Also replace all `USING (true)` SELECT policies on Autonomous tables with tenant-scoped versions:

```sql
-- Example pattern for autonomous_decisions:
DROP POLICY IF EXISTS "Users can view decisions" ON autonomous_decisions;
CREATE POLICY "Users can view decisions"
  ON autonomous_decisions FOR SELECT TO authenticated
  USING (tenant_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));
```

Same pattern for: `autonomous_actions`, `approval_workflows`, `asset_health_monitoring`, `system_alerts`.

### 9c. Add tenant isolation (Blocker C)

Add `tenant_id uuid` to every Autonomous table that lacks it:

```sql
ALTER TABLE autonomous_decisions  ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE autonomous_actions    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE approval_workflows    ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE asset_health_monitoring ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE system_alerts         ADD COLUMN IF NOT EXISTS tenant_id uuid;
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_tenant_status
  ON autonomous_decisions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_tenant
  ON autonomous_actions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_tenant_status
  ON approval_workflows (tenant_id, status);
```

Backfill: existing rows (from demo seed / autonomous-orchestrator runs) can be backfilled from `asset_health_monitoring.asset_id → assets.organization_id` where possible. Rows without a linkable asset keep `tenant_id = NULL`. New rows require `tenant_id` going forward (enforced at the Edge Function layer, not a NOT NULL constraint yet — that comes after the backfill is verified).

### 9d. Add cross-plane linkage columns (prerequisite for PR 3)

```sql
ALTER TABLE autonomous_decisions
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS asset_id uuid,
  ADD COLUMN IF NOT EXISTS work_order_id uuid,
  ADD COLUMN IF NOT EXISTS autonomy_level autonomy_level;

ALTER TABLE approval_workflows
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE autonomous_actions
  ADD COLUMN IF NOT EXISTS correlation_id uuid;
```

These are additive. No existing code references them. They will be populated by the PR 3 flow.

### 9e. Drop `sir_approval_requests` (Blocker D — PR 2 correction)

```sql
ALTER TABLE sir_tool_calls DROP CONSTRAINT IF EXISTS sir_tool_calls_approval_request_id_fkey;
ALTER TABLE sir_tool_calls DROP COLUMN IF EXISTS approval_request_id;
DROP TRIGGER IF EXISTS trg_sir_approval_requests_updated_at ON sir_approval_requests;
DROP FUNCTION IF EXISTS set_updated_at_sir_approval_requests();
DROP TABLE IF EXISTS sir_approval_requests;
```

### 9f. Tighten remaining Autonomous INSERT policies

Currently `autonomous_decisions`, `autonomous_actions`, `approval_workflows`, `asset_health_monitoring`, and `system_alerts` all have `FOR INSERT TO authenticated WITH CHECK (true)`. That lets any authenticated user insert decisions/actions directly from the frontend.

For doctrine alignment (writes via service-role edge functions only), drop these and leave no authenticated INSERT policy. Service-role bypasses RLS.

**Exception:** `approval_workflows` UPDATE must remain for authenticated managers (the repaired policy from §9b). And `system_alerts` UPDATE for acknowledgment should remain.

### Files touched by PR 2.5

| File                                                                 | Action                   |
| -------------------------------------------------------------------- | ------------------------ |
| `supabase/migrations/20260410010000_autonomous_readiness_repair.sql` | NEW — all schema repairs |
| No edge function changes                                             | —                        |
| No UI changes                                                        | —                        |
| No TypeScript changes                                                | —                        |

### Acceptance criteria for PR 2.5

1. Insert an `autonomous_decisions` row with `requires_approval = true` and `tenant_id` set → `approval_workflows` row is auto-created via the repaired trigger, routed to a user with role code `maintenance_manager` (or similar) in the same organization.
2. Authenticated user with `maintenance_manager` role can UPDATE `autonomous_decisions.status` to `approved` for their own tenant's decisions.
3. Authenticated user in a different tenant CANNOT see or update those decisions.
4. `sir_approval_requests` table no longer exists.
5. `sir_tool_calls.approval_request_id` column no longer exists.
6. All existing code paths (`autonomous-orchestrator`, `ApprovalQueue.tsx`, `AutonomousDashboard.tsx`) continue to function — the trigger repair is backwards-compatible because the trigger's external contract (insert a decision → get an approval_workflow row) is preserved.

---

## 10. PR 3 — cross-plane vertical slice (after repair)

Once PR 2.5 is approved and merged, PR 3 implements one end-to-end governed flow:

**`task_code = draft_reliability_assessment`**

1. **User initiates from WorkOrderDetailPage** — new "Draft Reliability Assessment" button.
2. **Frontend calls `ai-agent-processor`** (Intelligence Plane) with typed `DraftReliabilityAssessmentEnvelope` including `correlation_id`, `tenant_id`, `asset_id`, `work_order_id`, `autonomy_level = 'conditional'`.
3. **`ai-agent-processor`** (switched to service_role, with `LLM_BASE_URL` seam):
   - Writes `sir_orchestration_runs` row (OpenClaw intelligence trace) with `correlation_id`, `idempotency_key`, typed output, `confidence`, `autonomy_level`.
   - Writes `sir_sessions` + `sir_messages` (SIR interaction log) with `correlation_id`.
   - Writes `sir_costs` (SIR cost telemetry).
   - Returns structured `DraftReliabilityAssessmentResult` to the frontend.
   - **Does NOT write to Autonomous.** Remains Intelligence Plane only.
4. **Frontend calls `autonomous-orchestrator`** (new action: `create_intelligence_decision`) with `correlation_id`, typed result, `tenant_id`, `asset_id`, `work_order_id`, `autonomy_level`.
5. **`autonomous-orchestrator`** (already uses service_role):
   - Creates `autonomous_decisions` row with `decision_type = 'reliability_recommendation'`, `decision_data` = typed result, `confidence_score`, `requires_approval = true`, `tenant_id`, `correlation_id`, `asset_id`, `work_order_id`, `autonomy_level`.
   - Trigger creates `approval_workflows` row (routed via repaired RBAC trigger).
   - Returns `{ decision_id, approval_workflow_id, correlation_id }`.
6. **UI shows** structured recommendation card with confidence, risk level, "Pending Approval" status, and correlation ID.
7. **Failure path:** If `ai-agent-processor` returns an error (mock LLM 500), the frontend calls `autonomous-orchestrator` with `create_failed_decision`, which creates an `autonomous_decisions` row with `status = 'rejected'`, `decision_data` containing the error. Structured log line: `event=agent_invocation_failed agent=ai-agent-processor correlation_id=<uuid>`.

### PR 3 files

| File                                                  | Action                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/ai-agent-processor/index.ts`      | MODIFY — switch to service_role, add `LLM_BASE_URL` seam, accept typed envelope, write to OpenClaw + SIR only, return typed result |
| `supabase/functions/autonomous-orchestrator/index.ts` | MODIFY — add `create_intelligence_decision` action                                                                                 |
| `src/pages/WorkOrderDetailPage.tsx`                   | MODIFY — add "Draft Reliability Assessment" button + handler + recommendation card                                                 |
| `src/components/AgentErrorBoundary.tsx`               | NEW — targeted error boundary around agent invocation section                                                                      |
| `src/types/sir-contracts.ts`                          | MODIFY — add `AutonomousDecisionRef` type                                                                                          |

---

## 11. What we are not doing now

- Not making SIR the control plane.
- Not adding a new workflow substrate.
- Not duplicating approvals across planes.
- Not putting final audit truth in OpenClaw or SIR.
- Not giving OpenClaw broad/default customer data access.
- Not building UI features in PR 2.5.
- Not reversing the substrate decision — Autonomous remains the canonical Control/Governance target.

---

## 12. What this spec does NOT decide

- The final shape of workflow definitions (deferred — start with code/config, graduate to table only if needed).
- Policy evaluation engine design (deferred — start in Edge Function code).
- Whether `sir_orchestration_runs` / `sir_tool_calls` should eventually be renamed to `openclaw_*` for naming consistency (deferred — cosmetic, no urgency).
- How executive vs. operator UX splits (separate concern).
- Decommissioning Job Processor, Runbooks, or Governance-001 substrates (deferred — separate cleanup PRs after the vertical slice is green).
- Whether PR 3 should also include the Playwright E2E rail or whether that should be PR 4 (recommend keeping them separate).

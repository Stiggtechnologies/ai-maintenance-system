# Governed Planning & Scheduling agent — validation record

This slice closes the gap between the existing agent-control envelope and the
canonical job-plan workflow. It does not create a second planning store or give
an agent execution authority.

## Shipped behavior

- `run_planning_agent(work_order_id)` accepts one authenticated, same-tenant
  work order from a named planner, reliability engineer, maintenance manager or
  administrator.
- Both `draft_job_plans` / `draft_job_plan` and
  `identify_missing_materials_docs` / `read_work_context` must be enabled on the
  agent's adopted control profile. A missing binding, over-ceiling risk or
  mid-run profile change refuses the run.
- An attached plan or an existing work-order draft is assessed without being
  overwritten. Otherwise, the agent creates at most one `job_plans` draft.
- Exact content may be copied from a same-tenant adopted reference plan. When no
  reference exists, only recorded work-order tasks and catalogue-backed
  material demand are copied. Missing tasks, labour, tools, permits,
  isolations, documents and acceptance criteria are reported as gaps, never
  invented.
- Indexed tenant knowledge documents can be linked through
  `job_plan_documents`; foreign, unavailable or unindexed documents refuse the
  entire authoring save.
- The control profile, tool, decision right, requester, source snapshot, work
  order, plan and result are retained in the canonical `agent_runs` ledger.
- The result always states `may_adopt=false`, `may_apply=false` and
  `may_release_schedule=false`. Existing named-human adoption, plan application
  and schedule-release functions remain the only authoritative acts.
- The AI Workforce page shows the Planning & Scheduling agent's database-backed
  purpose, outputs, guardrails and routes. `/job-plans` exposes the execution
  control and opens the resulting draft in the existing human editor.

## Automated proof

- `src/test/planningAgentExecutionContract.test.ts` protects the canonical-store,
  control, refusal, reachability and register contracts.
- `src/services/jobPlanService.test.ts`, `src/components/JobPlans.test.tsx` and
  `src/pages/AIWorkforcePage.test.tsx` cover the caller, draft handoff,
  authority language, document authoring and visible operating charter.
- `scripts/ci-planning-agent-smoke.sh` runs against the clean local Supabase
  migration chain. It proves authenticated execution, exact task/material copy,
  gap reporting, one-draft idempotence, preservation of a human edit,
  same-tenant enforcement, immutable retained provenance, role refusal and no
  work-order/application authority.
- The migration was also applied inside a rolled-back transaction against the
  linked production schema before publication.

## Capability register closure

This evidence closes C1.04, C1.05, C5.02, C5.03 and C9.02. Scheduler option
generation, capacity leveling and named-human release/freeze controls were
already live; the database-backed combined agent charter closes C1.05 without
changing those authority boundaries.

# SyncAI Operating-Loop Demo (local Supabase)

End-to-end, Supabase-backed demo of the buyer-value loop:

> Mission Control → AI Recommendation → Evidence → Scenario Comparison → Human
> Approval → Work Action → Decision Logged → Value Realization → Learning Loop

## Hosted staging (cloud Supabase)

The repo is linked to the **SyncAI** cloud project (`pjvoswbwomesuwhygpby`,
Canada Central). Schema + demo data are applied as one deterministic migration
chain (`supabase db push` / `supabase db reset --linked`).

Point the app at it via `.env.local`:

```
VITE_SUPABASE_URL=https://pjvoswbwomesuwhygpby.supabase.co
VITE_SUPABASE_ANON_KEY=<from `supabase projects api-keys --project-ref pjvoswbwomesuwhygpby`>
VITE_ENVIRONMENT=staging
```

Same demo login. To restore pristine demo state: `supabase db reset --linked`.
The old Bolt-managed prod project serving app.syncai.ca is untouched.

## Prerequisites

- Docker running
- Supabase CLI (`brew install supabase/tap/supabase`)
- `npm install`

## Run it

```bash
supabase start            # boots local Postgres/Auth/REST and applies the baseline migration
supabase db reset         # applies the 4-migration chain (schema + demo data)
npm run dev               # Vite dev server → http://localhost:5173
```

`.env.local` already points the app at the local stack:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from `supabase status`>
```

If the anon key changes, refresh it: `supabase status -o env | grep ANON_KEY`.

## Demo login

| Email            | Password     | Role                 |
| ---------------- | ------------ | -------------------- |
| `demo@syncai.ca` | `Demo123!@#` | Reliability Engineer |

Org: **Fort McMurray Oil Sands Demo** · Site: Fort McMurray Site A.

## Definition-of-Done walkthrough

1. Log in → lands on **Mission Control** (real Mission Readiness score, factors,
   top risks, top recommendations, AI actions, pending approvals, value created).
2. Expand **"Reschedule PM on Conveyor C-22"** → review RACI + impact.
3. **Evidence** → drawer reads `evidence_items` (source system, type, description,
   confidence contribution, data quality, related asset, timestamp).
4. **Compare Scenarios** → reads `scenarios` (execute now / defer 7 / defer 14 /
   run to failure / replace / repair) with cost, downtime, safety, environmental,
   exposure, and readiness impact; recommended option highlighted.
5. **Approve** → in one transaction:
   - `recommendations.status → approved`
   - `decisions` row logged (human actor, rationale, autonomy mode)
   - `approvals` row resolved/created
   - `work_orders` row created — **safety-critical lands in `approval` state,
     never auto-executed**
   - `value_metrics` row added (risk exposure reduced, parsed from impact)
   - `learning_events` row added (`recommendation_accepted`)
6. See the change propagate: **Work Action Board** (new WO), **Decision
   Governance** (logged decision), **Value Realization** (new metric), **Learning
   Loop** (new event), and Mission Control readiness recomputes.

Other recommendation actions: **Challenge**, **Modify**, **Dismiss**, **Escalate**,
**Create Work Order** (each writes a decision/learning trail via
`setRecommendationStatus`).

## Cowork Studio

**New Workspace → "Create RCA for Pump P-101 with 5 seal failures in 9 months."**
creates a `cowork_workspaces` row, assigns agents, seeds `cowork_messages`,
generates an `artifacts` starter, and creates a recommended-action
`recommendations` row — all in Supabase.

## Architecture

- **Schema**: `supabase/migrations/00000000000001_operating_loop_baseline.sql`
  (24 core operating tables, org-scoped RLS via `app_current_org()`).
- **Seed**: `supabase/seed.sql` (oil-sands demo: 6 assets, 15 agents, recs,
  evidence, scenarios, work orders, decisions, value, learning, integrations,
  cowork).
- **Service**: `src/services/operatingLoopService.ts` (typed reads, the Mission
  Control aggregate, the transactional `approveRecommendation`, status changes,
  cowork generation). All reads throw on hard errors so the UI shows a real error
  state instead of silently empty data.
- **Hook**: `src/hooks/useAsyncData.ts` (loading / error / empty / refetch).
- **States**: `src/components/ui/AsyncStates.tsx`.

> The legacy 90-file migration chain (broken from migration 001) is archived under
> `supabase/_legacy_migrations/` and `supabase/_legacy_seed/`; the baseline above
> is the source of truth for local dev/demo. Promotion to a deployed environment
> should apply the baseline's genuinely-new tables additively.

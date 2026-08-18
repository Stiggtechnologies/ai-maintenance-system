# Corrected Information Architecture — Lifecycle-First

**Status:** Verified — two adversarial verification passes (citation-accuracy and practitioner); all nine required fixes applied in place.
**Date:** 2026-08-17
**Provenance:** workflow runs `wf_9e4015d7-1f8` (work-management-first draft) and `wf_4fba455e-6ec` (lifecycle-first correction and its verification).

This document supersedes the work-management-first draft produced by run `wf_9e4015d7-1f8`. That draft treated the weekly execution loop as the product's spine and hung strategy off it; the verified position of this document is the reverse — asset strategy is the parent of the maintenance programme (SAE JA1011 cl. 5.5.2 / 5.6.4), the execution loop is the innermost of four nested loops, and the navigation must read in that order. Nine fixes from the two verification lenses (four practitioner, five citation-accuracy — including ten corrected line anchors) are integrated in place below rather than appended.

All paths are relative to the repository root. Every claim below was re-verified against the repo in the correction run; three inherited claims did not survive and are corrected in §0.

---

## §0. Three inherited claims that do not survive verification

**0.1 — The owner's premise about Stage 1 is wrong, and correcting it is the point of this run.**
`grep -rniE "strategic asset management|\bsamp\b" src supabase/migrations docs scripts` → **0 matches**. The "68 files" was `sample`/`sampling`. `strategic asset` appears once repo-wide: `supabase/migrations/00000000000017_kpi_service.sql:84`, a KPI row seeded `computable=false` whose own `source_note` reads _"Strategy register — tag assets to strategic objectives."_ There is no SAMP, no AM policy object, no organizational-objectives table, no screen. **Stage 1 is absent, and the product's own KPI catalogue says so.** The IA fronts the process with Stages 2–7. It does not draw a Stage 1 screen.

**0.2 — The invention critique's defect I-4 is itself wrong; it read a dirty working tree.**
`git show HEAD:scripts/capture-role-tour.mjs:70` = `routes: ["/executive", "/value", "/performance"]`. The `/performance` entry **is** in the committed file. `src/App.tsx:431` routes `/performance` to `<Navigate to="/executive" replace />`. The prior design's claim — the executive tour screenshots the same page twice — was **correct**. The critique read the uncommitted working-tree edit (`git status`: ` M scripts/capture-role-tour.mjs`) which had already removed it. **No correction to the design is required here; the correction is to the critique.** I-1, I-2, I-3, I-5 and I-6 all stand and are applied below.

**0.3 — The nav totals in the brief, the prior design, and the practitioner critique are all wrong.**
`AppShell.tsx` holds **29 nav items in 6 groups**, not 31. Measured `NAV_ALLOW` sizes (`src/lib/roleNavigation.ts:40-111`): executive **15** ✓, maintenance_manager **25** (critique P-10 said 27), planner **13** (P-10 said 14), technician **6** ✓. Every count in §2 and §3 below is re-derived, not inherited, and §5 places both the matrix sizes **and** the tree sizes under test.

**One further finding neither the brief nor any critique reported:** `notifications` appears in **no** restricted role's allow-list. Executive, maintenance_manager, planner and technician cannot reach `/notifications` at all — only roles falling through to full nav (`admin`, `ai_admin`, `reliability_engineer`) can. Work identification is invisible to the four roles that perform it.

---

## §1. The corrected spine

The standards describe **four nested loops**, not one ribbon. The prior design's eight-item spine was the innermost loop only.

| Loop              | Content                                                                                                                          | Cadence            | Standard                    | This product                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------- | ----------------------------- |
| **L1 Governance** | objectives → policy → SAMP → AM objectives → performance evaluation → improvement                                                | annual             | ISO 55001:2024 cl. 4–10     | **ABSENT** (§0.1)             |
| **L2 Whole-life** | need → options → design → procure → commission → operate/maintain/modify → life extension → replace → dispose                    | decades, per asset | EN 16646:2014               | **BUILT, UNREACHABLE**        |
| **L3 Strategy**   | operating context → functions → functional failures → failure modes → effects → consequences → policy + interval → living review | per failure mode   | **SAE JA1011 cl. 5.1–5.10** | **PARTIAL, BURIED**           |
| **L4 Execution**  | identify → screen → plan → schedule → execute → close → analyse                                                                  | weekly/daily       | EN 17007, EN 15341          | **BUILT, IS THE CURRENT NAV** |

**Where "roughly step seven" lands precisely.** On this codebase's own seeded model (`supabase/migrations/20260816090000_lifecycle_stages.sql`), work identification sits at `stage_order = 81` of 93 — stage `maintenance`. The owner's structural correction is exactly right; only the Stage 1 premise fails.

**The two loops the navigation must express, and the edges joining them:**

```
L3 STRATEGY (reliability engineer owns)
  asset register/ontology → criticality → failure modes → consequence
    → failure-management policy → INTERVAL → PM PROGRAMME
                                                   │
                                    E3 ✗ SEVERED   │  work identification
                                        ▲          ▼
L4 EXECUTION (GM of Maintenance owns)   │   notifications → screening → planning
                                        │      → schedule → execute → close
                                        └──────────── E1 ✓ closeout attestation
```

**Three feedback edges, verified:**

| Edge                        | Path                                                                                                                        | Status         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **E1** execution → strategy | `ca_verifications.strategy_updated_at/_by/_note` (`00000000000026_ca_effectiveness_loop.sql:34-36`)                         | ✅ built       |
| **E2** operation → design   | `design_requirements.derived_from_failure_mode` + `get_design_feedback_loop()` (`20260818090000_reliability_by_design.sql`) | ✅ built       |
| **E3** analysis → programme | `IntervalOptimization` → `maintenance_plans`                                                                                | ❌ **SEVERED** |

**E3 is the defining gap.** `grep -nE "insert\|update\|\.rpc\(" src/components/IntervalOptimization.tsx` → **no matches**. It computes a Barlow–Proschan optimal replacement age from the customer's own `work_orders` and writes nothing. `grep -rn "maintenance_plans" src` → **one hit, a comment** (`src/components/MaintenancePlanImport.tsx:6`). There is no path in this product from _"the interval should be 4,200 h"_ to _"the PM programme says 4,200 h."_ The executive question the owner names — _how was this interval decided_ — is answerable on one screen and unconnected to the programme on another.

**Why strategy is the PARENT of the PM programme, not its sibling.** SAE JA1011 cl. **5.5.2** and cl. **5.6.4** both require consequence assessment and policy selection be performed _"as if no specific task is currently being done."_ That forbids deriving strategy from the existing programme. Causality is one-directional by mandate. The codebase already has the parent edge where it matters — `job_plans.applies_to_mechanism_id references damage_mechanisms(id)` (`20260811090000_job_plans.sql:42`) — and lacks it exactly where the interval lives: `maintenance_plans` has `source text` and no FK to a failure mode or strategy record (`20260903090000_maintenance_plans_dispatch_urgency.sql:39-57`), under a column comment reading _"An interval with no stated source is an assertion."_

**Where criticality sits.** At the **design gate** of L2, as an **input** to L3 — never derived from the backlog. This codebase already places it there: criticality assessment is a mandatory gate criterion of the `design` stage — the seeded `stage_gate_criteria` row _"Criticality and failure modes are assessed before procurement"_, `is_mandatory = true` (`20260816090000_lifecycle_stages.sql:~564`; it is also listed among the stage's `key_artifacts` at `:72-74`; register U4.04). Say **"recognised practice"** for A/B/C banding, not "standard": no ISO clause mandates a criticality matrix (ISO 55002 cl. 4.1.3 treats it as a context factor; ISO 14224 Annex F is informative and about _failures_).

---

## §2. The navigation tree, revised

**Groups follow the spine: what we own → what work should exist → the standing programme that strategy justifies → the whole-life frame → this week's work → performance.** Net: 29 → **37** sidebar items — **10 nav entries added** (`asset-ontology, asset-twins, intervals, lifecycle, lifecycle-decisions, job-plans, pm-programme, scheduling, materials, handover`), **2 removed** (`setup`, `artifacts`), **1 relocated** (`governance`, AI Workforce → Performance & Governance). Enumerated: 4 + 4 + 3 + 2 + 2 + 8 + 7 + 3 + 4 = **37**. Twin & Naming Coverage is an _added_ nav entry, not a relocation — today `AssetTwinCoverage` is a component inside `IntegrationsPage`, not a nav item; the earlier tally double-booked it as a removal, which is how 36 was mis-derived. Width is managed by role filtering (§3), not by hiding capability.

_Group order applied per the practitioner verification: Reliability Strategy (Group 3) sits directly above Maintenance Programme (Group 4), so the parent edge §1 argues for — strategy → programme — reads adjacently in the sidebar instead of around an unrelated group; Whole Life (Group 5) follows; Work Management (Group 6) is innermost. Within Group 3, Risk & Consequence precedes Interval Decisions, matching the JA1011 sequence this design cites: consequence evaluation (cl. 5.5) precedes policy and interval selection (cl. 5.6–5.7). An RE reading top-to-bottom now meets the consequence assessment before the interval it justifies._

### Group 1 — Mission (4, unchanged)

| Label              | Route                  | Status |
| ------------------ | ---------------------- | ------ |
| Mission Control    | `/mission-control`     | KEEP   |
| Command Centers    | `/command-centers`     | KEEP   |
| Readiness          | `/readiness`           | KEEP   |
| Decision Workspace | `/decision-cases/demo` | KEEP   |

### Group 2 — Asset Foundation _(L2 upstream — what we own)_ — 4

| Label                     | Route              | Status                                 | Wraps                                                                          |
| ------------------------- | ------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| Asset Register            | `/assets`          | RENAMED (from "Assets")                | `AssetManagement.tsx:59`                                                       |
| Class Profiles & Ontology | `/assets/ontology` | **NEW**                                | `AssetOntology` — today `AssetIntelligencePage.tsx:836`, no nav entry          |
| Twin & Naming Coverage    | `/assets/twins`    | **NEW** (not a relocation — see above) | `AssetTwinCoverage` — today `IntegrationsPage.tsx:318`, filed under **System** |
| Asset Onboarding          | `/onboarding`      | KEEP                                   |                                                                                |

### Group 3 — Reliability Strategy _(L3 — what work should exist)_ — 3

| Label                    | Route                    | Status                                                                           | Wraps                                                                                                                                                        |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Failure Modes & Strategy | `/reliability`           | RENAMED (from "Reliability")                                                     | keeps `ReliabilityAnalytics`, `ModellingStudio`, `ConditionMonitoring`, `FailureCoding`, `MonitoringCoverageGaps`, `CaEffectivenessPanel` + RCA/FMEA/PM tabs |
| Risk & Consequence       | `/risk`                  | KEEP _(ordered before Interval Decisions — JA1011 cl. 5.5 precedes cl. 5.6–5.7)_ |                                                                                                                                                              |
| Interval Decisions       | `/reliability/intervals` | **NEW**                                                                          | `IntervalOptimization` — today panel 4 of 8 at `ReliabilityPage.tsx:54`                                                                                      |

_Why Interval Decisions gets its own route:_ it is the single screen that answers the executive's question, it is the customer's own data with no fixture, and it refuses to return an interval when β ≤ 1. It is currently the fourth of eight stacked panels.

### Group 4 — Maintenance Programme _(the standing task library strategy justifies)_ — 2

| Label                    | Route           | Status    | Wraps                                                                                                              |
| ------------------------ | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Job Plans & Task Library | `/job-plans`    | **MOVED** | `JobPlans` — today on `/briefing` (`OperationalBriefing.tsx:733`)                                                  |
| PM Programme             | `/pm-programme` | **NEW**   | `MaintenancePlanImport` — today mounted **only** inside `if (overview.isEmpty)` (`AssetOnboardingHub.tsx:282,288`) |

_`/pm-programme` fixes severed loop 3._ The populated branch (`AssetOnboardingHub.tsx:625-627`) carries only `ScopingAnalysis` and `FleetHistoryImport` — the moment a tenant has one asset, the only in-product path to load a PM programme disappears, while `get_work_management_health` keeps telling them _"Load maintenance_plans to measure compliance"_ (`20260903090000:246`). The page's first line must state the second half of the truth: **the platform can load and count plans but has no view that lists them.** That is a stated gap, not a drawn screen.

### Group 5 — Whole Life _(L2 end-to-end)_ — 2 in sidebar

| Label                     | Route                  | Status                          | Wraps                                                                   |
| ------------------------- | ---------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Lifecycle Position        | `/lifecycle`           | **NEW**                         | `LifecycleStages` — today `AssetIntelligencePage.tsx:838`, no nav entry |
| Repair / Replace / Retire | `/lifecycle/decisions` | **MOVED**                       | `LifecycleDecisions` — today panel 5 of 8 at `ReliabilityPage.tsx:56`   |
| _Reliability by Design_   | `/design`              | **ROUTE ONLY — NOT IN SIDEBAR** | `ReliabilityByDesign`                                                   |

_`/design` is deliberately not a sidebar item._ `ReliabilityByDesign.tsx:73` hardcodes `get_ram_allocation({p_project_code:"DEMO-CP-01"})`, and `DEMO-CP-01` is defined only in `20260818093000_demo_project.sql:36` under an org guard whose header states the real operator org _"gets nothing."_ It renders permanently empty for every real tenant. This is the **P-7 defect class** and the rule is applied here rather than argued away: ship the route, link it from `/lifecycle` and the capability register, keep it out of five roles' menus until the project code is a parameter.

### Group 6 — Work Management _(L4 — the prior design's spine, correctly positioned as innermost)_ — 8

| Label                       | Route            | Status                          | Wraps                                                        |
| --------------------------- | ---------------- | ------------------------------- | ------------------------------------------------------------ |
| Notifications               | `/notifications` | KEEP _(unburied — see §3)_      |                                                              |
| Work Action Board           | `/work`          | KEEP                            |                                                              |
| Weekly Schedule & Crew      | `/scheduling`    | **NEW**                         | `SchedulerPanel` **+ `WorkforceReadiness`**                  |
| Materials & Spares          | `/materials`     | **NEW**                         | `MaterialsReadiness`, `SparesOptimization`, `SupplyExposure` |
| Release & Return to Service | `/handover`      | **NEW**                         | `OpsCoordination`                                            |
| Operational Briefing        | `/briefing`      | KEEP (name unchanged)           | four brief types only                                        |
| Playbooks                   | `/playbooks`     | KEEP                            |                                                              |
| Emergency Mode              | `/emergency`     | KEEP _(stays in Work)_          |                                                              |
| _Shutdowns & Turnarounds_   | `/turnarounds`   | **ROUTE ONLY — NOT IN SIDEBAR** | `OutagePlanning`                                             |

### Group 7 — Performance & Governance — 7

Executive Intelligence `/executive` KEEP · OEE Dashboard `/oee` KEEP · Value Realization `/value` KEEP · Benchmarking `/benchmarking` KEEP · Learning Loop `/learning-loop` KEEP · **Decision Governance `/governance` MOVED** (out of "AI Workforce" — it holds `decision_rights`, the ISO 55001 cl. 4.5 decision-making framework, the strongest upstream asset in the product) · Trust & Explainability `/trust` KEEP

### Group 8 — AI Workforce — 3

AI Agents `/ai-workforce` KEEP · Autonomy Maturity `/autonomy-maturity` KEEP · Approvals `/approvals` KEEP

### Group 9 — System — 4

Integrations `/integrations` KEEP · Integration Health `/integration-health` KEEP · Settings `/settings` KEEP · Security Audit Log `/security-log` KEEP (admin-only) · _Artifacts and Setup Wizard removed; Twin Coverage added to Group 2 (it was never a nav item here) — see below_

### Removals (2), relocations (1) — explicit

| Item                                   | Disposition                        | Why                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Setup Wizard** (`setup`)             | REMOVED                            | `/setup` is the unauthenticated route (`App.tsx:244`); the inner `AdminGate`'d `SetupWizard` route is shadowed by it and unreachable. **Corrected per I-6:** this does _not_ orphan `/deployments/new*` — `App.tsx:481-496` routes `/deployments` and `/deployments/new` to `TemplateSelectorPage` behind `AdminGate`, and those remain reachable by URL. |
| **Artifacts** (`artifacts`)            | REMOVED                            | `src/pages/ArtifactWorkspace.tsx:29` hardcodes `const artifacts` _(corrected from :28 per I-8)_.                                                                                                                                                                                                                                                          |
| **Decision Governance** (`governance`) | RELOCATED (AI Workforce → Group 7) | Not deleted; see Group 7.                                                                                                                                                                                                                                                                                                                                 |

**Twin & Naming Coverage is deliberately not in this table.** Today it is a component mounted inside `IntegrationsPage.tsx:318`, not a nav item, so its Group 2 row (`asset-twins`) is one of the 10 additions, not a relocation and not a removal. Counting it as a removal is what mis-derived the earlier 36.

### Where each load-bearing critique defect is resolved

| Defect                                   | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I-1** `accept_equipment_back` invented | The RPC is `accept_equipment(uuid,text)` (`20260812140000_ops_coordination.sql:156`, granted `:201`). The three-party loop is `release_equipment` (`:66`, gated operator/executive/admin/ai_admin at `:85`) → `return_equipment` (`:120`, **verified ungated** — maintenance returns) → `accept_equipment` (`:156`, same gate at `:171`). All three named on `/handover` — which all three parties can now reach (§3).                                               |
| **I-2** C5.15 misattributed to executive | Deleted. `00000000000024_decision_rights_matrix.sql:62` assigns `release_turnaround_scope` to **`maintenance_manager`** at `capability_absent`. No executive authority is claimed anywhere in this design.                                                                                                                                                                                                                                                           |
| **I-3** fabricated grep                  | Narrowed. `SMRP\|Palmer` genuinely return zero. **EN 13306 and EN 15341 are present** in `20260831140000_terotechnology_standards.sql`. The true and stronger statement: the product has a standards register with 33+ authorities and **zero UI callers** (verified: 0 hits for all six identifiers across `src scripts tests supabase/functions`).                                                                                                                 |
| **I-4** "invented defect"                | **The critique was wrong** (§0.2). No change.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **I-5** false remediation                | Three edits, not one: runbook credentials row; a `maintenance_manager` entry in `TOUR` (`capture-role-tour.mjs:47-79`, currently 4 entries); a `maintenance_manager` key in `ACCOUNT` (`:100-105`, currently 4 keys).                                                                                                                                                                                                                                                |
| **I-6** overstated orphaning             | Corrected above under Removals. Genuinely dead: `src/pages/OverviewDashboard.tsx` (never imported).                                                                                                                                                                                                                                                                                                                                                                  |
| **I-7/I-8/I-9/I-10**                     | Tally re-derived from source (§0.3). `ArtifactWorkspace.tsx:29`. `decide_lifecycle_evaluation` (`20260811170000:259`) is an **engineering-or-executive** gate admitting `reliability_engineer, executive, admin, ai_admin` — reflected in §3, where both roles get `/lifecycle/decisions`.                                                                                                                                                                           |
| **P-1** split through a continuous job   | **Applied.** `WorkforceReadiness` mounts on `/scheduling` beside `SchedulerPanel`. Its `get_craft_capacity_reconciliation` produces the derivation of the very `capacity_hours` figure `SchedulerPanel` levels against. No `/crew` route is created.                                                                                                                                                                                                                 |
| **P-2** false benefit claim              | Restated honestly: the plan→release loop goes from 2 navigations + a scroll up to **3**. Earned back by co-locating `WorkforceReadiness` with the scheduler (P-1), so both SOFT release constraints — material shortage and labour over-commitment — resolve without leaving `/scheduling` except for materials.                                                                                                                                                     |
| **P-3** rule applied unevenly            | **Applied uniformly, twice over.** Executive loses `approvals`, gains no `/scheduling` and no `/job-plans`. And the same uniformity now runs the other way: maintenance_manager and technician gain `/handover` because `return_equipment` is ungated to them (§3) — the first revision's omission of the returning party was this same defect class recurring.                                                                                                      |
| **P-4** vocabulary collision             | `/handover` is named **"Release & Return to Service"** for the transaction its RPCs perform. The word "handover" is left to the shift ritual, which `OperationalBriefing.tsx:662` already claims.                                                                                                                                                                                                                                                                    |
| **P-5** "Shift Briefing" regression      | `/briefing` keeps the name **"Operational Briefing."** It still renders four brief types (shift/daily/weekly/executive); the eight bolted-on panels were the defect, not the title.                                                                                                                                                                                                                                                                                  |
| **P-6** "Turnarounds" too narrow         | Labelled **"Shutdowns & Turnarounds"** (`OutagePlanning.tsx:67`), covering all four `outage_windows.kind` values including `opportunity`.                                                                                                                                                                                                                                                                                                                            |
| **P-7** permanently-empty sidebar item   | **Applied, and extended.** Verified: zero `insert into outage_windows` anywhere; `add_work_to_outage` has callers only at its own definition (`20260811130000:315,353`). `/turnarounds` is a route, not a sidebar item. The same rule removed `/design` from the sidebar — a case no critique caught.                                                                                                                                                                |
| **P-9** operator contradiction           | **Resolved:** operator does **not** get Work Action Board.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **P-10** counts don't reconcile          | Re-derived from `roleNavigation.ts`; §3 publishes **enumerated sets**, not add/lose prose; the §2 tree is enumerated to 37 with the delta stated honestly; and §5 enforces both the matrix sizes and the tree sizes in the existing test.                                                                                                                                                                                                                            |
| **P-11** RE silently loses surfaces      | **OEE and Integrations restored** to reliability_engineer, with a reason stated per removal.                                                                                                                                                                                                                                                                                                                                                                         |
| **P-12** GM problem widened              | maintenance_manager stays at **25** but the set is rebuilt — it loses the executive review surfaces and gains the work-management and strategy surfaces, including `/handover` so the returning party can see the acceptance limbo it creates.                                                                                                                                                                                                                       |
| **A-P6** named individuals               | `get_knowledge_risk` (`20260817090000:507-543`) returns `string_agg(display_name)`, rendered at `WorkforceReadiness.tsx:202`. The sibling table `human_performance_events` deliberately carries no worker reference (`:194-197`). **Decision: the named-holder column stays on `/scheduling`** — single-point-of-knowledge is a scheduling input and the schema author's refusal was about _error_ records, not competency. Stated explicitly rather than inherited. |

---

## §3. The role matrix, revised

> **This is menu visibility, not entitlement.** `grep -rn "RequireRole|RoleGuard|ProtectedRoute|allowedRoles" src` returns nothing. These lists shape what a role is _shown_. What a role may _do_ is decided by the RPC gates and RLS named in the right-hand column, and by nothing in this file. **Do not forward §3 as a security property.** _(A-P4 — moved from the end of the document to the head of the matrix.)_

**The rule, stated once and applied uniformly, on its own authority:** a nav item is granted to a role only if that role has at least one **ungated action** on the destination, or the item is explicitly designated read-only. One documented exception follows.

| Role                     | Items                          | Enumerated set                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **operator**             | **6** (NEW explicit set)       | `mission-control, assets, notifications, handover, emergency, settings`                                                                                                                                                                                                                                             |
| **technician**           | **8** (6 → 8)                  | `mission-control, work, notifications, handover, emergency, cowork, learning-loop, settings`                                                                                                                                                                                                                        |
| **planner**              | **17** (13 → 17)               | `mission-control, cowork, assets, onboarding, pm-programme, job-plans, reliability, notifications, work, scheduling, materials, briefing, playbooks, oee, learning-loop, integrations, settings`                                                                                                                    |
| **reliability_engineer** | **25** (was `null` = full nav) | `mission-control, command-centers, readiness, cowork, assets, asset-ontology, asset-twins, onboarding, reliability, intervals, risk, lifecycle, lifecycle-decisions, job-plans, pm-programme, notifications, work, briefing, approvals, governance, oee, learning-loop, integrations, integration-health, settings` |
| **maintenance_manager**  | **25** (25 → 25, set rebuilt)  | `mission-control, cowork, assets, onboarding, reliability, intervals, risk, lifecycle-decisions, job-plans, pm-programme, notifications, work, scheduling, materials, handover, briefing, playbooks, emergency, approvals, governance, oee, learning-loop, integrations, integration-health, settings`              |
| **executive**            | **18** (15 → 18)               | `mission-control, command-centers, readiness, executive, oee, value, benchmarking, trust, learning-loop, assets, reliability, intervals, lifecycle, lifecycle-decisions, risk, governance, handover, settings`                                                                                                      |
| **board**                | **DOES NOT EXIST**             | see below                                                                                                                                                                                                                                                                                                           |
| **admin / ai_admin**     | `null` (full nav)              | unchanged                                                                                                                                                                                                                                                                                                           |

**Justifications for the contested cells:**

- **operator is a strict reduction, not an addition.** `operator` is a real server-side role (`20260812140000:85,171`) with **no** `NAV_ALLOW` entry, so today it falls through `if (allow === null || allow === undefined) return true` and sees **all 29 items**. Giving it 6 removes 23. It gets `handover` because `release_equipment`/`accept_equipment` are gated _to_ it, and `notifications` because `raise_maintenance_notification` (`20260906090000:32-50`) is ungated. It does **not** get Work Action Board (**P-9**).
- **maintenance_manager and technician gain `handover`** — the practitioner verification's blocking finding, and the design's own rule applied to the page the rule was written for. `return_equipment` (`20260812140000:120-150`) carries **no role gate — deliberately**, because returning equipment is the _maintenance_ act in the three-party loop; the RPC's own return message calls the awaiting-acceptance limbo _"exactly the state worth making visible."_ The first revision granted `/handover` only to the two accepting parties (operator, executive) and locked out the department that creates the limbo state: a GM closing out a job could not see whether operations had accepted the machine back. Both roles qualify under the uniform rule via an ungated action, so this is **not** a second exception. Counts restated accordingly: technician 6 → **8**, maintenance_manager stays **25** with the set rebuilt.
- **technician → notifications is the one documented exception.** Three of four screening RPCs gate to planner/RE/mm/admin (`20260906090000:88,141,192`), but `raise_maintenance_notification` (`:32-50`) is ungated and raising is the technician's actual job. `NotificationScreening.tsx`'s `call` helper surfaces the RPC's own refusal sentence, so a technician who tries to screen gets a readable explanation rather than a silent failure. **This is materially unlike executive→approvals** (below) and the two must not be treated as one class.
- **executive loses `approvals`.** `app_role_has_approval_authority` (`00000000000022:22-35`) excludes `executive`; that predicate is the USING **and** WITH CHECK on `approvals`, `autonomous_decisions` and `approval_workflows` (`00000000000023:19-28,71-94`). Worse than a silent denial: `ApprovalQueue.handleApprove` (`src/components/ApprovalQueue.tsx:73-105`) had **no error check, no `.select()`, no row-count check** and called `broadcast_to_channel` with `decision_approved` unconditionally — verified. A zero-row RLS rejection would broadcast success **to the entire org**. The item is removed; the bug is fixed in §5 Step 1 (now implemented).
- **executive loses `/scheduling` and `/job-plans`** (**P-3**). `release_schedule_option` gates to `planner, maintenance_manager, admin, ai_admin` (`20260806190000:176`; `20260811130000:263`), and `SchedulerPanel.tsx:78-83` hardcodes the same client-side. `upsert_job_plan`/`adopt_job_plan` gate to `planner, reliability_engineer, maintenance_manager, admin, ai_admin` (`20260811090000:174,263`). Executives get schedule _compliance_, which already lives on `/executive` and `/oee`.
- **executive gains `intervals`, `lifecycle`, `lifecycle-decisions`, `handover`.** This is the owner's argument made navigable: the executive reaches _how an interval was decided_ in one click. `decide_lifecycle_evaluation` admits `executive` (`20260811170000:259`) and `release_equipment`/`accept_equipment` admit `executive` (`20260812140000:85,171`) — every one of these is a gate the server already opens to the role.
- **planner loses `value` — stated with a reason, not dropped silently.** Value Realization is in today's planner set (`roleNavigation.ts:95-108`) and absent from the new 17. Reason: `/value` is a programme-benefits review surface on which the planner has no action, and the planner's own performance measures — planning accuracy and schedule compliance — remain reachable on `/oee` and `/briefing`, both retained. The per-removal-reason discipline applied to reliability_engineer and maintenance_manager applies here too.
- **reliability_engineer narrows from full nav to 25.** Strict reduction. Removals with reasons: `scheduling` and `handover` are server-denied; `emergency`, `playbooks`, `materials` are execution surfaces the role does not run; `value`, `benchmarking`, `trust`, `executive` are the executive's review surfaces; `ai-workforce`, `autonomy-maturity`, `artifacts` are unrelated. **`oee` and `integrations` are restored** (**P-11**) — OEE availability/performance loss is the RE's primary input and the RE owns the condition-monitoring feeds Integrations administers.
- **maintenance_manager stays at 25, set rebuilt** (**P-12** + handover fix). Loses 8 (`command-centers, readiness, ai-workforce, autonomy-maturity, executive, value, benchmarking, trust`), gains 8 (`intervals, lifecycle-decisions, job-plans, pm-programme, notifications, scheduling, materials, handover`). It keeps `lifecycle-decisions` because `repair_vs_replace` is enforced to `maintenance_manager` (C5.13) and `scheduling` because `release_schedule_option` names it. **State the consequence plainly:** until a `supervisor` role exists in code, `maintenance_manager` carries both the department-head and the crew-assignment job — `src/lib/rolePersonas.ts:33-46` frames it as _"What should my crews focus on today?"_ while the register treats it as an approval authority. That is a named gap, not an invented role.

**Roles the code does not have — named, not invented:**

- **`board`** — no `NAV_ALLOW` entry, no `authority_limits` tier usable as a nav role. Two server filters actively exclude it: `board_packs_read` (`20260808210000:311-318`) gates to `('executive','admin','ai_admin')`, and the four Board-accountable KPIs carry `audience = array['executive','admin','ai_admin']` (`00000000000017:82-89`) — three of which are `computable=false` anyway. **A `board` role today would see fewer KPIs than an executive and an empty board pack.** Adding it to those arrays is an authorization change, not nav wiring. **Decision: do not ship a board role.**
- **`supervisor`, `scheduler`, `asset_manager`** — `asset_manager` appears once repo-wide, as a free-text `owner` string on one governance standard (`20260809140000:188`). No role key, no tier, no gate. **Do not invent.**

**Unknown-role default:** change the fall-through at `roleNavigation.ts:121` from full nav to a minimal read set. Today an unrecognised role string is handed all 29 items.

**Policy-count contradiction resolved** (the two critiques disagreed): **213** `create policy` statements across the migrations — confirmed. **2** reference `user_profiles.role` directly (`security_events_admin_read` `00000000000018:33`; `board_packs_read` `20260808210000:311`) and **3 more** resolve the same column through `app_has_approval_authority()` (`approvals_authority_update`, `autonomous_decisions_authority_update`, `approval_workflows_authority_update` — `00000000000023:76,91`). The authorization lens was right; the invention lens's "none" was an over-generalisation.

---

## §4. What is upstream and missing

The honest gap list. **No screen is drawn for any of these.**

**Absent entirely — no table, no route, no component:**

1. **SAMP** (ISO 55001:2024 cl. **6.2.1**, mandatory `shall`, new in the 2nd edition). Zero. The single most load-bearing artifact in the standard.
2. **AM policy object** (cl. **5.2**). Zero.
3. **Organizational objectives / mission-outcome model** (cl. 4.1, 4.2). Register `U1.01` ❌.
4. **Objective→asset linkage** (cl. 6.2.2). `strategic_asset_alignment` is `computable=false`; its own note names the missing input.
5. **AM maturity assessment.** `U22.01` ❌ — so `am_maturity_index` has no source.
6. **Portfolio optimisation across capital categories.** `U11.01` ❌.
7. **Asset hierarchy / functional location.** `grep -rn "parent_asset_id|parent_id|functional_location|asset_hierarchy" supabase/migrations` → **one hit**, a text column on `component_life_events` (`20260830090000:49`). The legacy `asset_hierarchy(parent_asset_id, child_asset_id)` table was dropped in the baseline consolidation. **The only hierarchy display in the product is a 7-row hardcoded fixture** (`AssetIntelligencePage.tsx:180-188`, rendered `:792-800`). Register **U3.17 should read ❌, not 🟡**, and **C2.01 is overstated** — it claims "hierarchy, functional locations."
8. **RCM decision logic.** No seven-question workflow, no applicable-and-effective test, no default-action branch. `onboarding_fmea_library` (`00000000000011:189-206`) is a **class-pattern regex lookup**, not FMEA. Maintenance-strategy assignment is a **five-branch CASE** on sensor count and the flat criticality string (`:672-679`) writing a text label into a checklist item — not onto the asset. Register `C7.09` 🟡, correctly.

**Built but broken — no navigation change fixes these:**

9. **Scored criticality persistence.** `src/pages/AssetDetailPage.tsx:57` and `src/services/syncaiDataService.ts:77,87` query **`asset_criticality_profiles`**, which appears **0 times** in `supabase/migrations/` — it exists only in `supabase/_legacy_migrations/002_assets_core.sql:72-88`. Every asset in every tenant renders _"No criticality assessment available"_ permanently. The live schema has one free-text column, `assets.criticality text default 'medium'`, with **no CHECK, no basis, no assessor, no date** (`00000000000001:80`). And the provenance derive rule named `criticality_from_history` (`20260814090000:479`) derives nothing from history — it echoes the column back to itself. **Criticality is severed at both ends while still weighting the scheduler** (`20260806190000:116`). **No nav item is created for criticality assessment** — but the broken _read_ is wiring, not capability, and is scheduled as §5 Step 2.
10. **Stage-gate passage.** `advance_lifecycle_stage()` (`20260816090000:431`) has **zero callers** — verified. `stage_gate_reviews` and `disposal_records` are SELECT-only RLS. **No asset can pass a gate, be replaced, decommissioned or disposed of through this product.**
11. **PM-programme provenance.** `maintenance_plans` has no parent link to a failure mode, mechanism or strategy record — the E3 gap, and the reason JA1011 cl. 5.10.1 ("formulae shall be robust and owner-approved") cannot be satisfied.
12. **Outage creation.** Nothing anywhere creates an `outage_window`.
13. **Reliability-by-design writes.** All seven tables are SELECT-only with no writer RPC. Design decisions can arrive only by migration.
14. **The standards register has no UI.** 33+ authorities including ISO 55001, ISO 14224, SAE JA1011, EN 13306, EN 15341 — each with edition, access status and review interval, plus three RPCs (`get_standards_watch`, `record_standards_review`, `get_terotechnology_coverage`). **Zero callers across `src`, `scripts`, `tests`, `supabase/functions`** — verified. This is the closest thing the codebase has to an asset-management-policy basis and nothing renders it.

**Documentation that is not true of the deployed system — higher priority than any nav change:**

15. **`ISO-55000-IMPLEMENTATION-SUMMARY.md`** at the repo root declares "IMPLEMENTATION COMPLETE" for a schema the deployed system does not run. Precisely: **five of the seven tables** it describes (`organizational_levels`, `organizational_units`, `kpi_categories`, `performance_targets`, `performance_dashboards`) **and all three functions exist only in `supabase/_legacy_migrations/`**; the other three tables — `kpis_kois`, `kpi_measurements` and `user_kpi_dashboard` — **survive as legacy-compat shims** in `supabase/migrations/00000000000002_legacy_compat.sql` that the dead dashboards still query (`StrategicDashboard.tsx:43` → `kpis_kois`; `ExecutiveDashboard.tsx:66` → `user_kpi_dashboard`); and of the four dashboard components it claims, **`OperationalDashboard.tsx` does not exist at all** while the other three are mounted nowhere. This is a **stronger** indictment of the summary than "legacy-only", not a weaker one: it describes a system that is part-deleted, part-shimmed, and entirely unmounted. For a product whose differentiator is refusing to state what it cannot source, a root-level ISO 55000 completion claim of this kind is the most damaging artifact in the repository.
16. `src/components/StrategicDashboard.tsx` (331 lines) and `src/components/ExecutiveDashboard.tsx` (377 lines) are never imported — dead files querying the legacy-compat shims (`kpis_kois` and `user_kpi_dashboard` respectively).
17. `schema-snapshots/schema-latest.md` is dated 2026-03-22 and its `assets` table does not match the current baseline.

---

## §5. Sequencing

Ordered so nothing is half-migrated. **Steps 0–1 are security and had to land before the matrix ships — and they have:** both are implemented on branch `agent/lockdown-user-profiles` (migration `20260910090000_lockdown_user_profiles.sql`, plus the `ApprovalQueue.tsx` fix and its tests). They are kept below for the record. **The outstanding sequence therefore starts at Step 2.** Steps 2–6 are pure wiring (Step 2 is code-only). Steps 7–8 need a demo account or customer decisions.

**Step 0 — Lock down `user_profiles` self-update. SCHEMA. ✅ IMPLEMENTED (`agent/lockdown-user-profiles`, migration `20260910090000`).**
Verified before the fix: `user_profiles_self_update` (`00000000000001:506-508`) was `for update to authenticated using (id = auth.uid()) with check (id = auth.uid())` — **no column restriction**. No later migration narrowed it; the app itself PATCHes the table client-side (`OnboardingWizard.tsx:119`), proving the PostgREST write path was open. Any authenticated user could rewrite their own `role` **and `organization_id`**. `app_current_org()` is `select organization_id from user_profiles where id = auth.uid()` (`:462-470`) and appears in ~458 places — **the tenant hop was total and silent.** The audit trigger was `after update of role` only (`00000000000018:104`), so an `organization_id` rewrite fired nothing. The role hop self-laundered: `security_events_admin_read` gates on `user_profiles.role`, so the attacker who wrote `{"role":"admin"}` became the only person who could read the event they generated. The implemented migration does the two things this design required: (a) a BEFORE UPDATE trigger pinning `NEW.role := OLD.role` and `NEW.organization_id := OLD.organization_id` for non-service callers — _a column-restricted policy is not expressible in RLS, so the trigger is the mechanism_; (b) the audit trigger widened to `after update of role, organization_id`. **Every gate this design relies on was self-selectable until this landed.**

**Step 1 — Fix the approval broadcast. CODE, no schema. ✅ IMPLEMENTED (same branch).**
The `broadcast_to_channel` call is moved inside a success branch in `src/components/ApprovalQueue.tsx:99-105`, with an error check in `handleApprove`. Before the fix, a zero-row RLS rejection reported `decision_approved` to the whole org.

**Step 2 — Repoint the criticality read. CODE, no schema. THE OUTSTANDING SEQUENCE STARTS HERE.**
`src/pages/AssetDetailPage.tsx:57` and `src/services/syncaiDataService.ts:77,87` query `asset_criticality_profiles`, a table that exists only in `supabase/_legacy_migrations/002_assets_core.sql:72-88` — so every asset detail page in every tenant renders _"No criticality assessment available"_ forever, while `assets.criticality` still weights the scheduler (`20260806190000:115-116`). Repoint both reads at the live `assets.criticality` column **with its basis-free status stated on screen** (free text, `default 'medium'`, no CHECK, no basis, no assessor, no date — `00000000000001:80`), **or delete the dead panel**. This is wiring, not new capability — the same defect class as Step 1's broadcast fix, and it was unscheduled in the first revision. A lifecycle-first IA whose stage-2 keystone renders a permanent apology on every asset page has started at strategy in the sidebar but not on screen.

**Step 3 — Split `AssetIntelligencePage` and delete the conveyor. PURE WIRING + DELETION.**
This is the highest-leverage wiring step in the design and it is independently shippable. `src/pages/AssetIntelligencePage.tsx` is ~830 lines of fabricated Conveyor C-22 fixture (`:22 assetData`, `:42 sensorSignals`, `:109 failureModes`, `:147 maintenanceHistory`, `:180 hierarchy`) with three **real, org-scoped, honestly-labelled** components bolted underneath at `:836,838,840`. Give `AssetOntology` → `/assets/ontology`, `LifecycleStages` → `/lifecycle`, `ReliabilityByDesign` → `/design`. Delete the fixture and the route `/assets/intelligence` (`App.tsx:402` — its only reference in the entire `src` tree). **No nav item may point at the fixture**, which is why this precedes Step 4.

**Step 4 — Unbury the PM importer and Notifications. PURE WIRING.**
Move `<MaintenancePlanImport />` out of the `if (overview.isEmpty)` branch (`AssetOnboardingHub.tsx:282-288`) onto `/pm-programme`. Add `notifications` to the operator, technician, planner, maintenance_manager sets — it is currently in no restricted role's list at all.

**Step 5 — Break up `/briefing` and `/reliability`. PURE WIRING.**
Eight panels off `/briefing` (`OperationalBriefing.tsx:725-739`) to `/scheduling` (SchedulerPanel **+ WorkforceReadiness**, per P-1), `/materials`, `/handover`, `/turnarounds`, `/job-plans`. Two panels off `/reliability` (`:54,:56`) to `/reliability/intervals` and `/lifecycle/decisions`. Move `AssetTwinCoverage` off `/integrations` (`IntegrationsPage.tsx:318`) to `/assets/twins`. **No component is modified — only remounted.**

**Step 6 — Ship the tree and the matrix. PURE WIRING.**
Rewrite `navGroups` (`AppShell.tsx:73-178`) and `NAV_ALLOW` (`roleNavigation.ts:40-111`) together, including the explicit `operator` set and the minimal unknown-role default. Extend `src/lib/roleNavigation.test.ts` (which already reads all four sources — `AppShell.tsx`, `roleNavigation.ts`, `CommandSearch.tsx`, `App.tsx` — as text) with: (a) a snapshot of `NAV_ALLOW` set **sizes** so §3's counts cannot drift again, **and** a snapshot of the `navGroups` sidebar total (37) and per-group sizes (4/4/3/2/2/8/7/3/4) so §2's count — the number that drifted twice — is under the same test; (b) every allow-listed id exists in `AppShell`; (c) **an explicit exception list** rather than an absolute — `technician → notifications` is the sole entry, with its justification (`raise_maintenance_notification` ungated at `20260906090000:32-50`); (d) every nav item whose page issues a server-denied write surfaces the refusal.

**Step 7 — Role tour. NEEDS A DEMO ACCOUNT.**
Three edits, not one (**I-5**): a `manager@syncai.ca` row in the runbook credentials table; a `maintenance_manager` entry in `TOUR` (`capture-role-tour.mjs:47-79`); a `maintenance_manager` key in `ACCOUNT` (`:100-105`). Separately, `/performance` redirects to `/executive` (`App.tsx:431`) — the committed executive tour shoots the same page twice; the working tree already fixes this, so **commit that change rather than re-deriving it**.

**Step 8 — Customer decisions. NOT ENGINEERING.**
Unpin `DEMO-CP-01` from `ReliabilityByDesign.tsx:73` before `/design` enters any sidebar. Decide whether `board` becomes a real role (that means editing `board_packs_read` and the KPI `audience` arrays — an authorization change). **Do not seed an `operator` row in `authority_limits`**: every existing row (`20260808210000:129-141`) carries a `basis` string saying the amount is a placeholder pending the customer's delegation instrument, and inventing a seventh placeholder is the fiction this design exists to refuse. If one is added, it must be `max_commitment_usd = 0`, `escalates_to_role = 'maintenance_manager'`, with a basis saying operations holds no maintenance spend authority.

**Not in scope, deliberately:** correcting `ISO-55000-IMPLEMENTATION-SUMMARY.md` (§4.15) is more urgent than this entire IA, and belongs in its own change. `20260909090000_ops_coordination_asset_id.sql` post-dates and redefines `get_ops_coordination()`; the `:85`/`:171` role gates are unchanged — verified.

---

## Suncor process-map overlay (2026-08-17)

Recorded as an overlay of the Suncor maintenance-process map onto this design and onto the 399-row capability register (`docs/enterprise-readiness/capability-register.md`). These are observations of correspondence and absence; no capability is claimed or invented.

- **The missing L1 is the Suncor Asset CFT management layer.** What §0.1 and §1 record as an absent governance loop corresponds, on the Suncor map, to the Asset CFT management layer: the LRP, the work-order budget, and stewardship reporting. None of the three has a table, route or component in this codebase.
- **The `maintenance_plans` provenance-FK gap is the ESDS.** The missing parent link from a maintenance plan to the strategy record that justifies it (§1 E3, §4.11) is, in Suncor terms, the absence of the ESDS — the artifact whose function is precisely to be that link.
- **Strategy revision should exit through MOC.** When a strategy or interval is revised (the E1 loop closing, or a future E3), the change should leave through management of change. The register's only MOC anchor today is barrier-integrity E2.11; there is no general MOC exit for strategy revisions.
- **Absent from the 399-row register entirely:** the CFT as an approval unit; Work Selection's three-way routing; Event Planning; reverse logistics; and the Technical History vs Work History distinction. None of these appears as a row, a status, or a named gap.
- **The register lacks a process-stage / owning-role axis — and that is the root cause of the filing-cabinet navigation.** Rows are keyed by capability, not by where in the process a capability sits or which role owns it. With no process-stage dimension in the program of record, the sidebar had nothing to follow but component boundaries; this document supplies the missing axis for navigation, and the register should eventually carry it too.

---

## Owner decision record — §5 Step 8 items resolved (2026-08-17, branch `agent/org-layer-roles`)

Three of the customer decisions this document deliberately left open were made
by the owner and implemented. Each entry names the section it executes or
supersedes; nothing above this line is edited, because the sections above are
a verified point-in-time record.

1. **`supervisor` exists** (supersedes the §3 statement "until a `supervisor`
   role exists in code, `maintenance_manager` carries both … jobs" — the gap
   is closed as named, not argued away). The role gets the frontline set only
   — `mission-control, work, notifications, scheduling, handover, emergency,
briefing, settings` (8) — under this document's own rule: work orders are
   org-scoped ungated writes; `raise_maintenance_notification` and
   `return_equipment` are ungated; **scheduling is a documented read-only
   grant** (`release_schedule_option` excludes the role and `SchedulerPanel`
   both hides the release act and surfaces the server refusal). It receives
   **no approval authority and no decision-rights rows** —
   `app_role_has_approval_authority` (migration 22) and the decision-rights
   seed (migration 24) are untouched, and `roleNavigation.test.ts` now pins
   both facts. `supervisor → notifications` joins `technician →
notifications` as the second entry in the documented-exception list with
   identical evidence. Demo persona `supervisor@syncai.ca` seeded
   (20260912093000) so the runbook credentials row is true.

2. **`board` is a real role** (supersedes §3's "Decision: do not ship a board
   role", which the owner overrode by approving exactly the authorization
   change that section said shipping would require). Migration
   `20260912090000` makes the two named edits and no others: the four
   Board-accountable KPI `audience` arrays (00000000000017:82-89) and
   `board_packs_read` (20260808210000:311-318) now admit `'board'`. The nav
   set is the read-only executive-review surface — `mission-control,
executive, value, benchmarking, trust, settings` (6). The §3 warning that
   a board role would meet mostly-empty KPIs is carried to the screen rather
   than fixed by fiction: three of the four Board KPIs remain
   `computable=false`, and `/executive` now states that count in words
   (Awaiting source), derived from the rows.

3. **`DEMO-CP-01` is unpinned** (executes §5 Step 8's precondition for
   `/design`). `ReliabilityByDesign` enumerates the org's own
   `capital_projects` (org-scoped RLS `capproj_read`), selects among them,
   and renders a stated empty state when there are none — so the P-7
   disqualifier no longer applies and `/design` joins the Whole Life group
   for the roles with read access (`reliability_engineer`, `executive`,
   admin roles). Tree count: 37 → **38** (4/4/3/2/**3**/8/7/3/4), snapshotted
   in `roleNavigation.test.ts`. `/turnarounds` remains route-only — nothing
   creates an `outage_window`, so its P-7 condition still holds.

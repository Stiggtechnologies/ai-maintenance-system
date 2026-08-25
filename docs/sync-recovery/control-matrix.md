# Sync Recovery — control and maturity matrix

**2026-08-24 — UPDATED FOR THE CONTROL / OPTIMIZE / LEARN CLOSE-OUT.** The
close-out work adds governed database contracts for most of the first-order gaps
below. It does **not** close the 30 Clarence controls end to end, and this
document must not be read as saying it does:

- **No product surface reaches any of it.** All 39 close-out functions are
  database-only. Verified twice, by different methods — a name grep across
  `src/` and a string-literal extraction across `src/services`, `src/pages`,
  `src/components`, `src/lib` and `src/hooks` (control: `open_restoration_event`
  is found by both). The only file in `src/` that names them is
  `src/test/syncRecoveryFullCloseout.test.ts`, which matches them as strings.
- **The external feeds are unbound.** Weather, vendor, mine-plan production and
  OEM signals have an ingestion contract and a freshness gate; nothing writes to
  them. Readiness therefore reports `unknown` in production, which is the
  intended fail-closed behaviour, not a working feed.
- **`Recovery close-out runtime acceptance` proves the contracts execute**, not
  that the controls are delivered. It applies the full migration chain and runs
  both Recovery smokes against a real Postgres.

Status legend: **Implemented** = executable and reachable in the product;
**Reused** = canonical Sync capability invoked rather than duplicated;
**Contract shipped, unreachable** = governed DB contract exists and is proven by
CI, but no surface calls it; **Partial** = useful production foundation exists
but an identified integration/automation remains; **Deferred** = intentionally
not represented as production capability yet.

This document is a non-overclaiming map from the Sync Recovery / Event Orchestrator product definition to the shipped vertical slice. It does not replace the enterprise capability register.

## Architectural invariants

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Downtime event is the coordination object, not a replacement work-order store | Implemented | `restoration_events` + `restoration_event_work` reference canonical `work_orders`; no duplicate WO store. |
| One governed integrated plan per version | Implemented | `restoration_plan_versions`; released snapshots are immutable and revisions supersede rather than rewrite evidence. |
| AI does not own schedule mathematics, critical path, constraints, economics, authority or safety | Implemented | Plan generation and control gates are deterministic SQL/RPCs. The product surface renders server results rather than scheduling in the browser. |
| Unknown concurrency fails closed | Implemented | New event work is `unknown`; deterministic scheduling treats it as sequential until an authorized human records a named parallel group and substantive basis. |
| No invented duration | Implemented | Comparable-history P50/P80 requires >=5 completed jobs with the same job plan; otherwise explicit planned/estimated hours are used; otherwise duration stays missing and approval is blocked. |
| Baseline cannot be rewritten after seeing the outcome | Implemented | Counterfactual baseline freezes at first plan generation. |
| Human approval before executable release | Reused | Recovery submits a canonical `autonomous_decisions` record plus `approval_workflows`; generator and approver must differ before release. |
| Permit/isolation truth remains canonical | Reused | Start rechecks job-plan permit demand against canonical `equipment_releases`; generic Recovery constraints cannot self-clear permit/isolation/asset-state truth. |
| Material readiness remains canonical | Reused | Start refuses when canonical `work_order_materials` is `requested`/`short`. |
| Quality/acceptance evidence gates completion | Reused | Exact canonical `job_plan_checks` IDs and acceptance criteria are surfaced; all checks require explicit PASS evidence before work completion. |
| Operations handback gates event closure | Reused | Event close refuses while a canonical equipment release is still `released` or `returned`; Operations must accept it. |
| Claimed value is not silently promoted to verified | Implemented + Reused | Recovery writes only `projected` counterfactual hours/value; existing Value Verification remains the authority that can verify value. |
| Degraded connectivity cannot create shadow operational truth | Implemented | Browser cache is read-only; writes are disabled and no offline operational write queue is created. |

## Product surfaces

| Surface | Status | Shipped behavior |
| --- | --- | --- |
| Fleet Down Board | Implemented | Active restoration events plus currently-down assets without an event; planned/major/opportunity event intake uses canonical assets. |
| Event Workspace | Implemented | Integrated event scope, candidate WOs, sequencing, human concurrency verification, counterfactual baseline and explicit constraint register. |
| Integrated Timeline | Implemented | Server-generated immutable stages, serial scope, critical path, P80 where supported, CWR, warnings/missing inputs, canonical approval and release. |
| Opportunity Work | Implemented / Reused | Recovery calls canonical `find_opportunity_work`; it shows fits, does-not-fit and unsized rather than hiding insufficient duration evidence. |
| Live Execution | Implemented | Controlled start, completion evidence, governed job-plan quality checks and blocker capture/resolution. |
| Value Report | Implemented | CWR, DCE/RHR when actual RTS exists, frozen-baseline context and projected downtime value with basis. |

## Clarence use-case controls and first-order gaps

| # | Requirement from product definition | Status after the close-out | Evidence / what remains |
| ---: | --- | --- | --- |
| 1 | Job readiness before optimization | Contract shipped, unreachable; feeds unbound | `refresh_restoration_readiness()` scores labour from `craft_capacity`, materials from `work_order_materials`, and bay/crane/tooling/vendor/documentation/weather/production from `operational_constraint_signals`. Missing or stale evidence stays `unknown`. CI proves blocked -> green. No surface calls it; no feed writes the signals. |
| 2 | Probability-based durations | Contract shipped, unreachable | `run_restoration_risk_simulation()` — deterministic empirical bootstrap gated at `hist_n>=5`; CI asserts p50/p80/p95 and a persisted run. `uncertainty_correlation` is a shared-rank shock weight, not a fitted correlation, and is documented as such. No surface calls it. |
| 3 | Scope-growth detection/control | Implemented | Unchanged. Work added after release is quarantined as candidate, raises a scope-growth blocker, and cannot execute until a revised independently approved plan is released. |
| 4 | Physical work-zone conflict modeling | Contract shipped; still human-declared | `work_zone_relationships` + a fail-closed interference constraint; CI proves parallel work is refused until a verified separation exists. Zone adjacency is **recorded by a human**, not computed — the automated spatial/interference model still does not exist. |
| 5 | Isolation and energy-state logic | Contract shipped, unreachable | Nine energy types, `verified_zero` ranking, and the `trg_recovery_energy_state` trigger. CI proves the database refuses an unsafe start and permits it only after a technician records verified-zero. No surface calls it. |
| 6 | Quality and reassembly gates | Implemented / Reused | Unchanged. Canonical acceptance checks and hold points must PASS before completion. |
| 7 | Rework / first-time-right restoration | Contract shipped, partly unexercised | `get_recovery_ftr_metrics()`, `recovery_recurrence_links`, `refresh_recovery_recurrence_candidates()`, `classify_recovery_recurrence()`. CI calls the metrics reader only; the recurrence classification path has no runtime coverage and no surface. |
| 8 | Failure consequence / criticality | In the objective; unreachable | `recovery_consequence_assessments` feeds the `run_recovery_fleet_optimization()` priority score (safety 100 / environment 40 / business 20 / production 10, plus asset criticality). The original gap — consequence absent from the objective — is genuinely closed at the database. No surface records an assessment. |
| 9 | Component age/life/history | Data shipped; **not** wired to do-now/defer | `component_instances`, `asset_meter_readings` and `get_recovery_component_life_context()` (CI asserts a 200 h component age exactly). Verified: neither `generate_restoration_plan()` nor `find_opportunity_work()` reads component life, so the original gap — life as an optimization input — is unchanged. |
| 10 | Cannibalization / substitution | Contract shipped, unreachable | `get_recovery_cannibalization_options()` and `propose_recovery_cannibalization()`, which writes a pending canonical approval and performs no component transfer. CI calls the options reader; the proposal path has no runtime coverage. |
| 11 | Fleet-level optimization | Contract shipped, unreachable | `run_recovery_fleet_optimization()` — deterministic priority-first scarce-craft allocation with an immutable run record. CI asserts an allocation and run id. No surface calls it. |
| 12 | Dynamic production priority | Contract shipped; live feed unbound | A fresh `production` signal's `priority_weight` enters the fleet priority score (proven in CI). No mine-plan integration writes that signal. |
| 13 | Shift-handoff intelligence | Contract shipped, unreachable | `get_recovery_handoff()` server-generates event, work, constraints, blockers, plan and field evidence. CI asserts it is bound to the event and carries the work, the open blocker and captured evidence. No surface renders it. |
| 14 | Supervisor decision queue | Contract shipped, unreachable | `get_recovery_decision_queue()`. CI asserts the overdue, escalated blocker is actually surfaced. No surface renders it. |
| 15 | Escalation clock | Contract shipped, unreachable | `run_recovery_escalation_clock()` on pg_cron `*/5 * * * *`, writing canonical `system_alerts` only — it never approves or executes work. CI asserts at least one escalation. |
| 16 | What-if simulation | Contract shipped, unreachable | `simulate_recovery_what_if()`. CI asserts `releasable=false` and a scenario critical path; the scenario never mutates or releases a plan. No surface calls it. |
| 17 | Historical best-sequence mining | Contract shipped; produces nothing yet | `get_recovery_sequence_patterns()` correctly refuses to claim below the sample minimum. On the seeded corpus it returns `patterns: []`, which is what CI asserts. There is no evidence it mines anything, because no qualifying history exists. |
| 18 | Crew productivity normalization | Contract shipped; produces nothing yet | `get_recovery_productivity_norms()` — same posture, returns `norms: []` on the seeded corpus. Evidence-gated refusal is proven; normalization output is not. |
| 19 | Weather/environment constraints | Contract shipped; feed unbound | Weather is a hard, fail-closed readiness gate with a freshness window. No weather integration exists; in production this reports `unknown`. |
| 20 | Vendor/OEM coordination | Contract shipped; feed unbound | Vendor readiness signal only. Vendor scheduling, warranty claims and OEM support callbacks remain unbuilt integrations. |
| 21 | Parts risk beyond on-hand | Data + advisory reader; **not** in the readiness calculation | `material_stock_lots` (condition, certification, staging, expiry) and approved `material_substitutions` are read by `get_recovery_parts_risk()`. Verified: `refresh_restoration_readiness()` still scores materials from `work_order_materials.status` alone, so the original gap is unchanged. |
| 22 | Richer economic decision rules | Contract shipped, unreachable | `recovery_economic_assumptions` and `get_recovery_economics()` add labour/overtime/contractor/logistics/risk/life-cycle terms. CI asserts value stays `projected_pending_canonical_human_verification`; `verify_value_metric()` remains the only authority that can verify. |
| 23 | Baseline integrity | Implemented | Unchanged. Method and basis are recorded; the baseline freezes at first plan generation and the close-out adds no path that rewrites it. |
| 24 | Recommendation acceptance tracking | Contract shipped, unexercised | `record_recovery_recommendation_feedback()` captures disposition and reason. No runtime coverage in CI and no surface records feedback. |
| 25 | Counterfactual value measurement | Contract shipped, unexercised | `recovery_delay_attribution` and `get_recovery_counterfactual_attribution()` decompose delay against the frozen baseline. No runtime coverage in CI and no surface. |
| 26 | Auditability | Implemented / Reused | Unchanged. Immutable plans, human provenance and canonical decisions/approvals/actions preserve the decision trail; the close-out adds no parallel audit store. |
| 27 | Offline/degraded mode | Deferred — unchanged, deliberately | The browser cache remains read-only and no offline write queue exists. The close-out does not change this and does not claim to. |
| 28 | Mobile-first field execution | Partially closed | `recovery_field_evidence` accepts photo/voice/document/measurement/note against canonical `cowork_attachments` with `client_command_id` idempotency; CI proves a note round-trips into the handoff. There is still no mobile capture surface and no offline field synchronization. |
| 29 | Adoption design / co-pilot posture | Implemented as product posture | Unchanged. |
| 30 | Closed-loop management cadence | Contract shipped, unreachable | `recovery_cadence_snapshots` and `publish_recovery_cadence_snapshot()` for shift/daily/weekly; CI asserts the snapshot persists. Nothing schedules the cadence and nothing renders it. |

### How to read the counts

- **5 rows were already Implemented/Reused and are untouched** (3, 6, 23, 26, 29).
- **1 row remains deliberately deferred** (27).
- **24 rows now have a governed database contract**, and the runtime acceptance
  proves the contracts execute.
- **0 rows are closed end to end in the product**, because no surface reaches any
  close-out contract.
- **8 rows still carry their original first-order gap even at the database
  level**: 4 (no computed spatial model), 9 (life not an optimization input),
  12 / 19 / 20 (feeds unbound), 17 / 18 (no output on any real corpus),
  21 (not in the readiness calculation).

## Advanced enterprise layer

The following ideas are intentionally **not** represented as completed by this PR: causal-delay attribution; systemic-constraint recommendations; maintenance capacity forecasting; fleet/site/enterprise scenario optimization; reliability-economics policy optimization; Recovery-specific digital-twin simulation; automated tacit-knowledge mining; near-miss learning; normalized cross-site benchmarking; unknown-unknown novelty detection; conflict-resolution optimization; portfolio value-leakage/bottleneck optimization; capital/OEM/warranty feedback loops specific to Recovery; spares-network and obsolescence optimization in the event solver; cyber-physical dependency optimization; human-reliability/fatigue optimization inside the event solver; contract/insurance optimization; emergency objective switching; model-update governance specific to Recovery; and adversarial/red-team simulation of event recommendations.

Several of those domains already have canonical foundations elsewhere in Sync. Recovery must **reuse** those foundations when each layer is wired; it must not create competing stores or policy engines.

## Maturity sequence after this PR

1. **Orchestrate** — this PR: event scope, deterministic sequence/concurrency, opportunity work, governed release, controlled execution and projected value.
2. **Control** — dynamic RTS recomputation, escalation clocks/alerts, shift handoff, richer blocker intervention and mobile evidence.
3. **Optimize** — multi-event scarce-resource allocation, production priority, what-if scenarios and fleet/site objective functions.
4. **Learn** — delay decomposition, first-time-right and recurrence linkage, best-sequence mining, causal/systemic constraint elimination, and verified counterfactual value learning.

## Merge gate for the Orchestrate slice

This slice is not ready merely because the page renders. It must keep all of the following green: lint, TypeScript, production build, unit/source-contract tests, migration ordering, full migration chain + seeded auth/RLS/RPC smoke, Recovery lifecycle smoke, Golden-path E2E, CodeQL and secret scanning. Any deferred item above must remain visibly deferred rather than being described as shipped capability.

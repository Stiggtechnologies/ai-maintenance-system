# Sync Recovery — control and maturity matrix

Status legend: **Implemented** = executable in this PR; **Reused** = canonical Sync capability invoked rather than duplicated; **Partial** = useful production foundation exists but an identified integration/automation remains; **Deferred** = intentionally not represented as production capability yet.

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

| # | Requirement from product definition | Status in this slice | What remains |
| ---: | --- | --- | --- |
| 1 | Job readiness before optimization | Partial | Material readiness is automated. Labour, bay, crane, tooling, vendor, weather and documentation can be hard constraints now; automated readiness feeds/scoring remain. |
| 2 | Probability-based durations | Partial | Evidence-gated historical P50/P80 exists. Full stochastic/Monte-Carlo event risk and correlated-duration models are deferred. |
| 3 | Scope-growth detection/control | Implemented | Work added after release is quarantined as candidate, creates a scope-growth blocker, and cannot execute until a revised independently approved plan is released. |
| 4 | Physical work-zone conflict modeling | Partial | `work_zone` hard constraints + fail-closed human concurrency verification exist. Automated spatial/interference model remains. |
| 5 | Isolation and energy-state logic | Partial / Reused | Job-plan permits and canonical equipment-release isolation are live gates. A richer multi-energy state model is deferred. |
| 6 | Quality and reassembly gates | Implemented / Reused | Canonical acceptance checks/hold points must PASS before completion. Additional discipline-specific commissioning templates remain content/integration work. |
| 7 | Rework / first-time-right restoration | Partial | Rework blocker taxonomy and completion evidence exist. First-Time-Right Restoration Rate and recurrence-window linkage remain. |
| 8 | Failure consequence / criticality | Partial / Reused | Canonical asset/work priority remains visible. Multi-dimensional safety/environment/business consequence is not yet part of the Recovery optimization objective. |
| 9 | Component age/life/history | Deferred integration | Do-now/defer in Recovery does not yet consume component-life and rebuild/campaign history as an optimization input. |
| 10 | Cannibalization / substitution | Deferred | No automatic rotable/cannibalization trade study yet. |
| 11 | Fleet-level optimization | Deferred | Current deterministic solver is event-level. Scarce-resource optimization across simultaneous events belongs to Recovery Optimize. |
| 12 | Dynamic production priority | Partial | Production can be a governed hard constraint. Live production/mine-plan priority feed is not yet bound to the solver. |
| 13 | Shift-handoff intelligence | Reused / Partial | Sync already has handover/briefing surfaces; automatic Recovery-specific handoff generation remains. |
| 14 | Supervisor decision queue | Reused / Partial | Canonical Approval Queue handles plan release. A focused RTS-impact decision queue for crane/vendor/scope/resource interventions remains. |
| 15 | Escalation clock | Partial | Blockers support owner, severity, escalation due time and forecast RTS impact in the data model. Countdown/escalation automation and alerting remain. |
| 16 | What-if simulation | Deferred | Scenario re-solve is a Recovery Optimize capability. |
| 17 | Historical best-sequence mining | Deferred | Historical durations are used conservatively; best-sequence pattern mining is not yet production capability. |
| 18 | Crew productivity normalization | Deferred | No site/condition-adjusted productivity comparison is claimed. |
| 19 | Weather/environment constraints | Partial | Weather can be an explicit hard constraint/blocker; live weather feed remains. |
| 20 | Vendor/OEM coordination | Partial | Vendor can be a constraint/blocker; vendor scheduling, warranty/OEM support callbacks remain integrations. |
| 21 | Parts risk beyond on-hand | Partial / Reused | Canonical material status gates start. Certification, physical staging, alternate PN, transfer-time and condition risk are not all in the Recovery readiness calculation yet. |
| 22 | Richer economic decision rules | Partial | Sourced downtime cost/hour supports counterfactual value. Margin, penalties, replacement/repair/risk cost as a multi-objective event function remain. |
| 23 | Baseline integrity | Implemented | Method + source/basis recorded; baseline freezes at first plan generation. |
| 24 | Recommendation acceptance tracking | Partial / Reused | Plan approval/rejection and human changes are canonical. Explicit acceptance/rejection reason learning for every opportunity recommendation remains. |
| 25 | Counterfactual value measurement | Partial | Frozen baseline produces projected counterfactual hours/value; causal attribution and verified counterfactual methodology remain a learning/verification layer. |
| 26 | Auditability | Implemented / Reused | Immutable plans, human provenance, canonical decisions/approvals/actions, value records and learning events preserve the decision trail. |
| 27 | Offline/degraded mode | Implemented for safe degradation | Last known board/event may be read from local cache; no offline writes are permitted. Fully offline field synchronization is intentionally not claimed. |
| 28 | Mobile-first field execution | Partial | Recovery layout is responsive and field actions are simple. Photo evidence, wearable/voice and offline field synchronization remain. |
| 29 | Adoption design / co-pilot posture | Implemented as product posture | UI presents evidence, constraints and recoverable opportunity without auto-overriding planners/supervisors. |
| 30 | Closed-loop management cadence | Partial / Reused | Recovery provides the operating picture; existing Briefing/Handover/Learning surfaces can consume it. Automated daily/weekly Recovery cadence remains. |

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

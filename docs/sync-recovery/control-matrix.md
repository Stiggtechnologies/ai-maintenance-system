# Sync Recovery — control and maturity matrix

**2026-08-24 — UPDATED FOR PRODUCT WIRING.** Control, Optimize and Learn are now
real tabs in the Recovery workspace. **25 of the 39 close-out functions are now reachable**
through the product service/surface; an exact source-contract test prevents that
count from drifting silently. The remaining 14 are deliberately internal
triggers/helpers, connector-side master-data writers, or still-unexposed governed
actions (recurrence classification, cannibalization proposal, economic-assumption
authoring and site work-zone relationship approval).

**2026-08-24 — FIRST-TENANT ACTIVATION ADDED.** The Activate Tenant workspace
now covers sites, assets, work orders, materials, stock, crew capacity,
operating state and production through the canonical connector contract. CSV
and an allowlisted JWT-protected JSON adapter share human-approved mappings,
dry-run validation, retained rejects, replay/idempotency, source freshness and
domain readiness. The guided transaction produces a canonical Recovery
`draft` from human-selected scope and baseline; it never submits, approves or
releases that plan. See `docs/sync-recovery/activation-kit.md` for the exact
transport and activation boundary.

External weather, vendor/OEM and mine-plan production data now has a tenant-safe,
idempotent connector ingestion path with retained rejects, freshness and explicit
administrator activation. That closes the platform-side integration contract; it
does **not** mean any customer feed is live. Each tenant still has to provide its
provider endpoint/credential, store the credential outside the database, bind the
opaque secret reference and run an authenticated adapter. Until then readiness
correctly reports `unknown`.

The Activation Kit closes the provider-neutral CMMS/EAM master/context loading
path and an operator-triggered REST pull. A customer's hostname, endpoint,
credential and approved mappings must still be configured; unattended service
polling remains disabled until the tenant authorizes a cadence and reviewed
service identity.

`Recovery close-out runtime acceptance` proves the database contracts execute.
Product tests additionally prove the reachable service names and UI tabs; neither
test can substitute for real tenant history or third-party connection evidence.

Status legend: **Implemented** = executable and reachable in the product;
**Reused** = canonical Sync capability invoked rather than duplicated;
**Contract shipped, unreachable** = governed DB contract exists and is proven by
CI, but no surface calls it; **Partial** = useful production foundation exists
but an identified integration/automation remains; **Deferred** = intentionally
not represented as production capability yet.

This document is a non-overclaiming map from the Sync Recovery / Event Orchestrator product definition to the shipped vertical slice. It does not replace the enterprise capability register.

## Architectural invariants

| Requirement                                                                                      | Status               | Evidence / boundary                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downtime event is the coordination object, not a replacement work-order store                    | Implemented          | `restoration_events` + `restoration_event_work` reference canonical `work_orders`; no duplicate WO store.                                                                                     |
| One governed integrated plan per version                                                         | Implemented          | `restoration_plan_versions`; released snapshots are immutable and revisions supersede rather than rewrite evidence.                                                                           |
| AI does not own schedule mathematics, critical path, constraints, economics, authority or safety | Implemented          | Plan generation and control gates are deterministic SQL/RPCs. The product surface renders server results rather than scheduling in the browser.                                               |
| Unknown concurrency fails closed                                                                 | Implemented          | New event work is `unknown`; deterministic scheduling treats it as sequential until an authorized human records a named parallel group and substantive basis.                                 |
| No invented duration                                                                             | Implemented          | Comparable-history P50/P80 requires >=5 completed jobs with the same job plan; otherwise explicit planned/estimated hours are used; otherwise duration stays missing and approval is blocked. |
| Baseline cannot be rewritten after seeing the outcome                                            | Implemented          | Counterfactual baseline freezes at first plan generation.                                                                                                                                     |
| Human approval before executable release                                                         | Reused               | Recovery submits a canonical `autonomous_decisions` record plus `approval_workflows`; generator and approver must differ before release.                                                      |
| Permit/isolation truth remains canonical                                                         | Reused               | Start rechecks job-plan permit demand against canonical `equipment_releases`; generic Recovery constraints cannot self-clear permit/isolation/asset-state truth.                              |
| Material readiness remains canonical                                                             | Reused               | Start refuses when canonical `work_order_materials` is `requested`/`short`.                                                                                                                   |
| Quality/acceptance evidence gates completion                                                     | Reused               | Exact canonical `job_plan_checks` IDs and acceptance criteria are surfaced; all checks require explicit PASS evidence before work completion.                                                 |
| Operations handback gates event closure                                                          | Reused               | Event close refuses while a canonical equipment release is still `released` or `returned`; Operations must accept it.                                                                         |
| Claimed value is not silently promoted to verified                                               | Implemented + Reused | Recovery writes only `projected` counterfactual hours/value; existing Value Verification remains the authority that can verify value.                                                         |
| Degraded connectivity cannot create shadow operational truth                                     | Implemented          | Browser cache is read-only; writes are disabled and no offline operational write queue is created.                                                                                            |

## Product surfaces

| Surface             | Status                                    | Shipped behavior                                                                                                                                        |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet Down Board    | Implemented                               | Active restoration events plus currently-down assets without an event; planned/major/opportunity event intake uses canonical assets.                    |
| Event Workspace     | Implemented                               | Integrated event scope, candidate WOs, sequencing, human concurrency verification, counterfactual baseline and explicit constraint register.            |
| Integrated Timeline | Implemented                               | Server-generated immutable stages, serial scope, critical path, P80 where supported, CWR, warnings/missing inputs, canonical approval and release.      |
| Opportunity Work    | Implemented / Reused                      | Recovery calls canonical `find_opportunity_work`; it shows fits, does-not-fit and unsized rather than hiding insufficient duration evidence.            |
| Live Execution      | Implemented                               | Controlled start, completion evidence, governed job-plan quality checks and blocker capture/resolution.                                                 |
| Control             | Implemented                               | Readiness/deeper-input refresh, resource requirements, manual signal fallback, field/work-zone/energy evidence, handoff and supervisor queue.           |
| Optimize            | Implemented within stated evidence bounds | Duration risk, what-if, fleet allocation, consequence assessment, uncertainty grouping, component-life/parts/alternate evidence.                        |
| Learn               | Implemented within stated evidence bounds | FTR, sequence/productivity evidence, recommendation feedback, delay attribution and manual cadence snapshots; insufficient history stays visibly empty. |
| Value Report        | Implemented                               | CWR, DCE/RHR when actual RTS exists, frozen-baseline context and projected downtime value with basis.                                                   |

## Clarence use-case controls and first-order gaps

|   # | Requirement from product definition   | Status after the close-out                          | Evidence / what remains                                                                                                                                                                                                                                                                               |
| --: | ------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Job readiness before optimization     | Implemented; tenant feeds require configuration     | Control refreshes labour, material, component-life, physical-zone and external-resource constraints. Missing/stale evidence stays `unknown`; manual fallback and connector ingestion are both source-bound.                                                                                           |
|   2 | Probability-based durations           | Implemented                                         | Optimize runs the persisted deterministic empirical bootstrap and exposes uncertainty-group configuration. It remains evidence-gated at `hist_n>=5`; shared-shock weight is not represented as a fitted correlation.                                                                                  |
|   3 | Scope-growth detection/control        | Implemented                                         | Unchanged. Work added after release is quarantined as candidate, raises a scope-growth blocker, and cannot execute until a revised independently approved plan is released.                                                                                                                           |
|   4 | Physical work-zone conflict modeling  | Contract shipped; still human-declared              | `work_zone_relationships` + a fail-closed interference constraint; CI proves parallel work is refused until a verified separation exists. Zone adjacency is **recorded by a human**, not computed — the automated spatial/interference model still does not exist.                                    |
|   5 | Isolation and energy-state logic      | Implemented                                         | Control records time-bound energy state and governed job-plan requirements; the database trigger still independently refuses unsafe start.                                                                                                                                                            |
|   6 | Quality and reassembly gates          | Implemented / Reused                                | Unchanged. Canonical acceptance checks and hold points must PASS before completion.                                                                                                                                                                                                                   |
|   7 | Rework / first-time-right restoration | Partial                                             | Learn renders FTR metrics and refreshes recurrence candidates; final recurrence classification remains a separately governed action without a product control.                                                                                                                                        |
|   8 | Failure consequence / criticality     | Implemented                                         | Optimize records the human 0–5 consequence assessment and uses the governed weighted objective in fleet allocation.                                                                                                                                                                                   |
|   9 | Component age/life/history            | Partial — wired to plan gate, not candidate ranking | Product plan generation first refreshes a component-life constraint. Recorded age beyond a tenant-authored planned interval blocks approval; absent meter/interval evidence stays unknown and is never inferred. `find_opportunity_work()` still does not rank unopened candidates by component life. |
|  10 | Cannibalization / substitution        | Partial                                             | Optimize renders approved alternates and donor candidates. The proposal action remains unexposed and, when added, must still create a pending canonical approval and perform no transfer.                                                                                                             |
|  11 | Fleet-level optimization              | Implemented                                         | Optimize runs deterministic priority-first scarce-craft allocation and renders the immutable result.                                                                                                                                                                                                  |
|  12 | Dynamic production priority           | Platform path complete; tenant adapter required     | Fresh production signals enter the fleet objective. Connector ingestion is validated and tenant-bound; a mine-plan endpoint/credential and authenticated adapter are still tenant deployment work.                                                                                                    |
|  13 | Shift-handoff intelligence            | Implemented                                         | Control renders server-generated event, work, constraints, blockers, plan and field evidence.                                                                                                                                                                                                         |
|  14 | Supervisor decision queue             | Implemented                                         | Control renders overdue blockers, pending approvals and unresolved hard constraints.                                                                                                                                                                                                                  |
|  15 | Escalation clock                      | Implemented as an internal control                  | `run_recovery_escalation_clock()` runs on pg_cron every five minutes and writes canonical alerts; Control renders the resulting supervisor queue. It never approves or executes work.                                                                                                                 |
|  16 | What-if simulation                    | Implemented                                         | Optimize runs a non-mutating, non-releasable scenario and renders its result.                                                                                                                                                                                                                         |
|  17 | Historical best-sequence mining       | Reachable; evidence still insufficient              | Learn renders the evidence-gated result. Empty stays visibly empty until the tenant has the minimum qualifying history.                                                                                                                                                                               |
|  18 | Crew productivity normalization       | Reachable; evidence still insufficient              | Learn renders site-scoped norms and preserves the minimum-sample refusal.                                                                                                                                                                                                                             |
|  19 | Weather/environment constraints       | Platform path complete; tenant adapter required     | Weather is a hard freshness gate. Manual authorized evidence and connector ingestion work; production activation still needs a tenant provider/credential.                                                                                                                                            |
|  20 | Vendor/OEM coordination               | Partial                                             | Vendor readiness ingestion is platform-complete and fail-closed. Vendor scheduling, warranty claims and OEM callbacks remain provider-specific integrations.                                                                                                                                          |
|  21 | Parts risk beyond on-hand             | Implemented in product planning                     | Plan generation refreshes hard material-lot constraints for condition, certification and staging. Missing staging evidence is `unknown`; bad/not-ready evidence is `blocked`. Approved alternates and donor candidates remain advisory and require human action.                                      |
|  22 | Richer economic decision rules        | Partial                                             | Learn renders governed labour/overtime/contractor/logistics/risk/life-cycle economics. Assumption authoring is not yet a product control; `verify_value_metric()` remains the only authority that can verify value.                                                                                   |
|  23 | Baseline integrity                    | Implemented                                         | Unchanged. Method and basis are recorded; the baseline freezes at first plan generation and the close-out adds no path that rewrites it.                                                                                                                                                              |
|  24 | Recommendation acceptance tracking    | Implemented                                         | Learn records accepted/rejected/modified/deferred disposition with a human reason.                                                                                                                                                                                                                    |
|  25 | Counterfactual value measurement      | Implemented                                         | Learn records and renders delay attribution against the frozen baseline; it cannot verify value.                                                                                                                                                                                                      |
|  26 | Auditability                          | Implemented / Reused                                | Unchanged. Immutable plans, human provenance and canonical decisions/approvals/actions preserve the decision trail; the close-out adds no parallel audit store.                                                                                                                                       |
|  27 | Offline/degraded mode                 | Deferred — unchanged, deliberately                  | The browser cache remains read-only and no offline write queue exists. The close-out does not change this and does not claim to.                                                                                                                                                                      |
|  28 | Mobile-first field execution          | Partially closed                                    | `recovery_field_evidence` accepts photo/voice/document/measurement/note against canonical `cowork_attachments` with `client_command_id` idempotency; CI proves a note round-trips into the handoff. There is still no mobile capture surface and no offline field synchronization.                    |
|  29 | Adoption design / co-pilot posture    | Implemented as product posture                      | Unchanged.                                                                                                                                                                                                                                                                                            |
|  30 | Closed-loop management cadence        | Implemented manually; scheduling remains optional   | Learn publishes shift/daily/weekly evidence snapshots. No automatic customer cadence is enabled without an explicit operating policy.                                                                                                                                                                 |

### How to read the counts

- **5 rows were already Implemented/Reused and are untouched** (3, 6, 23, 26, 29).
- **1 row remains deliberately deferred** (27).
- **24 rows have a governed database contract**, and runtime acceptance proves
  those contracts execute.
- **25 of 39 close-out functions are product-reachable**; the others are either
  intentionally internal/connector-side or specifically named above.
- Remaining first-order boundaries are: no computed spatial model (4), no
  component-life candidate ranking (9), no tenant-specific provider bindings
  (12/19/20), and insufficient real history to prove learning output (17/18).

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

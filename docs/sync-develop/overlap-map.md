# Sync Develop — Overlap Map (what already exists, and every canonical-home ruling)

_Created 2026-08-27. **Read this before building any register row.** This repository already
ships a large fraction of the Sync Develop specification. The last week of work here was
spent finding and demoting exactly the pattern a naive build of this spec would recreate —
two component-life stores, 39 orphaned Recovery RPCs, a register full of unreachable ✅s.
The owner's standing rule: search for existing implementations first; **extend, do not
parallel-track** (AGENTS.md invariants 1–3, 8; Lane split rule 1's mirror: the Feature lane
reuses, it does not duplicate)._

_Register: [register.md](register.md). Every claim below was verified against the working
tree on 2026-08-27 with control-checked greps (positive control: `fracas` = 45 files in
src+supabase). Verdicts: **REUSE** (the capability is this module, bind to it) · **EXTEND**
(the module is the canonical home; add columns/scope/write paths) · **CONFLICT** (the spec
as written would create a second implementation of something live — ruling given)._

---

## 1. Risk Operating System (ROS) — `/risk`, `src/lib/risk-operating-system`, migrations `20260921110101/02`

The largest single overlap. A full ISO 31000 spine is live and customer-reachable: risks
with current/residual/target levels, controls with effectiveness-distinct-from-existence,
control tests, treatments-on-recommendations, assumptions with dependency graphs and
invalidation, indicators, assurance reviews, advisory agent bindings — 23 RPCs called from
`riskOperatingService.ts`.

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D5.22 Risk §12 | REUSE | The spec's Risk MUST be the `risks` table. Add `development_case_id` + gate/portfolio consumption. A project-risk table repeats the parallel-store failure this repo just demoted. |
| D5.23 Control §13 | REUSE (✅) | `risk_controls` — done and reachable. |
| D5.24 ControlAssessment §14 | EXTEND | `risk_control_tests` — add design vs operating effectiveness columns. |
| D5.25 Treatment §15 | EXTEND | Treatments ride the canonical recommendation model + `risk_treatment_dependencies`. Add secondary-risk auto-creation. No standalone Treatment table. |
| D2.06/D3.29 Assumption §18 | **CONFLICT** | Three-plus assumption stores already exist (`risk_assumptions` family, `financial_assumptions`, `recovery_economic_assumptions`, `risks.assumptions` jsonb). **Ruling: `risk_assumptions` + dependencies IS the platform Assumption** — extend subject types (estimate, schedule, business_case) and add comparator/threshold columns; `financial_assumptions` remains the numeric-value leg. Building spec §18 as a new table = a fourth store. |
| D3.30 Assumption invalidation | REUSE (✅) | `invalidate_risk_assumption` already does deterministic reopening, end-to-end. |
| D2.07 Threshold monitoring | EXTEND | `risk_indicators` + observations; wire declared thresholds as indicators. |
| D3.16/17 AssuranceReview + SoD | EXTEND | `risk_assurance_reviews` (author≠assurer already DB-checked). Widen `subject_type` to gates/cases; add competency + conflicts fields. No second assurance store. |
| D11.15/16 Objective + invariant | EXTEND | `risk_objectives` is the ONE Objective store; add nesting/targets; enforce risk→objective at the DB (currently free-text bypass exists). |
| D12.12 Risk Agent | EXTEND | `provision_risk_advisory_agents` bindings are live; acceptance is already human-only at the DB boundary. |

## 2. Lifecycle stages + gates — `lifecycle_stages`, `stage_gate_*`, `src/lib/lifecycle/stages.ts` (migration `20260816090000`)

Live, DB-enforced gate machinery: 14 master stages, per-gate mandatory criteria,
reviews (pass/pass_with_conditions/hold; conditions mandatory on conditional pass),
findings, and `advance_lifecycle_stage` that refuses stage moves without a passing human
review. `assessGate` blocks on mandatory-fail AND on never-assessed. **Zero UI callers** —
the machinery is real, the experience is missing.

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D3.24 Gate §6 | **CONFLICT** | **Ruling: `stage_gate_*` + `assessGate` IS the canonical gate implementation.** Generalize the subject (asset → development case), extend the outcome enum to the I.5/§6 union (PROCEED, PROCEED_WITH_CONDITIONS, HOLD, PIVOT, REDESIGN, PAUSE, RECYCLE, TERMINATE — reconcile the two lists at build and document), keep DB-blocking. A parallel gate evaluator/table set is forbidden. |
| D3.25 GateRequirement §7 | EXTEND | Add category/evidence_type/minimum_confidence/`source_authority` columns to `stage_gate_criteria` — not a parallel requirement table. |
| D3.23 Stage §5 / D11.10 13-stage lifecycle | **CONFLICT** | **Ruling: framework stages MAP to `lifecycle_stages` stage_keys** (add Assure/Sanction/Stabilize/Realize/Learn as master stages where missing). Two stage vocabularies answering "what stage is this in" is the exact two-answers failure AGENTS.md forbids. |
| D3.06 outcomes, D3.07 zero-based, D3.18 conditions, D3.31 gate-review workflow, D3.35 readiness calc, D3.37 framework checkpoints, D13.05 screen | EXTEND | All extend this family. `gate_conditions` becomes a child table of `stage_gate_reviews`. Framework checkpoints (I.1) = lighter gate rows on the same family (e.g. `decision_type='checkpoint'`) — no parallel checkpoint table. |

## 3. Evidence model — `evidence_items` (+ `ria_*` grades, `recovery_field_evidence`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D11.17 Evidence §9 | **CONFLICT** | Three live evidence stores. **Ruling: `evidence_items` is canonical (AGENTS invariant 3 — one evidence model).** The eight provenance classes, `verification_status`, revision, applicability become typed columns/enums on it; `ria_*` evidence grades stay assessment-scoped consumers; `recovery_field_evidence` stays field-capture feeding it. A new Evidence table is forbidden. |
| D11.18 Promotion guard | EXTEND | BEFORE-trigger on `evidence_items` in the `promote_structural_contribution` style; ships with the columns, Invariant lane, negative-path test mandatory. |
| D11.22 Evidence Confidence §46 | EXTEND | Calc over `evidence_items`; weights stored like `risk_criteria_profiles.scoring_weights`. |

## 4. Decisions — `decisions` (+ `ria_decisions`, `lifecycle_evaluations`, decision-case workspace)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D3.27 Decision §16 | **CONFLICT** | Three live decision stores plus gate reviews. **Ruling: `decisions` is canonical.** Extend with decision_question, decision_required_date, selected_option_id, approval_level; `ria_decisions` stays assessment-scoped; `lifecycle_evaluations` stays the economic-evaluation record gates link to. A fourth decision store is the named anti-pattern. |
| D3.28 DecisionOption §17 | EXTEND | Generalize `scenarios` (already an option set with effect fields + recommended flag) to hang off `decisions`. No new DecisionOption table. |
| D13.07 Decision Workspace | **CONFLICT (honesty risk)** | `DecisionCaseWorkspacePage` is rich and reachable but persists to localStorage + `cowork_workspaces` jsonb — a parallel client-side record. **Ruling: re-point it at `decisions` + `scenarios`; the localStorage store must never become system of record.** The register carries this risk explicitly. |
| D3.12/13/21/36 latency + debt | EXTEND | `decision_required_date` lands on `decisions`; aggregation follows ScheduleActivity import. |

## 5. Sync Recovery — `restoration_*`, `/recovery` (migrations `20260921090000`, `20261001090000`)

The spec's §27/§28/Execution-Readiness/Constraint-Burn-Down territory is substantially
LIVE here: per-work-item constraints (17 kinds, satisfied-requires-verifier), blockers with
escalation clocks and stated-basis impact, derived readiness items, and
`start_restoration_work` — a SECURITY DEFINER refusal gate no AI path can flip.

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D7.18 Constraint §28 | **CONFLICT** | **Ruling: `restoration_constraints` + `operational_constraint_signals` ARE the Constraint object** — richer than the spec's 10 kinds. Generalize scope (event → work package), extend the enum (drawing/access/scaffold), add expected_clear_date. Do not build the spec's standalone table. |
| D7.05 Release checklist | **CONFLICT** | **Ruling: the Recovery checklist (`refresh_restoration_readiness` + constraints) is canonical**; generalize to project work packages. |
| D7.17 WorkPackage §27 | **CONFLICT** | Three live work-grouping models (`work_orders`, `restoration_event_work`, `outage_work`). **Ruling: `work_orders` remains the work identity; the new typed AWP package object wraps/references it** exactly as the other two do (AGENTS invariant 8). |
| D7.06/11, D7.19 verdicts + workflow 4 | EXTEND | The start-guard/feasibility discipline extends to project packages; the §70 pattern is already correct here. |
| D7.07 burn-down | EXTEND | Forward-looking fields on `restoration_constraints`/`restoration_blockers`; wire `run_recovery_escalation_clock` (defined + tested, no scheduled caller). |

## 6. Scheduler / constrained scheduling + outages — `craft_capacity`, `schedule_options`, `outage_*` (migration `20260811130000`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D7.01/02 Resource demand/capacity | EXTEND | `craft_capacity` family + `evaluate_schedule_feasibility` ("not assessable" honesty is already right). Add project-scoped, multi-period, non-labour pools. No second capacity store. |
| D7.08/20, D7.13/14 workface metrics | NEW calcs | Over existing stores; one implementation per duplicated spec ref. |
| D7.15 Site Change Load | NEW calc | Pure aggregation over outage_windows/schedule_options/temporary_modifications/training_plans/capacity_deductions — no new load tables. |
| D5.28 ScheduleActivity §22 | EXTEND | `shutdown_tasks` + `src/lib/modelling/schedule-risk.ts` grow into the P6/XER import target. P6 remains system-of-record; Sync never writes back. Known demoted-pattern: read-RPC only today. |

## 7. Workforce / human factors — `competencies`, `member_competencies`, `human_performance_events` (migration `20260817090000`)

**Demoted-pattern warning (verified):** `workforce_members`/`member_competencies` have
demo-seed writes only (C2.08 demotion); `human_performance_events` is schema-only — zero
references outside its migration. Every verdict here means EXTEND-with-wiring.

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D7.03/04 competency readiness | EXTEND | Wire write RPCs; join roster × unexpired competency × required competency. |
| D12.03 Sync HOP / D12.19 HOP Agent | EXTEND | Wire `human_performance_events`; no second HOP store. |
| D11.01 non-surveillance | REUSE the invariant | The table structurally has NO person column ("add a person column and this table stops working"). Every future HOP surface inherits it; negative test ships with the first surface. |

## 8. Reliability kernel + modelling — `src/lib/reliability`, `src/lib/modelling`, `src/lib/optimization|spares|process-safety`

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D5.32 Forecast confidence §51 / D5.07 P50-P80 | REUSE the kernel | Monte Carlo (P10/50/90 + criticality index), Weibull MLE + method selection, RBD, availability, PFD/SIL, interval/spares optimization are all live and reachable. Add P80 and project bindings. **Zero new math. Never a second simulator.** |
| D5.09 risk-cost-schedule MC | EXTEND | The kernel simulates over the (new) linkage relations. |
| D5.13/14/15, D5.31 schedule quality | EXTEND/NEW | Diagnostics + score live in `src/lib/modelling` (cycle refusal already there); the score gates Monte Carlo with named-defect warnings. |
| D12.13 RAM Agent | EXTEND | `reliability-engineer-core` already carries the refusal standard verbatim; scope it to case asset sets. |
| D10.03 enterprise critical path | EXTEND | CPM + `propagateLoss` compose; feed project dependencies in. |

## 9. Value instrumentation — `value_management`, `value_metrics` + `verify_value_metric`, `business_cases` (migrations `20260819140000`, `00000000000008`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D9.10 Benefit §32 | EXTEND | `value_metrics` + verification loop (live write path). Add mandatory owner, objective link, expected_date. **A new Benefit table beside `value_metrics` = a second value store.** |
| D2.01–D2.05 hypothesis/finance/delta | EXTEND | `business_cases`/options/`financial_assumptions`/`asset_economics`; write paths are the gap (demo-seed today). |
| D9.03 warranty checkpoints / D9.13 benefits workflow | EXTEND | The RIA day-30/60/90 governed checkpoint contract + `verify_value_metric` + `get_pilot_scorecard` — extend horizons to 30/90/180/365. A new checkpoint table = second verification store. |
| D9.02 OperationalPerformanceWarranty | EXTEND | Grow `ram_targets` into the seven-metric internal commitment. **Naming trap: `warranty_terms`/`warranty_claims` are commercial vendor warranty — do not overload them.** |
| D9.07/15 value leakage | NEW calc | Attribution schema copied from `recovery_delay_attribution` (causal/contributing/unattributed with mandatory basis). |
| D10.04 frontier | EXTEND | `prioritiseUnderBudget`/`compareOptions` in `src/lib/value` are the arithmetic; add dimensions + frontier output. |

## 10. FRACAS / lessons / CA loop / standards — `taxonomy_definitions`, `learning_events`, `ca_*` (migrations `20260806170000`, `00000000000026`, `20260831090000`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D9.11 Lesson §33 | **CONFLICT** | **Ruling: extend `learning_events`** (add failure_mode/cause/corrective_action/applicability + project linkage) — §33 built as written is a second learning store. `taxonomy_definitions` stays the ONE failure-mode identity; the eight project-delivery failure types become a taxonomy branch (D9.04). |
| D9.05 closure chain | EXTEND | `start_ca_verification → attest_ca_stage → screen_similar_assets → evaluate_ca_effectiveness` is live; add the Standard-Changed hop (`standards_register` exists) and screen new PROJECTS. |
| D9.12 auto-screening / D12.05 knowledge-at-start / D12.17 Lessons Agent | EXTEND | `screen_similar_assets` + asset-onboarding auto-retrieval patterns, re-targeted at case creation. |

## 11. MOC / change + configuration management — engineering_approval_rules, MOC triggers, `configuration_*`, `temporary_modifications` (migrations `00000000000012`, `20260809140000`, `20260815140000`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D5.27 Change §21 / D5.30 workflow 3 | EXTEND | The MOC-in-40-files machinery (change-class gating, competence sign-off triggers, auto re-review) is the foundation; add Baseline anchoring, impact vector, authority routing, propagation. A parallel change store is forbidden. |
| D8.02 TechnicalDebt §II.18 | **CONFLICT** | **Ruling: `temporary_modifications` IS the technical-debt record** (jumper/bypass/defeat/temporary_repair/software_override/temporary_support with NOT-NULL removal date). Extend the enum + origin-project link + write path. |
| D4.15 digital asset / D4.13 OT cyber | EXTEND | `configuration_items` (firmware/software drift detection live) gains licenses/patches/support-horizon/backup fields; cyber requirements land on `design_requirements`. |

## 12. Onboarding governance — `onboarding_requirements`, `get_golive_readiness`/`approve_asset_golive` (migration `00000000000011`)

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D8.08 OperationalReadinessItem §30 / D8.11 ORI §48 | EXTEND | The mandatory-blocked, human-approved readiness machinery is live per-asset with named gaps. Add per-commissioning-system scope + missing categories + owners/dates. **A parallel readiness-item store would conflict directly.** |
| D11.23 IRI §47 / D11.08 information readiness | EXTEND | Same function family, information-object scoping. |
| D13.10 Operational Readiness screen / D13.14 ops briefing | EXTEND | AssetOnboardingHub + /briefing compositions. Do not repurpose `/readiness` (platform-deployment meaning). |

## 13. Reliability-by-design (capital projects) — `capital_projects`, `design_requirements`, `design_studies`, `acceptance_tests`, `early_life_failures` (migration `20260818090000`)

The closest thing to Sync Develop that already exists: projects, requirements,
frontline-participation studies, acceptance tests, RAM targets/allocations, early-life
failure attribution back to the delivering project — read-reachable at `/design`,
demo-seed writes only.

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D4.16 Requirement §10 / D4.01 QualityRequirement | EXTEND | `design_requirements` is the ONE project requirement table. |
| D4.10/11/12 frontline + scoring | EXTEND | `design_studies` + per-finding child records. |
| D8.06 commissioning family | EXTEND | System/subsystem decomposition ABOVE `acceptance_tests`, not beside. |
| D9.02/03, D9.16, D9.01 | EXTEND | `ram_targets`, `early_life_failures`, `get_project_posture`. |
| D1.04 DevelopmentCase | NEW, references | `capital_projects` likely becomes the delivery-side record a DevelopmentCase links to (decide at build: extend vs reference — do NOT duplicate its fields). |

## 14. Suppliers / contracts — `supplier_management` (migration `20260817140000`)

All schema, no write paths (E7 rows 🟡). D6 rows EXTEND `contract_packages`,
`contract_bids`, `contract_performance`, `warranty_*`, `supplier_deliveries`. Canonical
Contract ruling on D6.05/08: grow `contract_packages`' award side; `warranty_terms` stays
the warranty leg; contract legal compliance stays a §70 human determination.

## 15. Authority / audit / security platform — `authority_limits`, `decision_rights`, `audit_events`, `security_events`

| D-item | Verdict | Ruling |
| --- | --- | --- |
| D3.34 AuthorityRule §43 | EXTEND | `authority_limits` (versioned, adopted, trigger-enforced) gains action_type (sanction, regulatory_variance), org-level, competency. `decision_rights` stays the tier policy (its five demoted rights are the cautionary tale — consumers or it's policy, not enforcement). **No third authority store.** |
| D3.32/33 RBAC+ABAC, SoD | EXTEND | RLS + definer RPC pattern; 3 of 4 SoD pairs still to enforce, Invariant lane. |
| D11.31 audit ledger | EXTEND | `audit_events` (SELECT-only to clients, 60 definer insert sites). Add prev/new capture + explicit update/delete-block trigger. **AGENTS invariant 8 forbids a parallel audit log.** |
| D11.24 §70 set | EXTEND | 4 of 7 determinations enforced today; each new D-object ships its prohibition trigger day one. |
| D3.19/20 waivers | EXTEND | `standard_site_variances` generalized (subject beyond standards) + `expire_governance_instruments` sweep; make expiry NOT NULL. One waiver model. |

## 16. RIA workspace — `ria_*` (migrations `20260918100000`+)

Stays assessment-scoped. Contributes patterns, not homes: governed checkpoint write
contract (`record_ria_verification`) → D9.03; evidence-grade recompute discipline →
D11.18; `ria_decisions`/findings remain consumers of the canonical stores per the rulings
above.

---

## Consolidated CONFLICT index (the rulings, in one place)

1. **Gate** → `stage_gate_*` + `assessGate` canonical; generalize + extend enum (D3.24); framework checkpoints = lighter gate rows on the same family (D3.37).
2. **Stage vocabulary** → `lifecycle_stages` canonical; framework stages map to stage_keys (D3.23/D11.10).
3. **Evidence** → `evidence_items` canonical; ria grades scoped consumers (D11.17).
4. **Decision** → `decisions` canonical; options = generalized `scenarios` (D3.27/28).
5. **Assumption** → `risk_assumptions` family canonical + `financial_assumptions` numeric leg (D2.06/D3.29).
6. **Constraint** → `restoration_constraints` + signals canonical; generalize scope (D7.18).
7. **Work-package checklist** → Recovery readiness machinery canonical (D7.05).
8. **WorkPackage store** → `work_orders` stays the work identity; AWP packages wrap it (D7.17).
9. **Lesson** → `learning_events` extended; taxonomy branch for delivery failures (D9.11).
10. **TechnicalDebt** → `temporary_modifications` extended (D8.02).
11. **Benefit** → `value_metrics` extended (D9.10).
12. **Checkpoints** → RIA/verify_value_metric loop extended; no third checkpoint store (D9.03/D9.13).
13. **Contract** → `contract_packages` grown; `warranty_terms` = vendor warranty only; internal performance warranty lives on `ram_targets` (D6.05/08, D9.02).
14. **AuthorityRule** → `authority_limits` extended (D3.34).
15. **Decision Workspace persistence** → re-point at `decisions`; localStorage never system of record (D13.07).
16. **Audit** → `audit_events` extended; no parallel ledger (D11.31).
17. **Readiness items** → onboarding requirement catalog extended (D8.08).
18. **HOP** → `human_performance_events` wired, no-person invariant carried forward (D12.03/D11.01).

_Recurring demoted-pattern warning (verified 2026-08-27): `workforce_members`/`member_competencies` (demo-seed only), `human_performance_events` (schema-only), `shutdown_events/tasks` (read RPC only), `add_work_to_outage` (zero callers), `record_verification_result` (zero callers — the register's canonical dead-RPC example), `check_decision_right` (0 app callers; consulted in SQL for 2 of its rights — `produce_schedule_options` 20260806190000:71, `trade_safety_for_production` 20260809090000:486), E7/E8/E9 supplier/design/value tables (demo-seed writes), `warranty_terms`/`warranty_claims` (schema-only — zero refs outside their migration). Every EXTEND verdict that leans on these names includes wiring the write path as part of the work._

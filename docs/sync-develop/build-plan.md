# Sync Develop — Controlled Build Plan

_Created 2026-08-27. Companion to [register.md](register.md) (234 D-family items, tally in
that file) and [overlap-map.md](overlap-map.md) (canonical-home rulings — binding on every
slice). Rule of the plan: **a slice is done when its register rows flip with evidence the
reachability gate accepts** — surface → caller → RPC → persisted → customer-visible — and
`npm run typecheck` + the negative-path tests pass. No slice may create a parallel store;
the overlap map's 18 conflict rulings are preconditions, not suggestions._

_Rows already ✅ (D3.30 assumption-invalidation, D5.23 Control object, D11.35 roadmap
visibility) carry no slice. Every other row appears in exactly one slice below, with two
deliberate start/complete splits: D5.28 and D11.33 start in Slice 1 (marked "(start)") and
complete in Slices 4 and 6 respectively._

---

## Slice 1 — the §79 MVP (first 90 days)

The spec's own twelve capabilities, mapped to D-ids with the reuse rulings applied.
Goal state: **one real development case runs end-to-end through gate readiness** with
honest calculations and human-only gates.

| § | MVP capability | D-ids | Ruling applied | Eng-days |
| --- | --- | --- | --- | --- |
| 1 | Development Case | D1.04, D1.05 | NEW root object; intake is problem-first (no cold "Create Project"); sanction = new `authority_limits` action_type, definer-RPC only | 5 |
| 2 | Framework / Stage / Gate | D3.01, D3.22, D3.23, D3.24, D3.06, D3.37, D11.10 | ProjectFramework NEW (versioning copies `adopt_risk_criteria`) incl. project_classes + checkpoints members; stages MAP to `lifecycle_stages` stage_keys (add assure/sanction/stabilize/realize/learn master stages); gates = generalized `stage_gate_*` + outcome-enum union (reconcile I.5 vs §6 verbatim conflict, document in migration comment); framework checkpoints = lighter gate rows on the same family (`decision_type='checkpoint'`) | 8 |
| 3 | Gate Requirements | D3.25, D3.14, D3.15 | Columns on `stage_gate_criteria` incl. eight-tier `source_authority`; promotion invariant trigger ships same migration (Invariant lane) | 4 |
| 4 | Deliverables | D3.26 | NEW object linking gate requirements to documents (KB intake docs, C2.15 ✅) | 4 |
| 5 | Evidence | D11.17, D11.18 | Eight-class enum + `verification_status` as columns on `evidence_items` (one evidence model); AI_INFERENCE→verified guard trigger + negative test | 5 |
| 6 | Risk | D5.22 | `development_case_id` on `risks`; gate-readiness consumption of open risks. ZERO new risk tables | 2 |
| 7 | Decision | D3.27, D3.28 | Columns on `decisions`; options = `scenarios` generalized to hang off decisions | 5 |
| 8 | Actions | D11.37 | Pure reuse: the canonical recommendation/action + `verification_obligations` models ARE the action store; the work is case binding + Case Workspace surfacing, register-visible via D11.37. No new store permitted | 1 |
| 9 | Baselines | D5.26 | NEW six-type Baseline; prior versions immutable | 3 |
| 10 | Gate Readiness | D3.35, D13.05 | Weighted Σ(w·r)/Σw added to `assessGate`; mandatory-fail (and never-assessed) still BLOCKS at any percentage; first screen with per-category readiness + named blockers | 5 |
| 11 | Operational Readiness | D8.08, D8.11 | Extend onboarding requirement catalog + `get_golive_readiness` toward system scope (first cut; completed in Slice 8) | 5 |
| 12 | AI Evidence/Gap Agent | D12.07 | Edge function over `evidence_items` + rag-semantic-search; honest "no evidence" answers; advisory only | 4 |
| — | Connectors (doc repo, P6, SAP) | D11.33 (start), D5.28 (start) | Document repository = reuse KB intake (live); P6 = XER/CSV import into the extended shutdown-schedule model (Sync analyzes, never writes back); SAP asset hierarchy = existing governed import. Cost/ERP + procurement-status connectors deferred to Slice 6 | 8 |
| — | Trust overlay | D11.24, D11.32, D11.25, D11.12, D11.34 | Each new object ships its §70 prohibition trigger day one; system-of-intelligence posture; persistence + layer mapping per the tables below | 6 |

**Slice 1 total ≈ 65 eng-days.** Definition of done per capability, uniformly: a signed-in
customer creates/edits the object from a routed surface, the write goes through an
org-scoped definer RPC, rows persist under RLS, the readback renders on the case surface,
and the negative path (unauthorized actor, missing mandatory input, AI-role write) is
tested and refused. Verify as a signed-in user, not the service role.

## Slices 2–11 — everything else, dependency-ordered

Horizons follow the spec's own §83–§85 roadmap: Slices 2–8 ≈ months 3–6, Slices 9–10 ≈
months 6–12, Slice 11 ≈ months 12–24.

| Slice | Theme | D-ids | Unlocks |
| --- | --- | --- | --- |
| 2 | Success contract & value spine | D1.01, D1.02, D2.01–D2.07, D3.29, D9.10, D11.15, D11.16, D13.04, D13.07 | Success defined before design; the economics a case is judged by (13-dimension finance model, sanction deltas, viability thresholds on the canonical assumption family); Objective nesting + risk→objective DB invariant; case workspace v1; Decision Workspace re-pointed at `decisions` (kills the localStorage honesty risk) |
| 3 | Governance depth & tailoring | D3.02–D3.05, D3.07–D3.11, D3.16–D3.20, D3.31–D3.34, D5.24, D5.25, D11.04, D11.14, D11.22, D11.28, D11.31, D12.06, D12.08, D12.12, D13.06 | Risk-based governance intensity as enforcement; conditions/waivers with expiry reversion; stakeholder + regulatory chains; the remaining 3 SoD pairs; composite rules (value>$100M AND risk≥HIGH → independent assurance); audit prev/new capture + append-only trigger; Methodology/Gate/Risk agents; Assurance Case screen |
| 4 | Controls & assurance core | D5.01–D5.09, D5.13–D5.21, D5.27–D5.32, D3.12, D3.13, D3.21, D3.36, D11.29, D13.02, D13.08 | Scope chain (WBS at last), earned value with refusal, estimate/schedule/progress confidence, contingency ledger, baseline-anchored change control on the MOC machinery, P6 import completed, P50/P80 forecasts bound to cases, decision latency/debt, calculation lineage record, Integrated Controls screen, My Decisions cross-domain |
| 5 | Design integrity & digital thread | D4.10–D4.12, D4.16–D4.18, D11.05–D11.07, D11.09, D11.19–D11.21, D11.26, D12.09, D12.10, D12.13 | Requirements/verification write paths wired (kills the `record_verification_result` dead-RPC), frontline dispositions, six-axis scoring, interfaces, the CDE thread + authoritative versions + change receipts, first event-bus events, Requirements/Change-Impact/RAM agents |
| 6 | Procurement & commercial | D6.01, D6.03–D6.09, D11.33 (completed) | Tender→contract→commitment chain on `contract_packages` (write paths for the E7 demo-seed family), commitments feeding the Slice-4 controls model, spec→failure commercial thread, remaining §78 connectors (SAP EAM, cost/ERP, procurement status) |
| 7 | Field execution & quality | D7.01–D7.08, D7.10–D7.14, D7.16–D7.20, D4.01–D4.07, D13.09 | AWP chain wrapping `work_orders`, generalized Recovery constraints/verdicts on project packages, workforce write paths + qualified-when-needed, workface metrics, quality objects (ITP/NCR/defect-rework) + COPQ, Execution Readiness board |
| 8 | Commissioning, transition & handover | D8.01–D8.07, D8.09, D8.10, D4.13–D4.15, D11.08, D11.23, D11.27, D12.14, D12.15, D13.10, D13.11, D13.14 | Commissioning systems + seven-state machine (energization consults `asset_energy_states`/`equipment_releases`), operating-model readiness, technical/operational debt with valuation, HandoverPackage + per-system acceptance, information vs physical readiness split, cyber gate category, the last two governed workflows on the one engine |
| 9 | Realize, learn & portfolio | D9.01–D9.07, D9.11–D9.16, D10.01–D10.06, D2.08, D2.09, D4.08, D4.09, D1.03, D12.05, D12.16, D12.17, D13.03, D13.12, D13.15 | Performance warranty + 30/90/180/365 checkpoints, project FRACAS on the one learning store, lesson auto-screening at case creation, value leakage attribution, programs + cross-project critical path + efficient frontier + double-count detection, sustainability/climate dimensions in option comparison, Benefits/Lessons agents, Portfolio + Benefits screens, executive capital briefing |
| 10 | Assurance intelligence & PMO | D5.10–D5.12, D6.02, D7.09, D7.15, D11.01, D11.30, D12.01–D12.04, D12.11, D12.18, D12.19, D13.01, D13.13 | Pattern-based assurance + reference-class + normalized benchmarking (all refusing below sample thresholds), vendor intelligence, flow efficiency + site change load, HOP wired (non-surveillance negative-tested), scope-creep/controls/governance agents, model registry, PMO workspace + intervention triage, PM gate briefing |
| 11 | The accumulated graph (capstone) | D9.08, D9.09, D11.02, D11.03, D11.11, D11.13, D11.36 | Methodology-outcome learning with human-approved framework revisions; eight-engine + overlay composition; the eight-dimension substrate; the §86 north-star traversal — one real case walked objective→decision→asset→outcome→next decision in-product |

**Dependency spine:** S1 (case/gates/evidence) → S2 (value objects need the case) →
S3 (tailoring needs frameworks; waivers need requirements) → S4 (controls need baselines;
latency needs schedule import) → S5 (thread needs requirements + change) → S6 (commitments
feed controls) → S7 (AWP needs packages + schedule) → S8 (handover needs commissioning +
readiness + debt) → S9 (realization needs benefits + startup data) → S10 (pattern mining
needs accumulated history) → S11 (composition of everything).

## Lane proposals per slice

| Slice | Feature lane | Invariant lane | Honesty lane |
| --- | --- | --- | --- |
| 1 | Case/framework/deliverable/baseline objects, gate readiness screen, evidence agent | source_authority promotion trigger; evidence promotion guard; sanction + gate §70 triggers; RLS on every new table; negative-path tests | Register rows flip only with reachable evidence; MVP row D11.34 stays ❌ until a case runs end-to-end |
| 2–3 | Value objects, tailoring compiler, waiver/condition surfaces, agents | risk→objective NOT NULL trigger; SoD pairs 2–4; waiver expiry NOT NULL + reversion; audit append-only trigger; composite rule evaluator | Decision Workspace re-point (D13.07) — the localStorage record is reclassified, not deleted |
| 4–5 | Controls model, imports, thread views, design write paths | baseline immutability; contingency authority gating; calc lineage; event-bus triggers | schedule-confidence gate on Monte Carlo (refusal/warning, D5.15) |
| 6–8 | Commercial/AWP/commissioning objects + screens | commissioning state triggers; energization consults canonical energy states; handover acceptance human-only; contractor≠owner-acceptance SoD | /handover naming (equipment RTS vs system handover) resolved without breaking the live meaning |
| 9–11 | Realize/portfolio/PMO surfaces + agents | HOP no-person negative test; model-registry re-approval gate; k-anonymity if any cross-tenant comparison ships | pattern/reference-class refusal below sample thresholds — no invented benchmarks |

**Codex live areas (checked 2026-08-27, `gh pr list`):** #256 sync active governed-action
classifier (src classifier area), #253 CI authenticated production commissioning
(workflows), #129 governed Reliability KB persistence (KB/copilot edge-function area),
#112 local reliability launch assets, #104 physics capability bindings (component/pump
DNA). Recovery-area PRs #249/#271 merged into this branch's base (2026-08-26/27), so the
Recovery citations here are post-merge main and no open PR owns that area today. Slice 1's
evidence agent touches the KB/copilot area — **coordinate with #129
before writing there**; ownership is by area, not by file. Before every slice: `git fetch
origin`, re-read open PR titles, and timestamp migrations later than every open PR's.

## Stack honesty — §71–§78 platform items on the real stack

| Spec item | Real mechanism | Status |
| --- | --- | --- |
| PostgreSQL authoritative objects | Supabase Postgres — already the system | Live |
| Graph capability | Postgres FKs + join tables + recursive CTE views (D11.21); traversals like `get_design_feedback_loop` prove the pattern | Pattern live; NO Neo4j — deferred permanently with reason: the 19-edge model is relational |
| Object storage | Supabase Storage + KB intake pipeline (C2.15 ✅) | Live |
| Vector index | pgvector via existing rag-* edge functions | Live |
| Time-series | Existing ingest contract (condition_readings, operating_states) | Live for current needs; dedicated TSDB deferred-with-reason: no D-item requires sub-second series |
| Event bus (5 named events) | Postgres triggers + pg_net/pg_cron (patterns: MOC triggers, hourly `expire_governance_instruments`) | Build per source table (S5+); NO Kafka |
| Workflow engine | The existing trigger/state-machine + SECURITY DEFINER pattern (risk lifecycle, RIA, recovery closeout, approvals) | Live; extend to gate/change/handover; NO Temporal (AGENTS inv. 8) |
| Rules engine | Rules-as-data (`authority_limits`, `engineering_approval_rules`, criteria profiles) + composite condition rows (S3) | Live foundation; NO external rules engine |
| Calculation service | Existing kernels (reliability/modelling/value) + one lineage record (D11.29) | Kernels live; lineage S4 |
| Model registry | New table, seven attributes, re-approval on decision-relevant swap (D11.30) | S10 |
| Audit ledger | `audit_events` extended (prev/new, approval link, block-update trigger) | Live foundation; S3 |
| Integrations §78 | Thin adapters on the `ingest_batch` contract; doc repo + asset hierarchy live; P6 S1/S4; SAP EAM adapter, cost/ERP, procurement status S6 — each deferred item named, none silent | Mixed |

## §70 deterministic boundary — which existing pattern carries each prohibition

| Determination | Mechanism (existing pattern) | Status |
| --- | --- | --- |
| Gate passed | `advance_lifecycle_stage` refuses without recorded human review; `assessGate` mandatory-block; restrictive RLS denies agent-role writes to `stage_gate_reviews`; negative test per `externalRoleWriteGate.test.ts` | Live pattern; case scope S1 |
| Risk accepted | `accept_risk` role+ceiling checks + `enforce_extended_risk_acceptance_authority` trigger | **Live** |
| Regulation satisfied | Regulatory chain objects (S3) ship with definer-RPC-only status transitions requiring Engineering Authority + Compliance roles | S3 |
| Safety barrier adequate | `trg_enforce_safety_gate` + hazard_barriers attestation | **Live** |
| Project sanctioned | New `sanction` action_type on `authority_limits`; BEFORE-trigger rejects case status change outside the authority-checked RPC | S1 |
| Equipment safe to start | `start_restoration_work` + `equipment_releases` + monotonic energy-state triggers; commissioning READY_FOR_ENERGIZATION consults the same canonical records | **Live**; commissioning binding S8 |
| Contract legally compliant | Human attestation field, definer-RPC only; no computed or LLM path exists or will | S6 |

## What we are deliberately NOT building (yet, or ever)

- **Neo4j, Kafka, Temporal, external rules engines, a dedicated TSDB** — ever, for this spec. The relational mappings above are the design, not a stopgap.
- **P6/SAP write-back** — Sync analyzes; systems of record stay systems of record (§77).
- **Reference-class, pattern-based assurance, and project benchmarking outputs before an outcomes corpus exists** (S10 ships the machinery with hard refusal below sample thresholds — no invented reference classes).
- **Cross-tenant project benchmarking** — not until a k-anonymity + consent design passes review (same standard as the component-life benchmarks).
- **Monte Carlo on unscored/poor schedules** — blocked or warning-wrapped from the day the score exists (D5.15).
- **Automated framework activation** — every Methodology-Agent proposal stays draft until an authorized human adopts it; seeded ADEM-derived content ships only at INDUSTRY_GUIDANCE/INFERRED and we never market "we digitized ADEM".
- **Per-worker HOP metrics** — structurally excluded (no-person schema), negative-tested when surfaces ship.
- **SIMOPS quantification** (D2.09 term) until brownfield option data gives it a stated basis — the term renders as an explicit gap, not a fabricated number.
- **A second anything** — asset hierarchy, evidence model, decision store, assumption family, constraint model, learning store, audit log, workflow engine, capacity store, gate evaluator. The overlap map's rulings are the contract.

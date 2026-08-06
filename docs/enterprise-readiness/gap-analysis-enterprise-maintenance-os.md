# Gap Analysis — SyncAI vs. the Enterprise Maintenance Operating System Target

_Prepared 2026-08-04. Target state: the "enterprise maintenance operating
system, not one unrestricted chatbot" specification (12 specialized agents,
9 core requirements, 12 enterprise additions, the universal asset-intensive
layer, and the five-engine architecture). Current state: the
[Product Capability Audit (2026-08-03)](../product-capability-audit-2026-08-03.md)
plus live evidence produced 2026-08-04 (real 15-month fleet ingest: 26 units,
6,000 failure-coded work orders, history-derived health, measured onboarding
autonomy 47.5% → 56.9% after operator-provided make/model)._

**Scoring:** ✅ Present (working, evidenced) · 🟡 Partial (foundation exists,
material work remains) · ❌ Absent (not started or concept only).

---

## 0. The headline finding

**SyncAI's kernel philosophy already matches the spec's corrected objective.**
The target explicitly rejects "let the GPT run maintenance autonomously" in
favor of _"a decision and coordination system that recommends, automates
low-risk administrative work, and keeps accountable humans in control."_ That
is SyncAI's existing architecture: HITL approval boundary, no-invention rules,
evidence-attributed recommendations, append-only audit. This is a genuine
architectural head start — most competitors will have to _retrofit_ governance;
SyncAI has to _extend_ capability.

**Where SyncAI actually is on the spec's own deployment ladder (§9):**

| Spec stage                                                                        | Status                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 1 — one area: clean data, work history, KPI baseline, bad actors            | ✅ **Demonstrated on real data** (26-unit AHS fleet, 15-month history, bad-actor ranking, KPI baseline) — with the caveat that ingest was file-based, not connector-based |
| Stage 2 — work management: screening, planning assist, materials, weekly schedule | 🟡 Work orders, backlog, briefing views exist; notification screening, planner assist, materials checks, schedule optimization absent                                     |
| Stage 3 — reliability: FRACAS, RCA, PM optimization, Weibull, defect elimination  | 🟡 FRACAS closeout + RCA/PM agents exist; **no computed Weibull/PMO engines**                                                                                             |
| Stage 4 — predictive: historian + CM with operating context                       | ❌ Simulated telemetry only; no production historian connector                                                                                                            |
| Stage 5 — site control: loss forecasting, risk-based backlog, outage optimization | ❌                                                                                                                                                                        |
| Stage 6 — enterprise federation                                                   | ❌ (single-tenant-per-org model exists; federation architecture absent)                                                                                                   |

**Net position: a governed Stage 1–2 system with Stage 3 scaffolding — an
"advanced reliability assistant with an operating-system skeleton."** The spec
is the right definition of "done."

---

## 1. The twelve specialized roles (spec §1)

SyncAI has ten chartered LLM agent types with body-of-knowledge prompts and a
shared asset model. The spec demands **separate authority, tools, and approval
limits per role** — today all ten share one authority envelope (differentiated
by user role at the UI/RPC layer, not per-agent).

| Spec role                | SyncAI today                                                                 | Gap                                                                       |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Maintenance Executive    | 🟡 Executive persona + KPI/RACI views                                        | No budget/strategy authority model                                        |
| Site Maintenance Manager | 🟡 Manager persona + work views                                              | No constraint/escalation ownership                                        |
| Reliability Engineer     | ✅ Chartered agent + FMEA/RCM concepts + real bad-actor data                 | Weibull engine missing (→ §7)                                             |
| Planner                  | 🟡 Chartered agent + briefing view                                           | No job-scope/task-list/estimate tooling against CMMS objects              |
| **Scheduler**            | ❌ No scheduling agent, no schedule optimization, no frozen-schedule control | New capability                                                            |
| Condition Monitoring     | 🟡 Asset-health agent + sensors + thresholds                                 | Real CM interpretation needs real signals (Stage 4)                       |
| FRACAS/RCA               | 🟡 RCA agent + FRACAS closeout + recurrence data                             | Corrective-action _effectiveness measurement_ loop incomplete (→ §4)      |
| MRO Materials            | 🟡 Spares agent (charter only)                                               | No inventory data model or reorder analytics                              |
| **Shutdown/Turnaround**  | ❌                                                                           | New capability (sector-pack scale)                                        |
| Asset Strategy           | 🟡 PM-strategy agent + onboarding strategy sections                          | No interval-optimization math                                             |
| **Safety Gatekeeper**    | 🟡 HSE agent + safety flags + approval routing                               | Not a _gatekeeper_: no decision-control veto wired into the approval path |
| **Data Steward**         | 🟡 DQ gate in onboarding + register-accuracy KPI                             | No failure-code governance, hierarchy stewardship tooling                 |

**Gap grade: 🟡.** 8 of 12 roles exist at charter level; Scheduler and
Shutdown/TA are absent; the structural gap is **per-agent authority and
approval limits as enforced policy**, not persona prompts.

## 2. Operational data, not just manuals (spec §2)

The spec's eleven data domains vs. SyncAI:

✅ Asset hierarchy/criticality · work orders/backlog · failure modes/cause
codes (now with 6,000 real coded records) · maintenance cost fields ·
safety-critical flags.
🟡 Condition readings (simulated) · production losses (downtime classified in
history; no live loss attribution) · documents/knowledge (ontology + factory
contracts exist; governed end-to-end runtime incomplete — audit P0-3).
❌ **Live CMMS/EAM, historian, inventory/BOM, labor/qualifications, financial
system integrations.** The audit is blunt: no production connectors exist
(P1-1/P1-2). This is the single largest distance to "continuously diagnose,
prioritize, forecast and coordinate."

**Gap grade: ❌→🟡.** File-based ingest is proven; connector-based is not started.

## 3. One enterprise asset and failure taxonomy (spec §3)

SyncAI has: asset classes, criticality, failure-mode fields, FMEA library,
onboarding boundary/failure-definition items (s3), and — as of the real-fleet
work — a demonstrated mapping from an operator's raw event taxonomy into coded
records. It does **not** have: a governed enterprise dictionary (failure vs.
degraded, downtime start/end, maintenance-induced, repeat-failure, deferral
risk definitions as _data_, versioned and enforced), nor loss-attribution
rules. The spec's judgment — "this master-data layer is more important than
another predictive model" — matches the audit's P0-5/P0-6 emphasis.

**Gap grade: 🟡.** Concepts present per-asset; enterprise taxonomy governance absent.

## 4. Closed-loop maintenance process (spec §4)

Detect → … → update strategy: SyncAI implements detect, validate (evidence),
assess, prioritize (urgency/confidence), approve, execute (bounded), capture
(FRACAS closeout), analyze (agents). **The loop's tail is the gap:** corrective
actions today complete at work-order closeout; the spec requires verified
physical correction, causal closure, strategy update, **effectiveness measured
over an operating period, and similar-asset screening**. SyncAI has the data
model to do this (learning events, strategy fields) but not the workflow.

**Gap grade: 🟡.** Front 8 steps present; effectiveness-verification and
fleet-screening loop absent.

## 5. Explicit decision rights (spec §5)

SyncAI enforces _that_ consequential actions need human approval (canonical
runtime, approval-authority contract, prohibited-action boundaries in
inspection intelligence). The spec demands a **three-tier rights matrix as
policy-as-code** (auto-permitted / approval-required / never-autonomous) with
per-action classification, and every recommendation carrying evidence,
assumptions, consequence, confidence, alternatives, and required approver.
SyncAI recommendations carry evidence/confidence/urgency; **alternatives
considered, consequence quantification, and named-approver-by-rule are
missing**; the rights matrix is implicit in code, not a governed artifact.

**Gap grade: 🟡.** Strong boundary, missing codified matrix + recommendation
contract completeness. (Closest to "cheap to close" of all gaps.)

## 6. Balanced KPI hierarchy (spec §6)

Present: 29 ISO 55000 KPIs with RACI, computed with lineage, role-audience
enforced in-database; enterprise outcomes partially covered; MTBF/MTTR/
availability now computable from real history. Missing: the **work-management
health family** (planned-work %, emergency %, schedule compliance, ready
backlog, break-in, planning accuracy, waiting-on-material, rework) — most need
Stage-2 work-management data that doesn't exist yet; **segmentation** by asset
class/criticality/site/regime/failure mode (KPIs are org-scope today);
CM warning lead time; corrective-action effectiveness rate.

**Gap grade: 🟡.**

## 7. Technical calculation engines (spec §7)

The spec's hard requirement: _"calculate through validated code, not
plausible-looking equations."_ SyncAI's deterministic-physics foundation
(governed calculations, approved-source-only limits) is exactly the right
chassis — but the **reliability-math library on top is absent**: no Weibull/
censored life-data, RBD, Crow-AMSAA, Monte Carlo, spares optimization,
age-replacement/interval optimization, PMO logic, FTA/ETA, cost forecasting,
schedule-risk, or survival models. The 6,000-WO dataset is an immediate,
real testbed for the first four.

**Gap grade: ❌ (library) on ✅ (chassis).** Highest capability-per-effort
opportunity in the entire analysis: Weibull + Crow-AMSAA + availability
modeling on the existing physics pattern, validated against the real fleet.

## 8. Operating mandate (spec §8)

SyncAI's charters + core principles already encode ~70% of the mandate
(no-invention, assumptions labeled, escalation, safety-first, HITL). Missing
mandate elements: the eleven-field consequential-recommendation contract
(alternatives, required completion date, verification method), and the
enterprise assurance framing (process safety, integrity, cyber, regulatory,
human performance, financial, accountability) as _operating_ scope rather
than aspiration.

**Gap grade: 🟡.** Largely a governance-artifact and prompt/contract upgrade.

---

## 9. The twelve enterprise additions

| #   | Addition                                 | Status | Note                                                                                                                                                                                                                                |
| --- | ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Industry operating profiles              | 🟡     | Mining/process DNA packs exist (ball mill, thickener audits); no profile _architecture_ separating risk models per sector                                                                                                           |
| 2   | **Process safety & asset integrity**     | ❌     | The spec calls this the largest gap for Suncor/Shell and it is SyncAI's too: no barrier registers, bow-ties, IOWs, RBI, SIS proof-testing, MOC-for-integrity, impairment control. Inspection-intelligence contracts are a seed only |
| 3   | Operations–maintenance integration       | ❌     | No operating-context, release/RTS coordination, permits/isolations, opportunity maintenance                                                                                                                                         |
| 4   | Enterprise governance (DoA, SoD, audit)  | 🟡     | Approval authority contract + decision traceability exist; DoA limits, segregation-of-duties, records retention, internal audit absent                                                                                              |
| 5   | AI safety, cyber, model risk             | 🟡     | Strong platform security posture (see compliance pack) + approval boundary; model registry/eval/red-team/drift (audit P1-4), OT separation, offline procedures absent                                                               |
| 6   | Human factors & workforce                | ❌     | Audit P1-7 matches: competency, fatigue, crew, contractor quals, mobile/offline field usability                                                                                                                                     |
| 7   | Contractor & supplier management         | ❌     |                                                                                                                                                                                                                                     |
| 8   | Capital projects / reliability by design | 🟡     | Onboarding captures design-basis items; no RAM allocation, FAT/SAT, handover, warranty workflows                                                                                                                                    |
| 9   | Financial & value controls               | 🟡     | **Value-state discipline already implemented** (projected/observed/validated/verified — ahead of most incumbents); LCC/NPV/risk-adjusted cases absent                                                                               |
| 10  | Environmental & sustainability           | 🟡     | HSE agent + flags; no emissions/energy/fugitive consequence model in criticality                                                                                                                                                    |
| 11  | Enterprise resilience modes              | ❌     | No normal/degraded/emergency/recovery operating modes                                                                                                                                                                               |
| 12  | Data governance & digital architecture   | 🟡     | DQ gate, lineage on KPIs, canonical-model intent; sensor validation/calibration/time-sync (audit P0-5) absent                                                                                                                       |

## 10. The universal asset-intensive layer (condensed)

Of the 24 universal additions, SyncAI has partial foundations for: mission
framing (mission-assurance positioning + readiness question generalizes
beyond production), asset ontology breadth (fixed + mobile demonstrated),
evidence provenance and confidence tiers (knowledge-authority model),
uncertainty labeling, and federated packs _as intent_ (target-state doc).
Effectively absent: systems-of-systems dependency modeling, linear/network
assets, full lifecycle (concept→disposal), jurisdiction packs, configuration
& baseline management (as-built vs as-maintained), service/product quality
linkage, community/public consequence, geospatial intelligence, portfolio
optimization, multi-party ownership models, contractual SLA management,
degradation-science breadth, climate resilience, emergency command, model
applicability envelopes, maturity assessment, adoption management, and the
codified ethical boundaries.

**This layer is correctly sequenced LAST.** The spec itself says: prove one
site, one unit, 100–300 critical assets first. Do not let universality pull
focus from Stages 2–4.

## 11. Five-engine architecture mapping

| Engine           | SyncAI today                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Mission engine   | 🟡 Readiness question + KPI outcomes; no formal service/consequence model                               |
| Asset engine     | 🟡 Strongest: DNA, twins, condition, criticality, real history; no dependencies/configuration baselines |
| Work engine      | 🟡 Recommendations→approval→bounded work→closeout; no planning/scheduling optimization                  |
| Assurance engine | 🟡 Approval authority, audit, security; no process-safety, model-risk, regulatory registers             |
| Value engine     | 🟡 Value states + pilot scorecard; no LCC/portfolio optimization                                        |

The architecture does not need re-platforming — the five engines are a
_re-organization and extension_ of layers that already exist.

---

## 12. Reconciliation with the existing audit (one roadmap, not two)

The audit's P0 list (identity/authorization, canonical runtime, knowledge
runtime, data trust, change assurance) is **necessary but not sufficient** for
this target: it hardens the platform. The spec adds the _operating-system
organs_. Merged sequence:

**Now → pilot-credible (audit P0 + cheapest spec wins)**

1. Audit P0 items (already planned).
2. **Decision-rights matrix as a governed artifact** + eleven-field
   recommendation contract (spec §5/§8) — mostly prompt/schema/policy work on
   existing rails.
3. **Reliability-math library v1** on the deterministic-physics chassis:
   Weibull (censored), Crow-AMSAA, availability/RBD, Pareto — validated
   against the 6,000-WO real dataset (spec §7).
4. **Closed-loop tail**: corrective-action effectiveness verification +
   similar-asset screening (spec §4) — extends FRACAS closeout.
5. **Enterprise failure taxonomy** as versioned master data (spec §3).

**Next → Stage 2/3 complete (with audit P1)** 6. One historian + one CMMS connector (audit P1-1/2) — unlocks spec §2 and
the work-management KPI family (§6). 7. Scheduler capability + planner tooling (spec §1) with KPI segmentation. 8. Model registry/eval/drift (audit P1-4) + applicability envelopes (§19
universal). 9. Safety Gatekeeper as enforced veto in the approval path.

**Then → enterprise additions in spec order of consequence** 10. Process-safety & integrity pack (§9-2) — before any process-industry
deployment; sector-profile architecture (§9-1) alongside. 11. Ops-maintenance integration, workforce/human factors, contractor,
financial LCC, resilience modes.

**Later → universal layer** (mission models, dependencies, jurisdiction packs,
portfolio, geospatial, federation) — pulled by the second and third sectors,
not pushed ahead of them.

## 13. The five non-negotiables, scored

| Spec's non-negotiable                             | Status today                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Process-safety & asset-integrity governance       | ❌ Not started (seed contracts only)                                                          |
| AI cybersecurity & decision-control architecture  | 🟡 Best-covered: approval boundary, audit, platform security; model-risk + OT separation open |
| Industry-specific operating profiles              | 🟡 Mining depth real; profile architecture absent                                             |
| Workforce, contractor & human-performance systems | ❌ Not started                                                                                |
| Verified financial & risk-value tracking          | 🟡 Value-state discipline exists; risk-valuation math absent                                  |

## 14. Bottom line

SyncAI is **directionally correct and philosophically aligned** with this
target — the corrected objective ("recommend and prepare; humans control
consequential decisions") describes SyncAI's existing spine, which is the
hardest thing to retrofit and is already real, live-verified, and now
exercised on 15 months of genuine fleet data.

The distance is concentrated in five places: **live integrations** (the data,
not the manuals), **validated reliability mathematics**, **the closed loop's
verification tail**, **process-safety/integrity capability**, and
**decision-rights codification**. Three of those five are extensions of
chassis that already exist. The honest label for today remains the README's:
an advanced pilot with an operating-system skeleton — and this document plus
the capability audit define, without inflation, what "finished" means.

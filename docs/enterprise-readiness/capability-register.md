# Enterprise Operating System — Capability Register

_Program of record, created 2026-08-04. Direction from the product owner:
**every capability in the enterprise-OS specification must exist in the
application — nothing missed, nothing compressed.** This register enumerates
every atomic item of the specification with a stable ID. An item may only be
marked ✅ when the capability demonstrably exists in the application (working
code/data/UI, not documentation), with evidence linked. Status legend:
✅ exists · 🟡 partial foundation · ❌ absent. All ❌/🟡 items are open build
obligations._

_Companion analysis: [gap-analysis-enterprise-maintenance-os.md](gap-analysis-enterprise-maintenance-os.md).
Sequencing: the reconciled roadmap in that document §12. Register updates ship
with the PR that changes an item's status._

---

## CORE — The nine base requirements

### C1 — Specialized agent roles (separate authority, tools, prompts, approval limits per agent)

| ID    | Capability                                                                                               | Status                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1.01 | Maintenance Executive agent — enterprise performance, governance, budgets, risk, strategy                | 🟡                                                                                                                                                                                         |
| C1.02 | Site Maintenance Manager agent — site execution, constraints, production coordination, escalation        | 🟡                                                                                                                                                                                         |
| C1.03 | Reliability Engineer agent — bad actors, failure analysis, Weibull, RCM, FMEA, improvement cases         | 🟡                                                                                                                                                                                         |
| C1.04 | Planner agent — job scopes, task lists, labor, tools, permits, materials, estimates                      | 🟡                                                                                                                                                                                         |
| C1.05 | Scheduler agent — weekly schedule optimization, resource leveling, frozen-schedule control               | 🟡 deterministic schedule options + release/freeze shipped (migration 20260806190000); resource leveling by daily capacity; agent charter pending                                          |
| C1.06 | Condition Monitoring agent — vibration, oil, thermography, motor current, process anomaly interpretation | 🟡                                                                                                                                                                                         |
| C1.07 | FRACAS/RCA agent — incident capture, causal analysis, corrective actions, recurrence tracking            | 🟡                                                                                                                                                                                         |
| C1.08 | MRO Materials agent — critical spares, reorder policies, repairables, stockouts, obsolescence            | 🟡                                                                                                                                                                                         |
| C1.09 | Shutdown/Turnaround agent — scope challenge, critical path, readiness, execution, closeout               | ❌                                                                                                                                                                                         |
| C1.10 | Asset Strategy agent — PM optimization, task intervals, run-to-failure decisions, lifecycle plans        | 🟡                                                                                                                                                                                         |
| C1.11 | Safety Gatekeeper agent — process-safety and occupational-safety decision controls (enforced veto)       | ✅ 12-dimension consequence screening + trigger-ENFORCED veto (migration 20260808120000); approval impossible past an unattested safety gate — proven against a service-role direct UPDATE |
| C1.12 | Data Steward agent — asset hierarchy, failure codes, master data, data-quality management                | 🟡                                                                                                                                                                                         |
| C1.13 | Shared controlled asset model across all agents                                                          | ✅                                                                                                                                                                                         |
| C1.14 | Separate authority per agent (not shared envelope)                                                       | ❌                                                                                                                                                                                         |
| C1.15 | Separate tools per agent                                                                                 | ❌                                                                                                                                                                                         |
| C1.16 | Separate approval limits per agent                                                                       | ❌                                                                                                                                                                                         |

### C2 — Operational data access (governed)

| ID    | Capability                                                                       | Status |
| ----- | -------------------------------------------------------------------------------- | ------ |
| C2.01 | Asset hierarchy, functional locations, equipment classes, criticality            | ✅     |
| C2.02 | CMMS/EAM work orders, notifications, task lists, maintenance plans, backlog      | 🟡     |
| C2.03 | Failure modes, cause codes, damage mechanisms, corrective actions                | 🟡     |
| C2.04 | Process historian, alarms, trips, operating context                              | ❌     |
| C2.05 | Condition-monitoring readings and diagnostic reports                             | 🟡     |
| C2.06 | Production losses, downtime classifications, constraint data                     | 🟡     |
| C2.07 | Bills of material, spare-parts inventory, lead times, repairable/rotable history | ❌     |
| C2.08 | Labor availability, qualifications, contractor capacity, shift calendars         | ❌     |
| C2.09 | Drawings, P&IDs, manuals, procedures, inspection records, engineering standards  | 🟡     |
| C2.10 | Maintenance cost, replacement value, lifecycle capital plans                     | 🟡     |
| C2.11 | Safety-critical equipment registers and regulatory obligations                   | 🟡     |
| C2.12 | CMMS/EAM integration                                                             | ❌     |
| C2.13 | Historian integration                                                            | ❌     |
| C2.14 | Data-lake integration                                                            | ❌     |
| C2.15 | Document-management integration                                                  | ❌     |
| C2.16 | Scheduling-tool integration                                                      | ❌     |
| C2.17 | Inventory-system integration                                                     | ❌     |
| C2.18 | Financial-system integration                                                     | ❌     |
| C2.19 | Condition-monitoring platform integration                                        | ❌     |

### C3 — Enterprise asset and failure taxonomy (governed master data)

| ID    | Capability                                                                  | Status                                                                                                                                      |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C3.01 | Definition: what constitutes a failure                                      | ✅ governed definition v1 (draft/adopt lifecycle; migration 20260806170000)                                                                 |
| C3.02 | Definition: functional failure vs degraded performance                      | ✅ governed definition v1                                                                                                                   |
| C3.03 | Definition: equipment boundary                                              | ✅ governed definition v1                                                                                                                   |
| C3.04 | Definition: downtime start and end                                          | ✅ governed definition v1                                                                                                                   |
| C3.05 | Definition: maintenance-induced failure                                     | ✅ governed definition v1                                                                                                                   |
| C3.06 | Definition: repeat failure                                                  | ✅ governed definition v1 (enforced measurably by CA-effectiveness loop)                                                                    |
| C3.07 | Definition: emergency work                                                  | ✅ governed definition v1                                                                                                                   |
| C3.08 | Definition: deferral risk                                                   | ✅ governed definition v1                                                                                                                   |
| C3.09 | Definition: failure mechanism, mode, cause, consequence                     | ✅ governed definition v1                                                                                                                   |
| C3.10 | Definition: production loss attribution                                     | ✅ governed definition v1                                                                                                                   |
| C3.11 | Definition: safety-, environmental-, business-critical assets               | ✅ governed definition v1                                                                                                                   |
| C3.12 | Taxonomy as versioned, enterprise-governed master data (not per-asset text) | ✅ taxonomy_definitions: versioned, org-scoped, draft→adopt→supersede lifecycle, RPC-only writes, /governance panel; adoption live-verified |

### C4 — Closed-loop maintenance process

| ID    | Capability                                                  | Status                                                                                                                                                           |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C4.01 | Detect                                                      | ✅                                                                                                                                                               |
| C4.02 | Validate                                                    | ✅                                                                                                                                                               |
| C4.03 | Assess consequence                                          | 🟡                                                                                                                                                               |
| C4.04 | Prioritize                                                  | ✅                                                                                                                                                               |
| C4.05 | Plan                                                        | 🟡                                                                                                                                                               |
| C4.06 | Schedule                                                    | 🟡 weekly options + frozen release; outage/critical-path scheduling absent                                                                                       |
| C4.07 | Execute (bounded, approved)                                 | ✅                                                                                                                                                               |
| C4.08 | Verify                                                      | 🟡                                                                                                                                                               |
| C4.09 | Capture failure data (FRACAS closeout)                      | ✅                                                                                                                                                               |
| C4.10 | Analyze                                                     | ✅                                                                                                                                                               |
| C4.11 | Correct                                                     | 🟡                                                                                                                                                               |
| C4.12 | Update strategy                                             | 🟡                                                                                                                                                               |
| C4.13 | CA completion: physical correction verified                 | ✅ human attestation via attest_ca_stage (migration ..._ca_effectiveness_loop; /reliability panel)                                                               |
| C4.14 | CA completion: causal mechanism addressed                   | ✅ human attestation stage                                                                                                                                       |
| C4.15 | CA completion: documentation and asset strategy updated     | ✅ human attestation stage                                                                                                                                       |
| C4.16 | CA completion: effectiveness measured over operating period | ✅ deterministic recurrence measurement (evaluate_ca_effectiveness, hourly); live-proven on T301 (Engine Group recurred in 12 days → ineffective → governed rec) |
| C4.17 | CA completion: similar assets screened for exposure         | ✅ screen_similar_assets exposure computation + panel                                                                                                            |

### C5 — Explicit decision rights (enforced policy, not convention)

| ID    | Capability                                                                                               | Status                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| C5.01 | AUTO: clean and classify work-order data                                                                 | ✅                                                                                                                                |
| C5.02 | AUTO: draft job plans                                                                                    | 🟡                                                                                                                                |
| C5.03 | AUTO: identify missing materials or documentation                                                        | 🟡                                                                                                                                |
| C5.04 | AUTO: produce weekly schedule options                                                                    | ✅ generate_schedule_options consults check_decision_right live (fail-closed); release reserved to planner/manager; live-verified |
| C5.05 | AUTO: calculate RAM and maintenance KPIs                                                                 | ✅                                                                                                                                |
| C5.06 | AUTO: detect duplicate notifications                                                                     | ❌                                                                                                                                |
| C5.07 | AUTO: flag repeat failures and bad actors                                                                | ✅                                                                                                                                |
| C5.08 | AUTO: recommend inspections or engineering review                                                        | ✅                                                                                                                                |
| C5.09 | AUTO: generate meeting packs and shift handovers                                                         | 🟡                                                                                                                                |
| C5.10 | APPROVAL: change PM intervals                                                                            | 🟡                                                                                                                                |
| C5.11 | APPROVAL: defer critical work                                                                            | 🟡                                                                                                                                |
| C5.12 | APPROVAL: change equipment operating limits                                                              | ✅                                                                                                                                |
| C5.13 | APPROVAL: major repair vs replacement decisions                                                          | 🟡                                                                                                                                |
| C5.14 | APPROVAL: alter safety-critical procedures                                                               | ❌                                                                                                                                |
| C5.15 | APPROVAL: release turnaround scope                                                                       | ❌                                                                                                                                |
| C5.16 | APPROVAL: commit significant expenditures                                                                | ❌                                                                                                                                |
| C5.17 | APPROVAL: create/reschedule safety-critical work                                                         | 🟡                                                                                                                                |
| C5.18 | NEVER: bypass protective systems                                                                         | ✅                                                                                                                                |
| C5.19 | NEVER: override permits or isolations                                                                    | ✅                                                                                                                                |
| C5.20 | NEVER: suppress safety alarms                                                                            | ✅                                                                                                                                |
| C5.21 | NEVER: return equipment to service without authorized verification                                       | 🟡                                                                                                                                |
| C5.22 | NEVER: trade safety or environmental compliance for production                                           | ✅                                                                                                                                |
| C5.23 | Decision-rights matrix as governed, versioned policy-as-code                                             | ❌→build in progress (slice 1)                                                                                                    |
| C5.24 | Recommendation contract: evidence, assumptions, consequence, confidence, alternatives, required approver | 🟡→build in progress (slice 1)                                                                                                    |

### C6 — Balanced KPI hierarchy

| ID    | Capability                                                                     | Status                                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C6.01 | Enterprise: safety and environmental events                                    | 🟡                                                                                                                                                                                                                            |
| C6.02 | Enterprise: production availability                                            | ✅                                                                                                                                                                                                                            |
| C6.03 | Enterprise: maintenance cost per production unit                               | ❌                                                                                                                                                                                                                            |
| C6.04 | Enterprise: total production loss attributable to equipment                    | 🟡                                                                                                                                                                                                                            |
| C6.05 | Enterprise: asset lifecycle risk                                               | 🟡                                                                                                                                                                                                                            |
| C6.06 | Enterprise: capital avoidance and verified benefit                             | ✅                                                                                                                                                                                                                            |
| C6.07 | Work health: planned-work percentage                                           | ❌                                                                                                                                                                                                                            |
| C6.08 | Work health: emergency-work percentage                                         | 🟡                                                                                                                                                                                                                            |
| C6.09 | Work health: schedule compliance                                               | ❌                                                                                                                                                                                                                            |
| C6.10 | Work health: PM compliance                                                     | 🟡                                                                                                                                                                                                                            |
| C6.11 | Work health: ready backlog                                                     | ❌                                                                                                                                                                                                                            |
| C6.12 | Work health: backlog age and risk                                              | 🟡                                                                                                                                                                                                                            |
| C6.13 | Work health: break-in work                                                     | ❌                                                                                                                                                                                                                            |
| C6.14 | Work health: planning accuracy                                                 | ❌                                                                                                                                                                                                                            |
| C6.15 | Work health: waiting-on-material time                                          | ❌                                                                                                                                                                                                                            |
| C6.16 | Work health: rework and repeat work                                            | 🟡                                                                                                                                                                                                                            |
| C6.17 | Reliability: MTBF / event rate by failure mode                                 | 🟡                                                                                                                                                                                                                            |
| C6.18 | Reliability: MTTR and restoration-time components                              | 🟡                                                                                                                                                                                                                            |
| C6.19 | Reliability: availability                                                      | ✅                                                                                                                                                                                                                            |
| C6.20 | Reliability: repeat failures                                                   | 🟡                                                                                                                                                                                                                            |
| C6.21 | Reliability: top production-loss bad actors                                    | ✅                                                                                                                                                                                                                            |
| C6.22 | Reliability: corrective-action effectiveness                                   | 🟡 measured per-CA; % KPI not yet in catalog                                                                                                                                                                                  |
| C6.23 | Reliability: failure-mode elimination rate                                     | ❌                                                                                                                                                                                                                            |
| C6.24 | Reliability: condition-monitoring warning lead time                            | ❌                                                                                                                                                                                                                            |
| C6.25 | Reliability: PM task effectiveness                                             | ❌                                                                                                                                                                                                                            |
| C6.26 | Segmentation by asset class, criticality, site, operating regime, failure mode | 🟡 get_segmented_reliability over asset class / criticality / site / failure mode with data-derived windows (migration 20260808150000; /executive panel). Operating-regime segmentation awaits operating-context data (C2.04) |

### C7 — Technical calculation engines (validated code, not plausible equations)

| ID    | Capability                                             | Status                                                                              |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| C7.01 | Weibull and censored life-data analysis                | ✅ src/lib/reliability censored MLE; 22-test validation suite; live on /reliability |
| C7.02 | Reliability block diagrams                             | ❌                                                                                  |
| C7.03 | Availability and repairable-system modeling            | ✅ repairableSummary + NHPP modeling on real history                                |
| C7.04 | Crow-AMSAA and reliability growth                      | ✅ exact MLE + deteriorating/improving classification                               |
| C7.05 | Monte Carlo risk and production simulation             | ❌                                                                                  |
| C7.06 | Spares optimization                                    | ❌                                                                                  |
| C7.07 | Age-replacement and inspection-interval optimization   | ❌                                                                                  |
| C7.08 | Preventive-maintenance optimization                    | ❌                                                                                  |
| C7.09 | FMEA/FMECA and RCM decision logic                      | 🟡                                                                                  |
| C7.10 | Fault-tree and event-tree analysis                     | ❌                                                                                  |
| C7.11 | Defect elimination and Pareto analysis                 | ✅ pareto() + failure-mode Pareto panel                                             |
| C7.12 | Maintenance-cost forecasting                           | ❌                                                                                  |
| C7.13 | Shutdown critical-path and schedule-risk analysis      | ❌                                                                                  |
| C7.14 | Survival models and condition-based failure prediction | ❌                                                                                  |

### C8 — Operating mandate (management system + recommendation contract)

| ID    | Capability                                                                                                                         | Status                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C8.01 | Verified asset hierarchy, criticality model, equipment-boundary definition                                                         | 🟡                                                                                                                                                       |
| C8.02 | Convert operational requirements into measurable RAM and lifecycle objectives                                                      | 🟡                                                                                                                                                       |
| C8.03 | Monitor condition, work history, production impact, emerging risk                                                                  | 🟡                                                                                                                                                       |
| C8.04 | Identify bad actors, repeat failures, maintenance-induced failures, ineffective PMs                                                | 🟡                                                                                                                                                       |
| C8.05 | FRACAS: capture, analyze, assign, verify, measure effectiveness                                                                    | 🟡                                                                                                                                                       |
| C8.06 | Risk-based strategy development: RCM, FMEA/FMECA, CBM, inspection, TBM, RTF                                                        | 🟡                                                                                                                                                       |
| C8.07 | Executable job plans: scope, sequence, labor, duration, materials, tools, permits, isolations, quality checks, acceptance criteria | ❌                                                                                                                                                       |
| C8.08 | Optimize weekly and outage schedules within safety, operational, resource, material constraints                                    | ❌                                                                                                                                                       |
| C8.09 | Evaluate repair/replace/redesign/defer via lifecycle cost, consequence, uncertainty                                                | ❌                                                                                                                                                       |
| C8.10 | Continuously update strategies from verified field experience                                                                      | 🟡                                                                                                                                                       |
| C8.11 | Recommendation field: asset and functional location                                                                                | ✅                                                                                                                                                       |
| C8.12 | Recommendation field: current condition or problem                                                                                 | ✅                                                                                                                                                       |
| C8.13 | Recommendation field: evidence used                                                                                                | ✅                                                                                                                                                       |
| C8.14 | Recommendation field: failure mode or risk scenario                                                                                | 🟡                                                                                                                                                       |
| C8.15 | Recommendation field: safety, environmental, production, financial consequence                                                     | ❌ (slice 1)                                                                                                                                             |
| C8.16 | Recommendation field: recommended action                                                                                           | ✅                                                                                                                                                       |
| C8.17 | Recommendation field: alternative actions considered                                                                               | ❌ (slice 1)                                                                                                                                             |
| C8.18 | Recommendation field: required completion date                                                                                     | ❌ (slice 1)                                                                                                                                             |
| C8.19 | Recommendation field: confidence and uncertainty                                                                                   | ✅                                                                                                                                                       |
| C8.20 | Recommendation field: required human approval (named authority)                                                                    | 🟡 (slice 1)                                                                                                                                             |
| C8.21 | Recommendation field: method for verifying effectiveness                                                                           | ❌ (slice 1)                                                                                                                                             |
| C8.22 | Never invent missing operational data; label assumptions                                                                           | ✅                                                                                                                                                       |
| C8.23 | Never authorize bypasses, unsafe operation, unapproved deferrals, RTS decisions                                                    | ✅                                                                                                                                                       |
| C8.24 | Escalate safety-critical, process-safety, regulatory, unacceptable-risk conflicts                                                  | ✅ consequence_dimensions reference data with per-dimension escalation authority; gatekeeper clearance recorded with identity, time and substantive note |
| C8.25 | Optimize the whole system, not a single KPI                                                                                        | 🟡                                                                                                                                                       |

### C9 — Progressive deployment

| ID    | Capability                                                                                            | Status                      |
| ----- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| C9.01 | Stage 1: one area — clean data, work history, KPI baseline, bad actors                                | ✅ (real fleet, file-based) |
| C9.02 | Stage 2: notification screening, planning assist, materials checks, weekly scheduling                 | ❌                          |
| C9.03 | Stage 3: FRACAS, RCA, PM optimization, Weibull, defect-elimination governance                         | 🟡                          |
| C9.04 | Stage 4: historian + condition monitoring with operating context                                      | ❌                          |
| C9.05 | Stage 5: loss forecasting, risk-based backlog, outage optimization                                    | ❌                          |
| C9.06 | Stage 6: enterprise federation — standard methods, site-specific strategies                           | ❌                          |
| C9.07 | Measured pilot proof: emergency work, repeat failures, availability, backlog quality, production loss | 🟡                          |

---

## ENT — The twelve enterprise additions

### E1 — Industry operating profiles

| ID    | Capability                                                                                                                    | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| E1.01 | Common reliability kernel + specialized profile architecture                                                                  | ❌     |
| E1.02 | Oil sands/upstream profile: mining fleets, extraction, tailings, pipelines, upgrading, corrosion, erosion, extreme weather    | 🟡     |
| E1.03 | Refining/chemicals profile: process safety, pressure containment, rotating equipment, inspection, turnarounds, barrier health | ❌     |
| E1.04 | High-volume manufacturing profile: takt, OEE, robotics, automation, quality losses, bottlenecks, rapid changeover             | ❌     |
| E1.05 | Battery/energy profile: thermal management, HV safety, electrochemical degradation, fire risk                                 | ❌     |
| E1.06 | Differentiated risk models/workflows per failure context (compressor trip ≠ haul truck ≠ weld defect)                         | ❌     |

### E2 — Process safety and asset integrity

| ID    | Capability                                                             | Status                                                                                             |
| ----- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| E2.01 | Safety-critical equipment and barrier registers                        | ❌                                                                                                 |
| E2.02 | Bow-tie and major-accident hazard models                               | ❌                                                                                                 |
| E2.03 | Integrity operating windows                                            | ❌                                                                                                 |
| E2.04 | Pressure equipment and piping integrity                                | ❌                                                                                                 |
| E2.05 | Corrosion-management circuits                                          | ❌                                                                                                 |
| E2.06 | Risk-based inspection                                                  | ❌                                                                                                 |
| E2.07 | Safety-instrumented systems and proof testing                          | ❌                                                                                                 |
| E2.08 | Relief-device management                                               | ❌                                                                                                 |
| E2.09 | Alarm-system performance                                               | ❌                                                                                                 |
| E2.10 | Leak, loss-of-containment, environmental risk                          | ❌                                                                                                 |
| E2.11 | Management of change (integrity)                                       | 🟡                                                                                                 |
| E2.12 | Temporary repairs, overrides, bypasses, impairments control            | ❌                                                                                                 |
| E2.13 | Guard: maintenance optimization never weakens a process-safety barrier | 🟡 enforced veto blocks approval on safety-dimension hits; full barrier/bow-tie model still absent |

### E3 — Operations–maintenance integration

| ID    | Capability                                           | Status |
| ----- | ---------------------------------------------------- | ------ |
| E3.01 | Operator rounds and operator-driven reliability      | ❌     |
| E3.02 | Equipment operating context                          | ❌     |
| E3.03 | Starts, stops, loading, cycling, process excursions  | ❌     |
| E3.04 | Production constraints and bottlenecks               | ❌     |
| E3.05 | Equipment release and return-to-service coordination | ❌     |
| E3.06 | Permit, isolation, lockout dependencies              | ❌     |
| E3.07 | Production-loss forecasting                          | ❌     |
| E3.08 | Opportunity maintenance during interruptions         | ❌     |
| E3.09 | Joint operations–maintenance daily meetings          | ❌     |

### E4 — Enterprise governance

| ID    | Capability                                                                | Status |
| ----- | ------------------------------------------------------------------------- | ------ |
| E4.01 | Global standards vs site-level authority                                  | ❌     |
| E4.02 | RACI and accountable executive ownership                                  | ✅     |
| E4.03 | Delegation-of-authority limits                                            | ❌     |
| E4.04 | Risk-acceptance thresholds                                                | ❌     |
| E4.05 | Segregation of duties                                                     | 🟡     |
| E4.06 | Engineering approval requirements                                         | 🟡     |
| E4.07 | Escalation paths                                                          | 🟡     |
| E4.08 | Records retention                                                         | ❌     |
| E4.09 | Regulatory evidence                                                       | 🟡     |
| E4.10 | Internal auditing                                                         | ❌     |
| E4.11 | Recommendation version control                                            | 🟡     |
| E4.12 | Decision traceability: proposer, reviewer, authorizer, evidence preserved | ✅     |

### E5 — AI safety, cybersecurity, model risk

| ID    | Capability                                                  | Status |
| ----- | ----------------------------------------------------------- | ------ |
| E5.01 | Read-only access by default                                 | ✅     |
| E5.02 | Least-privilege permissions                                 | 🟡     |
| E5.03 | OT/IT network separation                                    | ❌     |
| E5.04 | Approved write interfaces, not direct database access       | ✅     |
| E5.05 | MFA and privileged-access management                        | 🟡     |
| E5.06 | Prompt-injection and malicious-document protection          | 🟡     |
| E5.07 | Data-loss prevention                                        | ❌     |
| E5.08 | Model-performance monitoring                                | ❌     |
| E5.09 | Calculation verification                                    | 🟡     |
| E5.10 | Approved-model registers                                    | ❌     |
| E5.11 | Drift and bias detection                                    | ❌     |
| E5.12 | Secure logging                                              | ✅     |
| E5.13 | Disaster recovery                                           | 🟡     |
| E5.14 | Offline operating procedures                                | ❌     |
| E5.15 | Manual fallback processes                                   | ❌     |
| E5.16 | Never control machinery / write to DCS, PLC, safety systems | ✅     |

### E6 — Human factors and workforce management

| ID    | Capability                                                | Status |
| ----- | --------------------------------------------------------- | ------ |
| E6.01 | Competency and certification matrices                     | ❌     |
| E6.02 | Apprenticeship and training plans                         | ❌     |
| E6.03 | Human-performance error analysis                          | ❌     |
| E6.04 | Fatigue and shift-risk controls                           | ❌     |
| E6.05 | Crew composition                                          | ❌     |
| E6.06 | Contractor qualification                                  | ❌     |
| E6.07 | Union and labor-agreement constraints                     | ❌     |
| E6.08 | Specialized-tool and operator availability                | ❌     |
| E6.09 | Knowledge-retention planning                              | ❌     |
| E6.10 | Retirement-risk forecasting                               | ❌     |
| E6.11 | Standard work                                             | ❌     |
| E6.12 | Multilingual procedures                                   | ❌     |
| E6.13 | Field usability on mobile devices                         | ❌     |
| E6.14 | Optimize for actual human capacity, not theoretical hours | ❌     |

### E7 — Contractor and supplier management

| ID    | Capability                       | Status |
| ----- | -------------------------------- | ------ |
| E7.01 | Contractor performance           | ❌     |
| E7.02 | Scope clarity                    | ❌     |
| E7.03 | Bid comparisons                  | ❌     |
| E7.04 | Productivity assumptions         | ❌     |
| E7.05 | Safety qualifications            | ❌     |
| E7.06 | Quality escapes                  | ❌     |
| E7.07 | Warranty recovery                | ❌     |
| E7.08 | Repair-vendor quality            | ❌     |
| E7.09 | Supplier reliability             | ❌     |
| E7.10 | Long-lead components             | ❌     |
| E7.11 | Counterfeit and unapproved parts | ❌     |
| E7.12 | Vendor technical advisories      | ❌     |
| E7.13 | Sole-source exposure             | ❌     |
| E7.14 | Obsolescence risk                | ❌     |

### E8 — Capital projects and reliability by design

| ID    | Capability                              | Status |
| ----- | --------------------------------------- | ------ |
| E8.01 | Design requirements influence           | ❌     |
| E8.02 | RAM allocation                          | ❌     |
| E8.03 | Equipment selection                     | ❌     |
| E8.04 | Maintainability reviews                 | ❌     |
| E8.05 | Access, lifting, removal studies        | ❌     |
| E8.06 | Standardization                         | ❌     |
| E8.07 | Instrumentation requirements            | ❌     |
| E8.08 | Spare-parts provisioning                | ❌     |
| E8.09 | Factory and site acceptance testing     | ❌     |
| E8.10 | Commissioning                           | ❌     |
| E8.11 | Asset-data handover                     | 🟡     |
| E8.12 | Warranty management                     | ❌     |
| E8.13 | Early-life failure elimination          | ❌     |
| E8.14 | Lessons transferred into future designs | ❌     |

### E9 — Financial and value-management controls

| ID    | Capability                                               | Status |
| ----- | -------------------------------------------------------- | ------ |
| E9.01 | Lifecycle cost                                           | ❌     |
| E9.02 | Net present value                                        | ❌     |
| E9.03 | Risk-adjusted business cases                             | ❌     |
| E9.04 | Maintenance budget forecasting                           | ❌     |
| E9.05 | Repair-versus-replace analysis                           | ❌     |
| E9.06 | Capital replacement prioritization                       | ❌     |
| E9.07 | Production-loss valuation                                | ❌     |
| E9.08 | Cost-of-risk calculations                                | ❌     |
| E9.09 | Benefit realization                                      | ✅     |
| E9.10 | Avoided-cost verification                                | ✅     |
| E9.11 | Sensitivity and uncertainty analysis                     | ❌     |
| E9.12 | Distinguish estimated, approved, verified realized value | ✅     |

### E10 — Environmental and sustainability performance

| ID     | Capability                                                  | Status |
| ------ | ----------------------------------------------------------- | ------ |
| E10.01 | Energy efficiency                                           | ❌     |
| E10.02 | Emissions                                                   | ❌     |
| E10.03 | Methane and fugitive releases                               | ❌     |
| E10.04 | Flaring                                                     | ❌     |
| E10.05 | Water use                                                   | ❌     |
| E10.06 | Waste generation                                            | ❌     |
| E10.07 | Lubricant and chemical loss                                 | ❌     |
| E10.08 | Battery and hazardous-material handling                     | ❌     |
| E10.09 | Environmental compliance                                    | 🟡     |
| E10.10 | Equipment efficiency degradation                            | ❌     |
| E10.11 | Environmental consequence in criticality and prioritization | ❌     |

### E11 — Enterprise resilience

| ID     | Capability                                            | Status |
| ------ | ----------------------------------------------------- | ------ |
| E11.01 | Wildfire and smoke                                    | ❌     |
| E11.02 | Flooding and extreme cold                             | ❌     |
| E11.03 | Grid interruptions                                    | ❌     |
| E11.04 | Cyber incidents                                       | 🟡     |
| E11.05 | Supply-chain disruption                               | ❌     |
| E11.06 | Utility failures                                      | ❌     |
| E11.07 | Labor shortages                                       | ❌     |
| E11.08 | Major equipment loss                                  | ❌     |
| E11.09 | Site evacuation                                       | ❌     |
| E11.10 | Emergency shutdown                                    | ❌     |
| E11.11 | Communications failure                                | ❌     |
| E11.12 | Normal, degraded, emergency, recovery operating modes | ❌     |

### E12 — Data governance and digital architecture

| ID     | Capability                                | Status |
| ------ | ----------------------------------------- | ------ |
| E12.01 | Canonical asset model                     | 🟡     |
| E12.02 | Equipment naming standards                | 🟡     |
| E12.03 | Data ownership                            | ❌     |
| E12.04 | Data-quality service levels               | ❌     |
| E12.05 | Sensor validation                         | ❌     |
| E12.06 | Calibration status                        | ❌     |
| E12.07 | Time synchronization                      | 🟡     |
| E12.08 | Data lineage                              | 🟡     |
| E12.09 | Failure-code governance                   | ❌     |
| E12.10 | Document revision control                 | 🟡     |
| E12.11 | Historian-context mapping                 | ❌     |
| E12.12 | Duplicate-asset detection                 | ❌     |
| E12.13 | Archived and obsolete information control | ❌     |
| E12.14 | Data residency and sovereignty            | 🟡     |

---

## UNI — The universal asset-intensive layer

### U1 — Mission/service delivery outcomes

| ID    | Capability                                                                                                                                                           | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U1.01 | Mission-outcome models per organization type (utility, water, rail, airline, hospital, municipality, data centre, mining, manufacturing, defence, property, telecom) | ❌     |
| U1.02 | Universal objective: protect/improve mission delivery through safe, reliable, resilient, economic assets                                                             | 🟡     |

### U2 — Systems-of-systems modeling

| ID    | Capability                     | Status |
| ----- | ------------------------------ | ------ |
| U2.01 | Functional dependency models   | ❌     |
| U2.02 | Network topology               | ❌     |
| U2.03 | Common-cause failures          | ❌     |
| U2.04 | Shared utility dependencies    | ❌     |
| U2.05 | Cascading-failure analysis     | ❌     |
| U2.06 | Capacity and bottleneck models | ❌     |
| U2.07 | Geographic dependencies        | ❌     |
| U2.08 | Service-level consequences     | ❌     |
| U2.09 | System restoration sequencing  | ❌     |

### U3 — Universal asset ontology

| ID    | Capability                                                                                            | Status |
| ----- | ----------------------------------------------------------------------------------------------------- | ------ |
| U3.01 | Fixed equipment                                                                                       | ✅     |
| U3.02 | Mobile fleets                                                                                         | ✅     |
| U3.03 | Linear assets (pipelines, roads, rail, transmission)                                                  | ❌     |
| U3.04 | Distributed networks                                                                                  | ❌     |
| U3.05 | Civil and structural assets                                                                           | ❌     |
| U3.06 | Buildings and facilities                                                                              | ❌     |
| U3.07 | Electrical infrastructure                                                                             | ❌     |
| U3.08 | Instrumentation and controls                                                                          | 🟡     |
| U3.09 | Software-defined assets                                                                               | ❌     |
| U3.10 | IT and OT infrastructure                                                                              | ❌     |
| U3.11 | Medical and laboratory equipment                                                                      | ❌     |
| U3.12 | Renewable-energy assets                                                                               | ❌     |
| U3.13 | Temporary assets                                                                                      | ❌     |
| U3.14 | Leased assets                                                                                         | ❌     |
| U3.15 | Contractor-owned assets                                                                               | ❌     |
| U3.16 | Natural assets (reservoirs, dams, waterways)                                                          | ❌     |
| U3.17 | Hierarchy: enterprise→service→system→location→asset→assembly→maintainable item→component→failure mode | 🟡     |

### U4 — Complete asset lifecycle

| ID    | Capability                            | Status |
| ----- | ------------------------------------- | ------ |
| U4.01 | Need identification                   | ❌     |
| U4.02 | Options analysis                      | ❌     |
| U4.03 | Concept selection                     | ❌     |
| U4.04 | Design                                | ❌     |
| U4.05 | Procurement                           | ❌     |
| U4.06 | Construction or manufacture           | ❌     |
| U4.07 | Commissioning                         | ❌     |
| U4.08 | Operation                             | ✅     |
| U4.09 | Maintenance                           | ✅     |
| U4.10 | Modification                          | 🟡     |
| U4.11 | Life extension                        | ❌     |
| U4.12 | Replacement                           | ❌     |
| U4.13 | Decommissioning                       | ❌     |
| U4.14 | Disposal, recycling, site restoration | ❌     |

### U5 — Modular sector packs

| ID    | Capability                                                                                                                                           | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U5.01 | Process-industry pack (process safety, pressure containment, corrosion/inspection, SIS, turnarounds, LOC risk)                                       | ❌     |
| U5.02 | Manufacturing pack (OEE/quality losses, takt/bottleneck, robotics, tooling, changeovers, line balancing)                                             | ❌     |
| U5.03 | Fleet/transportation pack (mileage/duty cycles, dispatch availability, route/depot, configuration, regulatory inspections, replacement optimization) | 🟡     |
| U5.04 | Utilities/networks pack (network reliability, outage management, crew dispatch, load/capacity, storm response, restoration prioritization)           | ❌     |
| U5.05 | Buildings/facilities pack (occupant safety/comfort, BAS, energy, fire/life-safety, code compliance, portfolio capital)                               | ❌     |
| U5.06 | Healthcare pack (clinical criticality, device availability, calibration, infection control, patient risk, device traceability)                       | ❌     |
| U5.07 | Civil infrastructure pack (structural condition, inspection ratings, deterioration models, load restrictions, geographic risk, renewal planning)     | ❌     |

### U6 — Jurisdiction and regulatory packs

| ID    | Capability                                                                                                                                                                                                                                                                               | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U6.01 | Configurable jurisdictional layers (inspection intervals, certifications, environmental reporting, electrical codes, pressure regulation, rail/aviation/maritime, medical devices, building codes, worker qualifications, privacy/residency, retention, indigenous/land-use obligations) | ❌     |
| U6.02 | Requirement-class distinction: company standard / industry guidance / contractual / regulatory / statutory / site rule                                                                                                                                                                   | ❌     |
| U6.03 | Guidance never silently becomes mandatory                                                                                                                                                                                                                                                | 🟡     |

### U7 — Configuration and baseline management

| ID    | Capability                                         | Status |
| ----- | -------------------------------------------------- | ------ |
| U7.01 | As-designed, as-built, as-maintained configuration | ❌     |
| U7.02 | Serial-number traceability                         | 🟡     |
| U7.03 | Software and firmware versions                     | ❌     |
| U7.04 | Approved substitutions                             | ❌     |
| U7.05 | Engineering change control                         | 🟡     |
| U7.06 | Temporary modifications                            | ❌     |
| U7.07 | Red-line drawing control                           | ❌     |
| U7.08 | Equipment interchangeability                       | ❌     |
| U7.09 | Product and model variants                         | ❌     |
| U7.10 | Safety-critical configuration identification       | ❌     |
| U7.11 | Baseline reconciliation after outages/projects     | ❌     |

### U8 — Product and service quality linkage

| ID    | Capability                                                                                                                  | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| U8.01 | Asset condition → product quality, service quality, customer impact, regulatory quality, rework/scrap, warranty, reputation | ❌     |

### U9 — Customer, community, public-interest consequences

| ID    | Capability                                                                                                                                                                                                                         | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U9.01 | Consequence model incl. fatality/injury, environmental damage, customer interruption, vulnerable populations, public health, transportation disruption, community trust, infrastructure impact, reputational, political/regulatory | ❌     |

### U10 — Geospatial intelligence

| ID     | Capability                                                                                                                                                                  | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U10.01 | GIS integration, linear referencing, weather/hazard exposure, access routes, crew travel, remote logistics, receptors, regional spares, failure clustering, hazard overlays | ❌     |

### U11 — Enterprise portfolio optimization

| ID     | Capability                                                                                                                                                                                                                                         | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U11.01 | Portfolio optimization across sustaining/growth/regulatory capital, reliability, obsolescence, decarbonization, safety-risk, life extension, modernization, capacity, decommissioning — with risk, benefit, cost, timing, constraints, uncertainty | ❌     |

### U12 — Ownership and service models

| ID     | Capability                                                                                                                      | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U12.01 | Asset relationship models: owned/leased/rented/concession/OEM-maintained/third-party/shared/PPP/customer-owned/supplier-managed | ❌     |
| U12.02 | Party roles: owner, operator, maintainer, engineering authority, risk owner, regulator, insurer, warranty provider, payer       | ❌     |

### U13 — Service-level and contractual management

| ID     | Capability                                                                                                                                                                                                                   | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U13.01 | Availability/response/reliability guarantees, punctuality targets, service standards, maintenance contracts, performance-based logistics, warranties, penalties/incentives, concession requirements — in recommendation risk | ❌     |

### U14 — Materials, chemistry, degradation science

| ID     | Capability                                                                                                                                                                                      | Status |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U14.01 | Degradation library: corrosion, fatigue, creep, erosion, wear, embrittlement, chemical, concrete, timber, insulation ageing, battery, cable, semiconductor, lubricant, coating, soil/foundation | 🟡     |

### U15 — Natural-hazard and climate resilience

| ID     | Capability                                                                                                                                                                                                   | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| U15.01 | Exposure evaluation: heat, cold, flood, wildfire, wind, ice, drought, sea-level, permafrost, seismic, landslide, storm surge, water scarcity — affecting design, intervals, spares, emergency plans, renewal | ❌     |

### U16 — Emergency and restoration command

| ID     | Capability                                                                                                                                     | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U16.01 | Operating modes: normal, elevated risk, emergency response, business continuity, damage assessment, restoration, recovery, post-event learning | ❌     |

### U17 — Knowledge provenance and evidence quality

| ID     | Capability                                                                                                                                                                                              | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U17.01 | Evidence levels: verified measurement, approved inspection, confirmed history, engineering calculation, OEM recommendation, industry reference, similar-asset inference, expert judgment, AI hypothesis | 🟡     |
| U17.02 | Per-recommendation: source, revision, date, applicability, confidence, conflicting evidence, missing evidence, validation status                                                                        | 🟡     |

### U18 — Uncertainty-aware decisions

| ID     | Capability                                                                                                                               | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U18.01 | Condition states: known, estimated, predicted, unknown, conflicting                                                                      | ❌     |
| U18.02 | Probability ranges, confidence intervals, sensitivity, value-of-information, best/worst case, decision thresholds, reassessment triggers | ❌     |

### U19 — Model validation by context

| ID     | Capability                                                                                                                                                        | Status |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U19.01 | Applicability envelopes: asset type, make/model, mechanism, duty, environment, data quality, operating range, training population, validation period, limitations | ❌     |

### U20 — Federated organizational architecture

| ID     | Capability                                                                                                                           | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| U20.01 | Layered packs: universal core → sector → jurisdiction → enterprise → business unit → site → asset, with controlled override approval | ❌     |

### U21 — Interoperability and vendor neutrality

| ID     | Capability                                                                                                                                                                                        | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U21.01 | Open APIs, standard identifiers, import/export, event-driven integration, lineage, vendor-independent calculations, portable models, replaceable connectors, archival formats, platform migration | 🟡     |

### U22 — Organizational maturity assessment

| ID     | Capability                                                                                                                                                                                                                                                                       | Status |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U22.01 | Maturity assessment: leadership, hierarchy, work management, planning/scheduling, failure coding, PM quality, condition monitoring, materials, engineering governance, data quality, workforce, financial integration, AI governance — with maturity-appropriate recommendations | ❌     |

### U23 — Implementation and adoption management

| ID     | Capability                                                                                                                                                                                          | Status |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U23.01 | Stakeholder mapping, role design, process ownership, training, field trials, change-impact, feedback, adoption metrics, procedure updates, incentives, communications, champions, benefits tracking | 🟡     |

### U24 — Explicit ethical boundaries

| ID     | Capability                                                                                                                                                                                                                                                                   | Status |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| U24.01 | Governed prohibitions: hide uncertainty, manipulate metrics, unsafe staffing, discrimination, unverified surveillance data, punishing individuals on model output alone, finance over mandatory safety, accountability obscured behind "the algorithm", fabricated authority | 🟡     |

---

## ARCH — The five engines and final mandate

| ID    | Capability                                                                                                                            | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| A1.01 | Mission engine: service, stakeholders, outcomes, consequence of failure                                                               | 🟡     |
| A1.02 | Asset engine: assets, configuration, condition, dependencies, degradation, lifecycle                                                  | 🟡     |
| A1.03 | Work engine: plan, prioritize, schedule, execute, verify                                                                              | 🟡     |
| A1.04 | Assurance engine: safety, integrity, quality, environment, cyber, regulation, decision authority                                      | 🟡     |
| A1.05 | Value engine: lifecycle cost, risk, performance, resilience, capital allocation                                                       | 🟡     |
| A1.06 | Common evidence and governance layer beneath all engines                                                                              | 🟡     |
| A1.07 | Final mission: federated decision/coordination system translating missions into asset requirements with complete human accountability | 🟡     |

---

## Register statistics

Atomic items tracked: **397** — counted programmatically from the tables
themselves (an earlier hand-stated figure of 307 under-counted; the enumeration
never changed, only the count of it). Current tally: ✅ 66 · 🟡 100 · ❌ 231. _(2026-08-07: reconciled after parallel merges — C7.01/03/04/11 reliability engine, C4.13–17 + C6.22 closed-loop tail, C3.01–12 taxonomy, C5.04 scheduler all verified present on main.)_
Every ❌ and 🟡 is an open obligation of the program. No item may be removed;
items may only change status with linked evidence in the PR that changes them.

# ISO 31000 Risk Operating System

## Product boundary

SyncAI implements an ISO 31000-aligned operating layer. It is not an ISO 31000
certification product and does not certify a customer's framework. It turns the
standard's principles, framework and process into tenant-scoped context,
criteria, risk, control, decision, work, outcome and learning records.

The governing boundary is deliberate:

- SyncAI may assemble evidence, calculate against customer-adopted criteria,
  expose uncertainty, compare alternatives, detect thresholds and route work.
- SyncAI does not invent tolerance, engineering limits, authority or
  competencies.
- Draft context and criteria are diagnostic. Authoritative evaluation requires
  explicit adoption.
- Residual-risk acceptance is time-bounded and requires an adopted authority
  profile, permitted risk kind and exposure, and current competency evidence.
- Operational recommendations continue through the canonical recommendation,
  approval, decision, work-order and verification contracts.

## Canonical architecture

The extension reuses these existing SyncAI planes instead of creating parallel
workflow records:

| Concern                     | Canonical surface                                          |
| --------------------------- | ---------------------------------------------------------- |
| Evidence                    | `evidence_items`                                           |
| Alternatives and treatments | `scenarios`                                                |
| Executable action           | `recommendations`                                          |
| Human authorization         | `approvals` and `decisions`                                |
| Work execution              | `work_orders`                                              |
| Verification                | `verification_obligations`                                 |
| Outcome and learning        | `learning_events`                                          |
| Residual-risk acceptance    | `risk_acceptances`                                         |
| Delegated authority         | `authority_limits`                                         |
| Competency                  | `competencies`, `workforce_members`, `member_competencies` |
| Audit                       | `audit_events`                                             |

The ISO 31000-specific persistence surfaces are context, criteria, the
universal risk object, controls, indicators, stakeholder views, risk links,
framework reviews and maturity assessments. The enterprise extension adds
first-class, versioned objectives and obligations; a stakeholder directory;
sources, consequences, assumptions and likelihood lineage; reusable event
scenarios and stress tests; treatment dependencies; challenges and assurance;
controlled communications; and learning transfer. Every new surface has tenant
RLS; mutation occurs through role-gated, tenant-checking database functions.

## End-to-end operating loop

`Objective → Context → Risk → Control → Decision → Treatment → Work → Outcome → Learning → Updated risk`

1. The implementation copilot records discovery answers, a reviewable roadmap,
   and draft enterprise context and criteria. Industry guidance is retained as
   provenance and never stored as an organization's actual dependency.
2. Accountable leaders configure and separately adopt context and criteria.
3. An assessment defines the decision, objective, boundaries, owners,
   stakeholders, assumptions, biases, limitations, reporting and evidence
   position before leaving draft.
4. Analysis preserves consequence dimensions, likelihood, controls,
   uncertainty, confidence, exposure, complexity, connectivity, capacity,
   velocity and time pressure. Draft criteria force `INVESTIGATE`.
5. Evaluation recommends `ACCEPT`, `MONITOR`, `INVESTIGATE`, `TREAT`,
   `ESCALATE` or `STOP`, but records a pending human decision when authority is
   not satisfied.
6. Treatment alternatives state cost, production, safety, financial,
   downtime, asset-life and objective trade-offs, introduced risks, resources,
   competencies, owner, approver and verification method.
7. A selected executable treatment creates a canonical recommendation. It
   cannot become approved work without the existing approval and decision
   gates.
8. Indicators and control tests update monitoring state and may escalate. They
   cannot accept risk or approve work.
9. Outcomes create learning events and update risk position. Verified outcome
   evidence feeds framework-effectiveness measures.

The implementation record distinguishes three things that must not be
collapsed: customer discovery as the current-state input, a preliminary gap
assessment bounded to those unverified answers, and the separately governed
evidence-based maturity assessment. The preliminary assessment always keeps
its maturity score null; feature presence never creates a maturity claim.

## Specification traceability

| Requirement                                        | Implementation evidence                                                                                                                                                  | Execution surface                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| ISO 31000 positioning without certification claim  | Product boundary in UI, cockpit payload and claims register                                                                                                              | Risk page header and governance notice                |
| Integrated principle                               | Risk links to context, site, asset, canonical decisions, work and learning                                                                                               | Cockpit and operating-loop route                      |
| Structured and comprehensive principle             | Universal contract trigger and decision-bound scope                                                                                                                      | Assessment form and database contract                 |
| Customized principle                               | Versioned context-specific criteria and industry focus packs                                                                                                             | Context and criteria tab                              |
| Inclusive principle                                | Stakeholder views, concern, rationale and disagreement analysis                                                                                                          | Risk detail consultation section                      |
| Dynamic principle                                  | Indicators, observations, velocity, time to unacceptable and adaptation triggers                                                                                         | Controls and maturity tabs                            |
| Best available information principle               | Evidence quality, provenance, assumptions, limitations, confidence and value of information                                                                              | Evidence and analysis actions                         |
| Human and cultural factors principle               | Bias review, named owners, competencies and separate risk, control, treatment and decision ownership                                                                     | Assessment, authority and treatment forms             |
| Continual improvement principle                    | Outcomes, verification, learning and framework-effectiveness metrics                                                                                                     | Cockpit effectiveness and outcome action              |
| Enterprise-to-activity context hierarchy           | `risk_context_nodes` parent hierarchy with eight scope kinds                                                                                                             | Add-context governance modal                          |
| Mission, objectives and stakeholders               | Context fields and adoption contract                                                                                                                                     | Context cards and add-context form                    |
| Obligations and limits                             | Regulation, financial, safety, environmental, operating-limit and policy fields                                                                                          | Context form and cockpit payload                      |
| Decision authority in context                      | Context authority JSON plus canonical authority profiles                                                                                                                 | Context adoption and authority section                |
| Nine consequence dimensions                        | Safety, environment, production, financial, regulatory, asset integrity, reputation, customer and cybersecurity                                                          | Criteria and assessment forms                         |
| Likelihood and tolerance                           | Versioned scales, thresholds and tolerance statements                                                                                                                    | Criteria configuration                                |
| Control effectiveness and confidence               | Control tests, result, intended effect, failures, score and trend                                                                                                        | Controls and assurance tab                            |
| Exposure, uncertainty, complexity and connectivity | Persisted analysis drivers with weighted adopted criteria                                                                                                                | Assessment and analysis actions                       |
| Time horizon and velocity                          | Scope horizon, velocity and days to unacceptable                                                                                                                         | Assessment, risk drivers and indicators               |
| Cascades and aggregate capacity                    | Risk links, common dependencies and combined capacity calculation                                                                                                        | Aggregate cockpit                                     |
| Criteria ownership and versioning                  | Draft, adopted and superseded states; adopted versions immutable                                                                                                         | New-version, configure and adopt actions              |
| Universal risk object                              | Threat, opportunity or both; source, event, causes, consequences, owners, controls, uncertainty, treatment, monitoring and review                                        | `risks` plus cockpit detail                           |
| Decision-bound assessment scope                    | Decision, outcome, inclusions, exclusions, time, location, resources, responsibilities and relationships                                                                 | New-assessment form and contract gaps                 |
| Identification inputs                              | Evidence source kinds include work history, condition, historian, inspections, incidents, engineering change, supplier, regulation, weather, market, workforce and cyber | Add-evidence action                                   |
| Qualitative and semi-quantitative analysis         | Qualitative analysis and governed multidimensional matrix                                                                                                                | Analysis method selector                              |
| Weibull                                            | Existing censored Weibull engine linked through method registry                                                                                                          | Quantitative method selector and model reference      |
| Monte Carlo                                        | Existing production Monte Carlo engine linked through method registry                                                                                                    | Quantitative method selector and model reference      |
| Fault tree and event tree                          | Existing fault-tree engine linked through method registry                                                                                                                | Quantitative method selector and model reference      |
| Reliability block diagram                          | Existing RBD engine linked through method registry                                                                                                                       | Quantitative method selector and model reference      |
| Bowtie and barrier analysis                        | Existing process-safety hazards and barriers linked through method registry                                                                                              | Quantitative method selector and process-safety panel |
| Markov analysis                                    | New governed Markov state model with probability-mass validation                                                                                                         | Domain API and quantitative method selector           |
| Production-loss and probabilistic-cost analysis    | Existing production-loss RPC and cost-forecast engine linked through method registry                                                                                     | Quantitative method selector and model reference      |
| Evaluation decisions                               | Six explicit actions with adopted-threshold recommendation                                                                                                               | Decision action                                       |
| Authority-aware decision routing                   | Level, kind, exposure and competency gate; pending approval when outside authority                                                                                       | Pending-decision review                               |
| Residual-risk acceptance                           | Named role, rationale, compensating controls, expiry, review and measurable reassessment trigger                                                                         | Accept decision action                                |
| Treatment strategies                               | Avoid, pursue opportunity, remove source, change likelihood, change consequence, share and retain                                                                        | Treatment form                                        |
| Treatment alternatives and trade-offs              | Cost, downtime, production, safety, financial, asset life, residual risk and introduced risks                                                                            | Treatment comparison table                            |
| Treatment executability                            | Resource, competency, owner, approval, completion and verification readiness gaps                                                                                        | Scenario readiness and canonical recommendation       |
| Control library and control-to-risk links          | Named preventive, detective, mitigative, recovery or governance control with intended modifier                                                                           | Add-control action                                    |
| Dynamic indicators                                 | Direction-aware warning and critical thresholds, source, refresh and observations                                                                                        | Add-indicator and observation actions                 |
| Consultation and disagreement                      | Multiple technical, operational, financial, concern and oversight views; spread remains visible                                                                          | Stakeholder section                                   |
| Value of information                               | Expected value calculation compares enquiry cost to uncertainty reduction and wrong-decision cost                                                                        | Value-of-information action                           |
| Bias, assumptions and limitations                  | Required explicit bias review, assumptions, method limits and data quality                                                                                               | Assessment contract and evidence panel                |
| Threat and opportunity                             | `threat`, `opportunity` and `both`, with opportunity score kept separate from downside                                                                                   | Assessment and portfolio filters                      |
| Conflicting objectives                             | Objective trade-offs retained per treatment, never silently netted                                                                                                       | Treatment table                                       |
| Interconnected risk                                | Directed risk links with relationship, dependency, strength and rationale                                                                                                | Link-risk action and aggregate cockpit                |
| Leadership cockpit                                 | Live, critical, accelerating, controls, effectiveness, exposure, capacity, value by currency, site and objective                                                         | Leadership tab                                        |
| Framework effectiveness                            | Realized risks, overdue treatment and review, control failures, acceptance exceedance, verification and decision-cycle metrics                                           | Effectiveness card and attention list                 |
| Maturity model                                     | Evidence-scored 0–5 principles, framework and process; no score inferred from feature presence                                                                           | Maturity modal and tab                                |
| Framework adaptation                               | Regulation, structure, acquisition, technology, asset, weather, supply, workforce, incident and regime triggers                                                          | Record-change modal                                   |
| Management versus oversight                        | Audience views identify execution rights; board and oversight views cannot execute                                                                                       | Audience view and maturity tab                        |
| Audience-specific reporting                        | Technician, supervisor, manager, executive, board and oversight projections from the same risk object                                                                    | Audience-view modal                                   |
| Reporting governance                               | Required audience, frequency, method, timeliness, cost limit and sensitivity profile                                                                                     | Assessment and audience RPC                           |
| Industry templates                                 | Canonical catalog: 15 governed template packs, a buildings/infrastructure focus draft and an organization-defined custom option; maturity is disclosed per selection     | Signup and implementation copilot                     |
| Implementation copilot                             | Complete discovery, durable current-state record and roadmap, draft configuration, deployment, monitoring and improvement stages                                         | Implementation modal, context tab and controlled RPCs |
| Twelve coordinated engines                         | Context, criteria, identification, analysis, evaluation, treatment, execution, assurance, monitoring, learning, governance and evidence                                  | Context tab engine map                                |
| Platform integration                               | Existing asset risk signals, interdependency, process safety, canonical operating loop and ingest evidence contracts remain linked                                       | Risk page and database foreign keys                   |

## Industry catalog governance

Signup and the risk implementation copilot derive their choices from one
canonical industry registry. Existing exact legacy identifiers such as
`oil-gas`, `data-centers`, `power`, `pharma`, `marine`, `military` and
`aerospace` normalize to that registry so older organization metadata does not
split the taxonomy.

The implementation copilot exposes two separate maturity dimensions:

- **Execution readiness** states whether a sector is bound to deterministic
  kernel engines, remains template-only, has draft risk-focus guidance only,
  or is organization-defined.
- **Content validation** states whether the sector content is draft, reviewed,
  customer-validated or deprecated. A kernel-bound pack with draft content is
  not represented as customer-validated policy.

All fifteen governed template packs now bind to executable failure-context
profiles. Buildings/infrastructure is visible as a risk-focus draft; custom
industries capture organization-specific discovery. All generated context and
criteria remain draft until authorized customer adoption.

Corrected 2026-08-24. This paragraph read "Ten sectors currently bind ... the
five remaining governed templates are visible as template-only guidance" — true
when it was written, falsified by #267, which bound food_beverage,
marine_shipping, aviation, defense and aerospace_launch. `template_only` is now
unreachable by construction — `industry-catalog.test.ts` asserts no pack reports
it, and `industry-profiles.test.ts` fails the build if a pack is ever added
without a profile. Kernel-bound still means only that engines bind: every pack's
content remains `draft`, and each pack's unbound claims are named in its
`proseOnly` list rather than counted as coverage.

## Enterprise extension completeness

| Capability                 | Implemented control and execution surface                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governed objectives        | Enterprise-to-task hierarchy, accountable owner, target, measure, timeframe, tolerance, review date, draft/adopted/superseded states and explicit successor-version adoption. Adopting a successor relinks affected risks and forces reassessment.                                                                                                               |
| Governed obligations       | Law, regulation, company and engineering standards, contracts, OEM requirements, policy and voluntary commitments remain distinct from risk. Successor adoption carries applicability forward and forces reassessment.                                                                                                                                           |
| Stakeholder architecture   | Internal and external stakeholder records preserve interests, expectations, influence, communication requirements and maximum information sensitivity.                                                                                                                                                                                                           |
| Identification lineage     | Risk sources and consequences are first-class records tied to canonical evidence, affected objectives and consequence dimensions.                                                                                                                                                                                                                                |
| Assumption lifecycle       | Named owner, confidence, validity window, review trigger and typed dependencies. Invalid or expired assumptions reopen dependent risks and decisions; dependency validation is atomic.                                                                                                                                                                           |
| Likelihood methods         | Expert judgement, frequency, probability, Weibull, Monte Carlo, Bayesian, historical analogue, condition model and event-tree estimates retain interval, data source, sample, confidence, assumptions and model reference.                                                                                                                                       |
| Quantitative helpers       | Deterministic beta-binomial Bayesian update and event-tree calculations join the existing Weibull, Monte Carlo, fault-tree, RBD, bowtie, Markov, production-loss and probabilistic-cost methods.                                                                                                                                                                 |
| Scenario library           | Risk-specific and context-governed reusable event scenarios retain initiating event, causes, conditions, dependencies, escalation paths, consequences, evidence basis and independent validation state.                                                                                                                                                          |
| Stress and reverse stress  | Deduplicated risk sets, complement aggregation, correlation uplift, capacity comparison, contribution lineage and minimum reverse-stress set are persisted with diagnostic, reviewed or adopted state.                                                                                                                                                           |
| Treatment execution        | Canonical treatment scenarios carry sequence, duration, constraints, contingency, monitoring, performance, funding, parts and window readiness; typed dependency edges expose the critical path.                                                                                                                                                                 |
| Control lifecycle          | Engineered, procedural, administrative and compensating types augment the existing library. Temporary/permanent/compensating lifecycle, criticality, failure modes, predecessor/replacement genealogy, effective dates, expiry and mandatory sunset action are governed.                                                                                         |
| Challenge and dissent      | Formal challenges retain subject, field, rationale, evidence and requested information. A challenger cannot resolve their own challenge; upheld challenge forces reassessment.                                                                                                                                                                                   |
| Assurance                  | Line 1, line 2 and independent assurance validate a same-tenant subject, reviewer/owner separation, scope, evidence, findings, actions and conclusion. Unacceptable conclusions force reassessment.                                                                                                                                                              |
| Communication              | Audience, stakeholder, channel, understandable message, decision/action, owner, cost, comprehension and feedback are recorded. External disclosure cannot exceed the stakeholder's sensitivity ceiling.                                                                                                                                                          |
| Monitoring and propagation | Context, objective, obligation, assumption, temporary-control and acceptance changes create explicit reassessment or expiry state through controlled triggers/RPCs.                                                                                                                                                                                              |
| Outcome and learning       | Canonical learning events retain outcome attribution, confidence and context effects. Learning transfer requires a target, applicability decision, adaptation basis and a different reviewer before adoption.                                                                                                                                                    |
| Culture signals            | Overdue action, treatment miss, control override and late-review rates are evidence-only indicators; they are not individual-performance judgements.                                                                                                                                                                                                             |
| Decision operations        | Dedicated My Decisions, treatment portfolio, emerging risk, decision history, culture signal and board evidence views are derived from the same governed records.                                                                                                                                                                                                |
| Extended authority         | Canonical authority adds jurisdiction, asset criticality, decision-value ceiling and independent-assurance threshold. Database triggers enforce these dimensions for decisions and acceptance.                                                                                                                                                                   |
| Sensitivity                | The cockpit, portfolio metrics and decision-operation projections exclude confidential or restricted risks outside caller authority and report the excluded count.                                                                                                                                                                                               |
| Connector bindings         | Existing integration records can bind approved signal, evidence and work mappings for SAP EAM, Maximo, Oracle EAM, historians, SCADA, MES, dispatch, condition monitoring, documents, inspection, finance, workforce, inventory and suppliers. Credentials stay in the platform secret/connector layer.                                                          |
| Advisory agents            | A governed provisioning action creates the ten named context, discovery, evidence, analysis, treatment, decision, control-assurance, monitoring, learning and governance charters on the existing agent registry. Each binds to one of the twelve risk engines in advisory, evidence-only mode; database constraints prohibit agent approval or risk acceptance. |
| Outcome metrics            | The sensitivity-filtered cockpit calculates decision cycle time, risk-to-action cycle time, treatment effectiveness rate, framework effectiveness, objective exposure, accepted-risk exceedance and operating attention measures without counting hidden risks.                                                                                                  |

Connector bindings are implemented product contracts, not a claim that every
third-party system is production-connected. Customer credentials, mappings,
sandbox/customer acceptance tests and write-back change control remain required
for each deployment.

## Security and unsafe-path controls

- New tables use `organization_id` RLS tied to `app_current_org()`.
- Public and anonymous execution is revoked from the controlled functions.
- Security-definer functions resolve and verify the current organization and
  role before writes.
- Context, site, asset, owner, risk and criteria references are checked against
  the same organization.
- Objective successors, obligation successors, assumption dependencies and
  assurance subjects are checked before any dependent record is committed.
- Sensitivity-aware cockpit and decision projections omit records and aggregate
  contributions the caller is not allowed to see.
- Restrictive policies block direct writes to canonical evidence, scenarios,
  recommendations, approvals, decisions, work and learning when the write is
  risk-linked; callers must use controlled functions.
- The database contract prevents incomplete non-draft risk records, including
  missing bias review and reporting governance.
- Indicator automation can change monitoring state and escalation only; it has
  no acceptance or approval path.
- Adopted criteria, objectives, obligations and authority are immutable.
  Configuration requires a new draft version and another human adoption
  decision.
- Risk acceptance rejects missing or expired authority and missing competency.

## Deployment and rollback

Apply these migrations in order through the normal controlled migration
pipeline:

1. `supabase/migrations/20260921110101_iso31000_risk_operating_system.sql`
2. `supabase/migrations/20260921110102_iso31000_enterprise_extensions.sql`
3. `supabase/migrations/20260921110103_iso31000_industry_catalog.sql`

The UI is backward-safe: if the migration is unavailable, `/risk` reports that
condition and preserves the existing asset-risk signals below it. Production
promotion remains a separate, explicitly authorized change.

Rollback should prefer disabling the `/risk` route and controlled functions
while retaining the audit and risk records. A destructive rollback of risk,
decision, acceptance, work or learning data is not appropriate. If database
objects must be retired later, export and archive tenant records first, then use
a separately reviewed forward migration.

## Validation

- Pure domain behavior: `src/lib/risk-operating-system/risk-operating-system.test.ts`
- Canonical catalog, legacy normalization and disclosed pack maturity:
  `src/lib/industry-catalog.test.ts`
- Durable discovery, roadmap, tenant scoping and RPC grants:
  `src/lib/risk-operating-system/industry-catalog-migration.test.ts`
- Persistence, RLS, canonical reuse and unsafe path contract:
  `src/lib/risk-operating-system/risk-migration.test.ts`
- Advanced Bayesian, event-tree, stress, dependency and culture behavior:
  `src/lib/risk-operating-system/advanced.test.ts`
- Enterprise tables, RLS, sensitivity and governed RPC contract:
  `src/lib/risk-operating-system/advanced-migration.test.ts`
- Risk workspace and dedicated enterprise/decision-operation UI:
  `src/pages/RiskOperatingSystemPage.test.tsx`
- Signup catalog and custom-industry capture: `src/pages/Signup.test.tsx`
- SQL compilation: PostgreSQL 16 against the repository's canonical schema
  dependencies
- Behavioral database smoke: base loop, enterprise workflow, objective and
  obligation versioning, segregation of duties, atomic dependency rejection,
  same-tenant assurance, RLS, anonymous denial, direct-write denial and
  sensitivity filtering
- Application integration: production TypeScript and Vite build
- Repository regression: full Vitest suite

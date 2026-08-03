# SyncAI — Industrial Engineering Intelligence for Asset-Intensive Operations

[![CI](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![CodeQL](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/codeql.yml/badge.svg)](.github/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-green.svg)](https://supabase.com)

SyncAI is a governed Industrial Engineering Intelligence platform for mining,
energy, utilities, manufacturing, transportation, defence, aerospace, and other
asset-intensive or mission-critical operations.

It connects engineering knowledge, asset and component models, deterministic
physics, operational evidence, digital twins, reliability workflows, and
human-approved AI agents so teams can make safer and more reliable maintenance,
risk, readiness, and production decisions.

The operating question remains:

> **Can we safely and reliably deliver the production or mission plan?**

The application is available at **[app.syncai.ca](https://app.syncai.ca)**.
Capability maturity varies by module; see [Capability status](#capability-status)
below.

## Core principles

- **Human authority is preserved.** AI can detect, explain, recommend, and draft,
  but safety-, mission-, or production-critical actions require explicit approval.
- **Engineering truth is governed.** Approved source material, provenance,
  applicability, revision status, and authority level are carried with results.
- **Deterministic logic stays separate from generative AI.** Calculations,
  thresholds, rules, and physics are implemented as inspectable capabilities;
  language models do not invent engineering limits.
- **Canonical models are reused.** Asset DNA, shared component DNA, physics
  capabilities, and graph references are linked rather than copied into
  competing stores.
- **Tenant isolation is enforced in the data layer.** Organization and role
  boundaries are implemented with Supabase Row Level Security and controlled
  RPCs.
- **Security and safety are lifecycle properties.** Threat modelling,
  authorization, evidence, change control, monitoring, recovery, and residual
  risk acceptance must continue throughout deployment and operation.
- **The platform advises before it acts.** SyncAI is designed to integrate with
  operational systems without becoming an uncontrolled safety or command path.

## Platform capabilities

### Industrial engineering intelligence

- **Digital Engineering DNA** — manufacturer-neutral asset-class definitions,
  functional systems, failure mechanisms, inspections, controls, and governed
  applicability metadata.
- **Shared Component DNA** — reusable component models that prevent duplicate
  engineering definitions across asset classes.
- **Physics Capability Library** — deterministic, testable engineering
  calculations and reasoning primitives, separated from AI-generated text.
- **Digital Twin Factory** — canonical asset templates with customer, site, and
  model overlays that preserve lineage and approval boundaries.
- **Engineering Knowledge Ontology** — typed entities, canonical references,
  authority levels, review states, provenance, and applicability rules.
- **Knowledge Base Factory** — validation and publication planning before
  engineering content is indexed or exposed to agents.
- **Engineering extraction** — source-backed candidate extraction with
  confidence gates and accepted, ambiguous, unknown, or rejected mapping states.
- **Asset-aware retrieval** — tenant, site, twin, asset-class, component,
  failure-mode, physics, authority, freshness, and supersession filters.

### Operations and reliability

- **Governed operating loop** — telemetry ingestion, condition and KPI breach
  detection, recommendations, human approval, verification, and audit history.
- **Asset onboarding** — RAM and FMEA-oriented onboarding with confidence-based
  evidence gaps and role-based approval gates.
- **ISO 55000-aligned KPI layer** — role-aware operational and asset-management
  measures with lineage and database-enforced access controls.
- **Role command centres** — role-shaped navigation and operational views for
  executives, managers, planners, reliability professionals, and technicians.
- **Chartered engineering and reliability agents** — specialized agents for
  reliability, maintenance strategy, asset health, risk, work management,
  planning, spares, RCA, HSE, coordination, and related engineering workflows.
- **RAG with citations** — retrieved evidence is packaged with source and
  authority metadata; model-generated text is never treated as approved
  engineering authority.
- **FRACAS closeout** — failure coding, verification, and feedback into the
  engineering and reliability learning loop.

## Capability status

| Capability | Current status |
| --- | --- |
| Role-based application, command centres, Supabase backend, RLS, audit controls | Implemented |
| Operating-loop simulation and governed recommendations | Implemented; historian and production integrations are customer-specific |
| Asset onboarding and approval workflow | Implemented foundation |
| Engineering DNA and canonical asset registry | Implemented and expanding by asset class |
| Shared Component DNA and Physics Capability Library | Implemented foundation and expanding |
| Engineering ontology, Knowledge Base Factory, and extraction contracts | Implemented foundation |
| Asset-aware engineering retrieval | In active validation and integration |
| Knowledge graph persistence and graph-query services | Planned / in development |
| Customer-specific digital twins and live sensor integrations | Pilot and deployment work |
| Private-cloud, sovereign, disconnected, and edge deployment patterns | Target-state capability; architecture and certification work required |
| Enterprise identity, privileged-access, policy-as-code, and security operations integrations | Target-state capability; customer-specific integration required |
| Formal safety case, model assurance, red-team evidence, and independent verification packages | Target-state assurance program |
| Autonomous execution against operational control or command systems | Not permitted without separately authorized, bounded, independently assured controls |
| SOC 2 and ISO 27001 certification | Control implementation/readiness work exists; formal audit and certification are separate activities |
| Defence cyber-security certification and controlled-information handling | Not currently certified; target requirements depend on contract, information classification, jurisdiction, and deployment boundary |

For commercial or deployment decisions, use
[`docs/gtm-readiness.md`](docs/gtm-readiness.md) as the capability-versus-promise
reference.

## Target state at completion

At completion, SyncAI is intended to become the governed engineering and
operational-intelligence layer across the full lifecycle of mission-critical
assets. It should continuously convert approved engineering knowledge, asset
configuration, operational data, maintenance history, risk, mission or
production demand, and verified outcomes into traceable decisions and approved
workflows.

The completed platform is intended to provide:

- **Enterprise-wide asset intelligence** across fleets, facilities, business
  units, contractors, sites, and jurisdictions while preserving tenant,
  program, need-to-know, and data-sovereignty boundaries.
- **A broad manufacturer-neutral Engineering DNA library** with governed OEM,
  customer, configuration, environmental, and site overlays.
- **Continuously updated digital twins** connected to approved engineering
  baselines, operating context, inspections, condition data, work history,
  failures, modifications, and configuration state.
- **A persistent engineering knowledge graph** linking assets, components,
  functions, requirements, hazards, controls, failure modes, evidence,
  documents, calculations, decisions, and outcomes.
- **Deterministic engineering and reliability models** operating alongside AI,
  with validation envelopes, applicability constraints, uncertainty, units,
  assumptions, and test evidence.
- **Closed-loop learning** from inspections, maintenance execution, incidents,
  failures, operating changes, and verified results without silently rewriting
  approved engineering truth.
- **Multi-domain integration** with historians, SCADA and DCS read replicas,
  condition-monitoring systems, CMMS and EAM, ERP, PLM, document control,
  GIS, laboratory systems, supply chains, simulation environments, and approved
  mission or production-planning systems.
- **Governed workflow orchestration** that can create, route, simulate, and
  verify recommendations while keeping critical authorization with accountable
  human authorities and approved external systems.
- **Deployment flexibility** for public cloud, private cloud, sovereign cloud,
  customer-controlled infrastructure, industrial edge, intermittently connected
  sites, and appropriately designed disconnected environments.
- **Evidence-ready assurance** for engineering review, cybersecurity
  authorization, procurement, regulatory review, incident investigation,
  certification, and independent audit.

This target state is a roadmap and design direction. It must not be read as a
claim that every capability is currently production-deployed, independently
assured, authorized for a particular environment, or certified.

## Mission-critical enterprise scope

Organizations operating refineries, mines, spacecraft, defence systems,
utilities, transportation networks, and other high-consequence assets require
more than predictive analytics. The platform must earn trust across engineering,
operations, cybersecurity, safety, legal, procurement, and executive governance.
The following scope is therefore part of the desired enterprise product.

### 1. OT-safe and mission-safe integration

- Passive or read-only integration as the default for historians, SCADA, DCS,
  PLC, vehicle, test, and mission systems.
- Explicit trust zones, conduits, data diodes or one-way transfer patterns where
  required, and no assumption of direct internet connectivity.
- Separate advisory, workflow, and control planes, with fail-safe behaviour when
  SyncAI, a model provider, or a network dependency is unavailable.
- Bounded command interfaces only where separately designed, hazard-assessed,
  approved, tested, and authorized by the customer’s technical and operational
  authorities.
- Configuration-aware recommendations that account for asset variant,
  modification state, environment, duty, operating mode, and current approved
  baseline.

### 2. Zero-trust enterprise security

- Enterprise SSO and federation, phishing-resistant MFA, least privilege,
  just-in-time and just-enough administration, privileged-access workflows, and
  machine identities.
- Attribute- and policy-based access controls for organization, site, program,
  asset, information classification, nationality, contract, and need-to-know.
- Encryption in transit and at rest, customer-managed keys, key rotation,
  secrets management, hardware-backed key options, and cryptographic inventory.
- Secure software supply-chain controls, signed builds and artifacts, software
  bills of materials, provenance attestations, dependency governance, and
  vulnerability response.
- Continuous logging, security analytics, anomaly detection, tamper evidence,
  retention controls, and integration with customer SIEM, SOC, SOAR, and case
  management.
- Formal incident response, breach notification, forensic preservation,
  vulnerability disclosure, disaster recovery, and cyber-recovery exercises.

### 3. Controlled and sovereign information handling

- Data residency and sovereignty controls by tenant, program, jurisdiction, and
  deployment.
- Information labelling, classification-aware storage and retrieval, export and
  disclosure controls, legal hold, retention, defensible deletion, and records
  management.
- Segregated environments for sensitive programs and the ability to prevent
  customer data from being used to train shared models.
- Customer-controlled model endpoints, approved model allow-lists, prompt and
  response inspection, data-loss prevention, and model-provider isolation.
- Architecture paths for protected, controlled, export-controlled, proprietary,
  and contractually restricted information, subject to applicable authorization
  and certification.

### 4. AI and model assurance

- A governed model registry recording purpose, owner, version, data sources,
  evaluation results, limitations, risk class, approval state, and retirement.
- Scenario-based testing, adversarial testing, prompt-injection resistance,
  retrieval poisoning controls, hallucination measurement, and regression
  suites tied to high-consequence use cases.
- Calibrated confidence and uncertainty, abstention, contradictory-evidence
  handling, out-of-distribution detection, and mandatory escalation rules.
- Independent verification and validation for critical calculations, models,
  agents, retrieval policies, and workflow logic.
- Full traceability from recommendation to source evidence, canonical model,
  calculation, model version, prompt context, reviewer, approval, execution
  record, and observed outcome.
- No silent model changes in validated deployments; controlled rollout,
  rollback, shadow mode, canary evaluation, and post-change monitoring.

### 5. Safety, reliability, and mission assurance

- Hazard analysis and assurance cases linking hazards, failure conditions,
  safeguards, evidence, residual risk, and accountable approval authorities.
- Support for FMEA/FMECA, FRACAS, reliability-centred maintenance, fault trees,
  bow ties, barrier assurance, configuration control, verification, and
  validation workflows.
- Safety and mission constraints that override optimization goals and remain
  enforceable when AI services are unavailable.
- High availability, graceful degradation, backup and restore, regional or site
  failover, recovery objectives, capacity management, and tested continuity
  plans.
- Evidence that recommendations improve outcomes without increasing operational,
  cyber, environmental, safety, or mission risk.

### 6. Enterprise integration and data governance

- Versioned APIs, event streams, bulk exchange, connector certification, and
  integration observability.
- Canonical data contracts, semantic mapping, master-data alignment, lineage,
  quality rules, reconciliation, and source-system authority.
- Supported connectors for major EAM/CMMS, ERP, historian, PLM, document,
  condition-monitoring, laboratory, GIS, and planning ecosystems.
- Customer-controlled data onboarding, mapping review, exception management,
  and auditable transformation pipelines.
- Open export of customer data, models, evidence, and audit history to reduce
  lock-in and support long-term stewardship.

### 7. Operationalization and procurement readiness

- Reference architectures, threat models, security-control mappings, data-flow
  diagrams, deployment guides, hardening standards, and customer responsibility
  matrices.
- Service-level objectives, support and escalation models, vulnerability and
  patch commitments, maintenance windows, lifecycle policy, and end-of-support
  planning.
- Pilot-to-production gates with measurable technical, safety, cyber,
  operational, and economic acceptance criteria.
- Independent audit reports, penetration tests, resilience exercises,
  certification evidence, supplier-risk information, and escrow or continuity
  options appropriate to customer risk.
- Transparent commercial boundaries covering data ownership, intellectual
  property, derived insights, model use, subcontractors, breach obligations,
  warranties, liability, and exit assistance.

### 8. Executive and portfolio value

- Portfolio-level views of mission readiness, production risk, deferred risk,
  asset health, maintenance effectiveness, supply exposure, critical skills,
  and capital priorities.
- Explainable prioritization that connects engineering risk to operational,
  financial, environmental, safety, and mission consequences.
- Scenario and resilience analysis for outages, supply disruption, workforce
  constraints, configuration changes, severe weather, cyber incidents, and
  other credible operating threats.
- Benefit tracking that distinguishes predicted value from verified value and
  ties decisions to reliability, availability, cost, risk, safety, emissions,
  readiness, and production outcomes.

## Architecture

| Layer | Technology and responsibility |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, Zustand, Framer Motion |
| Backend | Supabase Postgres, Row Level Security, security-definer RPCs, Realtime, scheduled jobs, and Edge Functions |
| Engineering model | Asset DNA, Shared Component DNA, Physics Capabilities, Digital Twin Factory, engineering ontology, and canonical registries |
| Knowledge and AI | Governed ingestion and extraction, asset-aware retrieval, RAG, provenance packaging, and specialized OpenAI/Gemini-backed agents |
| Schema | Ordered SQL migrations in [`supabase/migrations/`](supabase/migrations/) with reproducible local reset and CI validation |
| CI/CD | GitHub Actions for lint, type-check, build, unit tests, migration/auth smoke tests, agent-loop smoke tests, Playwright E2E, CodeQL, secret scanning, and dependency review; deployment from `main` |

### Canonical ownership model

The platform treats canonical stores as sources of truth:

- asset-class and asset-twin definitions live in the asset-twin layer;
- reusable components live in Shared Component DNA;
- deterministic calculations live in the Physics Capability Library;
- knowledge relationships reference canonical IDs instead of copying complete
  records;
- customer and site variations are overlays with provenance and approval state;
- AI outputs remain proposals until accepted through governed workflows.

See
[`docs/architecture/canonical-plane-ownership.md`](docs/architecture/canonical-plane-ownership.md).

## Security and compliance

- Organization-scoped Row Level Security on tenant data
- Role-based database access and controlled RPCs
- TOTP MFA and sign-in challenge support
- Append-only security audit records and server-side role-change capture
- CodeQL, secret scanning, dependency review, and CI quality gates
- Coordinated disclosure through [`SECURITY.md`](SECURITY.md)

SOC 2 and ISO 27001 readiness material is maintained in
[`docs/compliance/`](docs/compliance/README.md), including control mappings,
evidence references, policies, gap-remediation work, and the
[Vanta evidence index](docs/compliance/vanta-evidence-index.md).

These materials support readiness and audit preparation; they do not by
themselves represent completed certification. Defence, aerospace, and other
regulated deployments may require additional contract-specific controls,
security authorization, controlled-goods or export-control processes,
independent assessment, and jurisdiction-specific certification.

## Getting started

### Prerequisites

- Node.js 22
- npm
- Docker
- Supabase CLI

### Local development

```bash
git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
cd ai-maintenance-system
npm ci
supabase start
supabase db reset
npm run dev
```

The application runs at `http://localhost:5173` by default.

Local demo personas are created by the seed/migration chain. Keep credentials in
approved development configuration or internal onboarding documentation rather
than publishing passwords in the repository README.

### Validation

```bash
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run test
npm run build
npm run test:e2e
```

Playwright E2E requires the local Supabase stack and seeded data.

## Repository structure

```text
src/
  lib/
    asset-twins/             canonical asset templates and Engineering DNA
    engineering-knowledge/   ontology, factory, extraction, and retrieval contracts
  components/                application UI
  pages/                     role and workflow pages
supabase/
  functions/                 Edge Functions and AI/RAG services
  migrations/                ordered database migration chain
docs/
  architecture/              canonical ownership and design decisions
  compliance/                SOC 2 / ISO 27001 readiness and evidence
  ...                        operating, onboarding, AI, GTM, and deployment guides
tests/
  e2e/                       Playwright golden-path coverage
```

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/architecture/canonical-plane-ownership.md`](docs/architecture/canonical-plane-ownership.md) | Canonical model ownership and anti-duplication rules |
| [`docs/operating-loop-demo.md`](docs/operating-loop-demo.md) | Buyer-value operating loop, end to end |
| [`docs/asset-onboarding.md`](docs/asset-onboarding.md) | RAM onboarding and governance gates |
| [`docs/reliability-kb.md`](docs/reliability-kb.md) | Reliability knowledge base and citation model |
| [`docs/llm-enrichment.md`](docs/llm-enrichment.md) | Agent-loop language-model enrichment |
| [`docs/gtm-readiness.md`](docs/gtm-readiness.md) | Capability-versus-promise assessment |
| [`docs/compliance/`](docs/compliance/README.md) | SOC 2 / ISO 27001 readiness pack |
| [`AI-AGENT-TRAINING-GUIDE.md`](AI-AGENT-TRAINING-GUIDE.md) | Agent training and governance guidance |
| [`RAG-TRAINING-GUIDE.md`](RAG-TRAINING-GUIDE.md) | RAG ingestion and training guidance |

## Repository conventions

- Changes land through pull requests; avoid direct commits to `main`.
- Schema changes are made only through ordered migrations.
- Canonical contracts, registries, RLS policies, and shared engineering models
  are serialized and reviewed carefully to prevent parallel drift.
- Asset-class implementations should reuse existing shared contracts and include
  deterministic tests.
- Do not encode unverified OEM thresholds, setpoints, wear limits, maintenance
  intervals, or operating limits as platform defaults.
- Engineering recommendations must retain provenance, applicability, review
  state, and human approval requirements.
- Mission-critical capabilities must be represented by evidence, validation,
  authorization, and operational acceptance—not by marketing language alone.

## License

MIT — see [`LICENSE`](LICENSE).

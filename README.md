# SyncAI — Governed Industrial Engineering Intelligence

[![CI](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![CodeQL](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/codeql.yml/badge.svg)](.github/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-green.svg)](https://supabase.com)

SyncAI is a governed Industrial Engineering Intelligence platform for high-risk,
asset-intensive operations.

It connects asset and component models, engineering knowledge, deterministic
physics, operational evidence, reliability workflows, human approval, and AI
reasoning so teams can make safer and more reliable maintenance, risk,
readiness, and production decisions.

> **Can we safely and reliably deliver the operating plan?**

The application is available at **[app.syncai.ca](https://app.syncai.ca)**.
Capability maturity varies by module and deployment.

## Current product state

SyncAI is in **advanced pilot development**. It has a substantial working
application, database, operating-loop, engineering-model, and governed-AI
foundation. It is not yet a fully hardened, independently assured enterprise
platform for unrestricted high-consequence production use.

The source of truth for current claims is the
[Product Capability Audit](docs/product-capability-audit-2026-08-03.md).
Commercial claims are governed by the
[Claims and Evidence Register](docs/enterprise-readiness/claims-and-evidence-register.md).
The desired completed product is defined separately in the
[Enterprise Target State](docs/enterprise-target-state.md).

## Capability status

| Capability | Current state |
| --- | --- |
| Authenticated application and role-shaped operating views | Implemented foundation with broad operational, engineering, work, approval, briefing, value, and administrative surfaces |
| Organization-scoped Supabase data plane | Implemented for core operational records; fine-grained enterprise write authorization remains incomplete |
| Governed operating loop | Implemented for recommendations, evidence, scenarios, approvals, bounded work actions, decisions, value, and learning |
| Human approval boundary | Implemented in the canonical AI/orchestrator path; direct autonomous operational execution is disabled |
| Asset onboarding and RAM governance | Pilot-capable foundation with evidence gaps, readiness gates, FMEA/FRACAS concepts, and approvals |
| ISO 55000-aligned KPI service | Implemented; some KPIs remain unavailable until required external systems are connected |
| Engineering DNA and asset-twin library | Implemented foundation across multiple mining and process asset classes |
| Shared Component DNA and deterministic physics | Implemented foundation with governed calculations and approved-source-only limits |
| Inspection intelligence | Governed foundation with evidence, verification, approval, prohibited-action boundaries, and atomic persistence |
| Engineering knowledge ontology and factory | Implemented deterministic contracts; end-to-end governed ingestion and retrieval are not yet complete |
| Asset-aware retrieval | Implemented on draft PR #115 and awaiting integration into the active knowledge runtime |
| Password authentication and per-user TOTP paths | Implemented in application code; enterprise enforcement and hosted configuration require validation |
| CI and delivery gates | Lint, type-check, build, unit, clean migration, auth/RLS/RPC smoke, agent-loop idempotency, Playwright E2E, CodeQL, and secret scanning are operational |

## Simulation and pilot boundaries

The default demo and deployment experience uses seeded assets, simulated
telemetry, starter thresholds, and scheduled operating-loop activity. These are
useful for workflow validation and pilot design, but they are not evidence of a
live historian, SCADA, CMMS, ERP, or customer asset deployment.

`provision_deployment()` creates a configured workspace, starter assets, sensors,
onboarding records, and audit history inside SyncAI. It does **not** provision
customer cloud, private-cloud, on-premises, edge, sovereign, or disconnected
infrastructure.

## Not yet production-ready

The following must not be represented as generally delivered, independently
validated, or certified:

- production-ready enterprise SSO or Google Workspace authentication;
- comprehensive role-, site-, asset-, program-, classification-, and
  action-based authorization;
- a clean-deployment, end-to-end governed RAG service and persistent knowledge
  graph;
- production SAP, Maximo, PI/historian, SCADA, OPC-UA, MQTT, ERP, or PLM
  connectors;
- supported private-cloud, on-premises, sovereign, edge, or air-gapped
  deployment;
- unrestricted autonomous execution against operational control or command
  systems;
- independently verified model assurance, penetration testing, resilience, or
  customer outcomes;
- SOC 2, ISO 27001, defence, aerospace, OT-security, functional-safety, or other
  formal certification or authorization.

Several legacy Edge Functions and schemas remain in the repository for
historical or migration purposes. They are not equivalent to the canonical,
deployed, governed runtime and must not be used as production evidence.

## Core principles

- **Human technical authority is preserved.** AI can detect, explain, calculate,
  recommend, draft, and route; high-consequence decisions require accountable
  approval.
- **Engineering authority is explicit.** Sources, limits, revisions,
  applicability, provenance, confidence, and review state travel with results.
- **Deterministic engineering stays separate from generative language.** Physics,
  rules, constraints, and calculations are inspectable and testable.
- **Canonical models are reused.** Asset DNA, shared components, physics,
  evidence, work, and decisions are referenced rather than duplicated.
- **Tenant scope comes from trusted identity.** Caller-supplied organization or
  user identifiers are not an acceptable enterprise security boundary.
- **Safety and security override optimization.** The platform abstains or
  escalates when evidence, authority, or operating context is insufficient.
- **Learning does not silently rewrite approved truth.** New information creates
  reviewable, versioned proposals and supersession decisions.
- **Verified outcomes matter.** Projected, observed, validated, and independently
  verified value remain distinct states.

## Platform architecture

| Layer | Current responsibility |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, Zustand, and Framer Motion |
| Data plane | Supabase Postgres, Row Level Security, controlled RPCs, Realtime, scheduled jobs, and audit records |
| Operating loop | Assets, sensors, recommendations, evidence, scenarios, approvals, work, decisions, value, and learning |
| Engineering model | Asset templates, Engineering DNA, Shared Component DNA, physics capabilities, inspection contracts, overlays, and twin instances |
| Knowledge foundation | Ontology, authority, provenance, Knowledge Base Factory, extraction resolution, and asset-aware retrieval contracts |
| AI runtime | Deployed agent processor and approval orchestrator with tenant scope, idempotency, human review, and bounded side effects |
| Quality and delivery | GitHub Actions, Vitest, Playwright, CodeQL, secret scanning, dependency review, Vercel, and selected Supabase deployment |

The active deployment workflow automatically deploys the migration chain and the
governed `agent-loop-enrich`, `ai-agent-processor`,
`autonomous-orchestrator`, and `onboarding-enrich` functions. Other functions in
the repository must not be assumed to be part of the active production boundary.

## Product direction

At maturity, SyncAI is intended to connect:

> approved engineering knowledge and requirements → asset configuration →
> trustworthy operational evidence → deterministic analysis and governed AI →
> human technical authority → controlled work and change → verification →
> measured outcomes and learning.

Priority target capabilities include:

- one canonical secure orchestration and engineering-knowledge plane;
- enterprise identity and fine-grained authorization;
- trustworthy industrial data, calibration, uncertainty, time quality, and
  evidence fitness;
- technical change, configuration, and return-to-service assurance;
- production historian and CMMS/EAM connectors;
- validated models, simulations, and controlled experimentation;
- immutable technical-assurance evidence packs;
- human-systems integration;
- repeatable secure deployment, operations, recovery, support, and independent
  assurance.

## Sector outcomes

SyncAI remains one industrial platform with sector-specific outcomes:

| Sector | Typical outcome language |
| --- | --- |
| Energy and mining | Production assurance, asset integrity, process safety, reliability, and maintenance effectiveness |
| Manufacturing | Equipment effectiveness, quality, throughput, and maintenance readiness |
| Utilities and infrastructure | Service reliability, resilience, and lifecycle stewardship |
| Aerospace | Configuration assurance, system readiness, verification, and technical risk control |
| Defence | Equipment readiness, sustainment, technical assurance, and mission assurance only where relevant |
| Transportation | Fleet readiness, safety, reliability, and service continuity |

## Security and compliance

Current foundations include organization-scoped RLS, security events, MFA code
paths, audit records, CodeQL, secret scanning, dependency review, policies,
control mappings, and evidence indexes.

The material in [`docs/compliance/`](docs/compliance/README.md) supports SOC 2
and ISO 27001 readiness and audit preparation. It does not constitute completed
certification. Regulated or controlled deployments require additional
contract-, jurisdiction-, information-, and deployment-specific authorization
and independent evidence.

Coordinated disclosure is described in [`SECURITY.md`](SECURITY.md).

## Local development

### Prerequisites

- Node.js 22
- npm
- Docker
- Supabase CLI 2.84.2 or the repository-pinned CI version

```bash
git clone https://github.com/Stiggtechnologies/ai-maintenance-system.git
cd ai-maintenance-system
npm ci
supabase start
supabase db reset
npm run dev
```

The application runs at `http://localhost:5173` by default.

Local demo personas are created by the migration chain. Keep credentials in
approved development configuration or internal onboarding documentation rather
than publishing passwords in this README.

### Validation

```bash
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npm run test
npm run build
npm run test:e2e
```

The CI workflow also proves a clean local Supabase start, the complete ordered
migration chain, seeded authentication, tenant-scoped RLS access, the app-shell
context RPC, continuous-agent-loop idempotency, and the Playwright golden path.
Failure-only startup artifacts preserve Supabase and Docker diagnostics.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/product-capability-audit-2026-08-03.md`](docs/product-capability-audit-2026-08-03.md) | Evidence-based current capability and gap assessment |
| [`docs/enterprise-target-state.md`](docs/enterprise-target-state.md) | Desired enterprise product and completion criteria |
| [`docs/enterprise-readiness/claims-and-evidence-register.md`](docs/enterprise-readiness/claims-and-evidence-register.md) | Permitted commercial claims and required evidence |
| [`docs/architecture/canonical-plane-ownership.md`](docs/architecture/canonical-plane-ownership.md) | Canonical model ownership and anti-duplication rules |
| [`docs/operating-loop-demo.md`](docs/operating-loop-demo.md) | Governed operating-loop walkthrough |
| [`docs/asset-onboarding.md`](docs/asset-onboarding.md) | RAM onboarding and governance gates |
| [`docs/reliability-kb.md`](docs/reliability-kb.md) | Reliability knowledge and citation model |
| [`docs/gtm-readiness.md`](docs/gtm-readiness.md) | Go-to-market readiness; reconcile against the current audit before use |
| [`docs/compliance/`](docs/compliance/README.md) | SOC 2 and ISO 27001 readiness material |

Historical completion and audit reports may describe earlier architectures,
counts, tests, or readiness states. They are not current product evidence unless
they are explicitly reconciled to the capability audit.

## Repository conventions

- Changes land through pull requests; avoid direct commits to `main`.
- Schema changes use the ordered active migration chain with unique versions.
- Do not restore archived legacy migrations into the active chain without an
  explicit convergence plan.
- Canonical contracts, registries, RLS policies, service boundaries, and shared
  engineering models require careful review to prevent parallel drift.
- Do not encode unverified OEM thresholds, setpoints, wear limits, maintenance
  intervals, or acceptance criteria as product defaults.
- Recommendations retain evidence, applicability, uncertainty, review, and
  human-approval requirements.
- Simulated, pilot, target, prohibited, independently verified, and certified
  states remain visibly distinct.

## License

MIT — see [`LICENSE`](LICENSE).

# SyncAI — Industrial Engineering Intelligence for Asset-Intensive Operations

[![CI](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![CodeQL](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/workflows/codeql.yml/badge.svg)](.github/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-green.svg)](https://supabase.com)

SyncAI is a governed Industrial Engineering Intelligence platform for mining,
energy, utilities, manufacturing, transportation, and other asset-intensive
operations.

It connects engineering knowledge, asset and component models, deterministic
physics, operational evidence, digital twins, reliability workflows, and
human-approved AI agents so teams can make safer and more reliable maintenance,
risk, and production decisions.

The operating question remains:

> **Can we safely and reliably deliver the production plan?**

The application is available at **[app.syncai.ca](https://app.syncai.ca)**.
Capability maturity varies by module; see [Capability status](#capability-status)
below.

## Core principles

- **Human authority is preserved.** AI can detect, explain, recommend, and draft,
  but safety- or production-critical actions require explicit approval.
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
| Autonomous execution against operational control systems | Not permitted by platform governance |
| SOC 2 and ISO 27001 certification | Control implementation/readiness work exists; formal audit and certification are separate activities |

For commercial or deployment decisions, use
[`docs/gtm-readiness.md`](docs/gtm-readiness.md) as the capability-versus-promise
reference.

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
themselves represent completed certification.

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

## License

MIT — see [`LICENSE`](LICENSE).

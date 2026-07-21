# SyncAI — Mission Assurance Platform for Asset-Intensive Operations

[![CI](https://img.shields.io/badge/CI-4%20required%20checks-green.svg)](.github/workflows/ci.yml)
[![CodeQL](https://img.shields.io/badge/CodeQL-enabled-green.svg)](.github/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge-green.svg)](https://supabase.com)

SyncAI answers one question for operations leadership, continuously and audibly:
**"Can we safely and reliably deliver the production plan?"** It pairs a
deterministic autonomous operating loop (sense → detect → recommend →
human-approve → verify) with chartered LLM reliability agents, on an
org-isolated Supabase backend. Live at **[app.syncai.ca](https://app.syncai.ca)**.

## What the platform does

- **Autonomous operating loop** — telemetry ingestion (simulated until a
  historian is connected), six proactive agent passes (condition, schedule,
  material, capacity, HSE, production), KPI breach detection, and RACI-routed
  recommendations. Every action is human-approved and logged; nothing executes
  autonomously against safety- or production-critical systems.
- **Autonomous asset onboarding** — a 36-section RAM checklist engine
  (146 catalog items, 45-class FMEA library) that AI-deduces what it can,
  demotes low-confidence deductions to human-in-the-loop gaps, and gates
  go-live on data quality, governance, and a 5-role approval trail.
  See [docs/asset-onboarding.md](docs/asset-onboarding.md).
- **ISO 55000 KPI truth layer** — a 29-KPI catalog with workbook-faithful RACI,
  computed hourly from live data with lineage, access-controlled **in the
  database** per role (board-tier rows never leave Postgres for a technician).
- **Role command centers** — sign-in lands each role (executive → technician)
  on its own command center with role-shaped navigation and a role-aware
  copilot dock grounded in that role's live KPIs and open actions.
- **Chartered reliability agents** — ten LLM agent types (reliability, PM
  strategy, asset health, risk, work management, planning, spares, RCA, HSE,
  coordination), each with a body-of-knowledge charter and mandatory RAG
  citations (MIL-HDBK-338B, DoD RAM Guide). Deliverable mode produces complete
  work products — e.g. a 20+ row scored FMEA register with jurisdiction notes
  and CSV export. See [docs/reliability-kb.md](docs/reliability-kb.md).
- **One-click deployment** — `provision_deployment()` creates a site with an
  industry starter pack that self-onboards, with telemetry and agent
  monitoring live within minutes.
- **FRACAS closeout** — work orders close through a mandatory failure-coding
  and verification flow that feeds the learning loop.

## Architecture

| Layer    | Technology                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend | React 18 + TypeScript (strict) + Vite + Tailwind, Framer Motion                                                                                                                            |
| Backend  | Supabase — Postgres 17, RLS everywhere, security-definer RPCs, pg_cron, Realtime                                                                                                           |
| AI       | Edge functions (Deno): `ai-agent-processor` (copilot + RAG), `onboarding-enrich`, `agent-loop-enrich`; OpenAI + Gemini                                                                     |
| Schema   | 18 sequential migrations in [`supabase/migrations/`](supabase/migrations/) — deterministic, reviewable, reproducible                                                                       |
| CI/CD    | GitHub Actions: lint+typecheck, unit tests, migration-chain + auth smoke, golden-path E2E (all required); CodeQL, gitleaks, Dependabot; auto-deploy from `main` (Vercel + deploy workflow) |

## Security & compliance

Org-scoped row-level security on every table; role-based access enforced in the
database; **TOTP MFA** with sign-in challenge; an append-only
**security audit log** with server-side role-change capture (`/security-log`);
secret scanning, SAST, and dependency management in CI; coordinated disclosure
via [SECURITY.md](SECURITY.md).

The SOC 2 / ISO 27001 posture is documented honestly in
[`docs/compliance/`](docs/compliance/README.md): control matrices mapping every
criterion to evidence, a gap-remediation roadmap, starter policies, and a
[Vanta-ready evidence index](docs/compliance/vanta-evidence-index.md).

## Getting started

```bash
npm install
supabase start          # local stack (Docker)
supabase db reset       # apply the 18-migration chain + demo seed
npm run dev             # http://localhost:5173
```

Demo login: `demo@syncai.ca` / `Demo123!@#` (reliability engineer). Persona
accounts for each organizational layer (executive, manager, planner,
technician) are seeded by migration 16 — demo-tier credentials by design.

```bash
npm run typecheck       # tsc --noEmit
npm run lint
npm test                # unit tests
npx playwright test     # 10-test golden-path E2E (needs local stack)
```

## Documentation

| Doc                                                        | Contents                                     |
| ---------------------------------------------------------- | -------------------------------------------- |
| [docs/operating-loop-demo.md](docs/operating-loop-demo.md) | The buyer-value loop, end to end             |
| [docs/asset-onboarding.md](docs/asset-onboarding.md)       | Autonomous RAM onboarding + governance gates |
| [docs/reliability-kb.md](docs/reliability-kb.md)           | RAG knowledge base + copilot citations       |
| [docs/llm-enrichment.md](docs/llm-enrichment.md)           | Agent-loop LLM enrichment                    |
| [docs/gtm-readiness.md](docs/gtm-readiness.md)             | Capability-vs-promise assessment             |
| [docs/compliance/](docs/compliance/README.md)              | SOC 2 / ISO 27001 readiness pack             |

## Repository conventions

- Every change lands via PR with the four required CI checks green — no direct
  commits to `main`; deploys happen only from `main`.
- Schema changes only through the migration chain.

## License

MIT — see [LICENSE](LICENSE).

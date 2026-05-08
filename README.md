# SyncAI — Industrial AI Infrastructure

[![Status](https://img.shields.io/badge/Status-Production-green.svg)](https://app.syncai.ca)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-18.2-blue.svg)](https://reactjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Edge_Runtime-green.svg)](https://supabase.com)
[![Tests](https://img.shields.io/badge/Tests-44_passing-brightgreen.svg)](#testing)

The autonomous industrial layer for asset-intensive maintenance.

```
syncai.ca           ──────►  Marketing site (industries, plans, AppSource)
app.syncai.ca       ──────►  This repo. Tenant product + 15 AI agents.
os.syncai.ca        ──────►  Internal SyncAI Command OS (separate repo)
```

## What ships in this repo

| | What | Where |
|---|---|---|
| **13 industry templates** | Oil & Gas, Mining, Pharma, Data Centers + 9 more — pre-configured asset taxonomy, FMEA library, ISO 55000 KPIs, integrations roster | `supabase/migrations/012_industry_templates_expanded.sql` |
| **60-second tenant deploy** | Pick industry → click Deploy → working tenant with synthetic asset seed in 60s | `supabase/functions/deploy-tenant/` |
| **26 integration vendors** | SAP PM, Maximo, AVEVA PI, Schneider EcoStruxure, Veeva, Anthropic, OpenAI + 19 more. Encrypted credentials at rest. | `supabase/migrations/013_integrations.sql` + `supabase/functions/integration-{connect,test,disconnect}/` |
| **15 AI agents + orchestrator** | DB-driven registry, real Anthropic round-trips via the customer's connected integration, full run history with metrics | `supabase/migrations/014_ai_agents.sql` + `supabase/functions/ai-agent-processor/` |
| **Microsoft AppSource fulfillment** | SaaS Fulfillment v2 webhook + token resolver. Activation deep-link at `/marketplace/activate` | `supabase/migrations/015_marketplace_microsoft.sql` + `supabase/functions/marketplace-fulfillment-webhook/` |
| **Marketing → product handoff** | `?industry=<slug>` URL param preserved through signup | `src/pages/Signup.tsx`, `app/industries/page.tsx` (marketing repo) |

## Architecture overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full diagram. Short version:

```
Marketing (StiggSyncAIwebsite2.0)        Product (this repo)
  ┌──────────────┐                       ┌──────────────────────────┐
  │ /industries  │ ── Deploy CTA ──────► │ /signup?industry=<slug>  │
  │ /microsoft   │ ── AppSource ───────► │ /marketplace/activate    │
  └──────────────┘                       │ /command (15 agents UI)  │
                                         └────────────┬─────────────┘
                                                      │
                              ┌───────────────────────▼──────────────────────────┐
                              │   Supabase: 15 migrations + 26 Edge Functions    │
                              │   organizations / sites / assets / work_orders   │
                              │   deployment_templates / integrations / agents   │
                              │   marketplace_subscriptions / billing_plans      │
                              └──────────────────────────────────────────────────┘
```

## Quick start

```bash
# 1. Install
npm install

# 2. Configure Supabase
cp .env.example .env
# Edit .env to set:
#   VITE_SUPABASE_URL=https://<project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>

# 3. Apply migrations + deploy Edge Functions
supabase db push
supabase functions deploy ai-agent-processor
supabase functions deploy deploy-tenant
supabase functions deploy integration-connect
supabase functions deploy integration-test
supabase functions deploy integration-disconnect
supabase functions deploy marketplace-fulfillment-webhook

# 4. Required one-time setup
psql "$SUPABASE_DB_URL" -c "ALTER DATABASE postgres SET app.integration_encryption_key = '<32+ char secret>';"

# 5. Run dev server
npm run dev          # http://localhost:5173
```

## Per-feature setup

| Feature | Required env / setup |
|---|---|
| **Encrypted integrations** | `app.integration_encryption_key` database setting (see above) |
| **AI agents** | Connect Anthropic in Integrations → Add → "Anthropic" → enter key → Connect. OR set `ANTHROPIC_API_KEY` Edge Function secret. |
| **Microsoft Marketplace** | `MARKETPLACE_AAD_TENANT_ID/CLIENT_ID/CLIENT_SECRET` Edge Function secrets |
| **Stripe billing** | See `docs/archive/STRIPE-INTEGRATION-GUIDE.md` |

## Repo layout

```
ai-maintenance-system/
├── src/
│   ├── App.tsx                    # Top-level state-machine routing
│   ├── components/                # 39+ React components
│   │   ├── AgentControlCenter.tsx # 15 agents UI, DB-driven
│   │   ├── AgentRunModal.tsx      # Invoke agent → real Claude call
│   │   ├── IntegrationsDashboard.tsx
│   │   ├── ConnectIntegrationModal.tsx
│   │   ├── TemplateSelector.tsx   # 13 industry templates
│   │   ├── TemplatePreview.tsx
│   │   ├── CommandCenter.tsx      # App shell after auth
│   │   ├── Sidebar.tsx
│   │   ├── __tests__/             # Vitest component tests
│   │   ├── billing/               # Stripe checkout flow
│   │   └── ui/                    # shared primitives
│   ├── pages/
│   │   ├── MarketplaceActivate.tsx  # AppSource activation landing
│   │   ├── Login.tsx | Signup.tsx | EnterpriseAccess.tsx
│   │   └── Pricing.tsx | Privacy.tsx | Security.tsx | Terms.tsx
│   ├── lib/                       # supabase client, auth helpers
│   ├── services/                  # data services
│   └── test/                      # Vitest setup, mocks
├── supabase/
│   ├── migrations/                # 50+ migrations
│   │   ├── 012_industry_templates_expanded.sql
│   │   ├── 013_integrations.sql
│   │   ├── 014_ai_agents.sql
│   │   └── 015_marketplace_microsoft.sql
│   ├── functions/                 # 26+ Edge Functions
│   │   ├── ai-agent-processor/    # 15 agents → Anthropic/OpenAI
│   │   ├── deploy-tenant/         # 60s tenant provisioning
│   │   ├── integration-{connect,test,disconnect}/
│   │   └── marketplace-fulfillment-webhook/
│   └── seed/
├── scripts/
│   ├── deploy-tenant-cli.ts       # npx single-command deploy
│   └── configure-production-secrets.sh
├── docs/
│   ├── integrations.md            # Integration architecture + how-to-add
│   ├── agents.md                  # 16-agent registry + provider routing
│   ├── azure-marketplace.md       # AppSource flow + Partner Center checklist
│   └── archive/                   # 28 historical planning docs
└── ARCHITECTURE.md                # Full system map
```

## Testing

44 passing tests · 6 skipped (with notes) · 0 failing

```bash
npm test              # one-shot
npm run test:watch
npm run test:ui       # browser UI
```

| Test file | Tests | What |
|---|---|---|
| `validation.test.ts` | 10 | Edge Function credential schema validator |
| `ConnectIntegrationModal.test.tsx` | 8 | Schema-driven form, password mask, submit |
| `IntegrationsDashboard.test.tsx` | 7 | DB render, filters, picker (2 click→fetch skipped) |
| `AgentControlCenter.test.tsx` | 6 | Agent grid, metrics, filters, run-modal open |
| `AgentRunModal.test.tsx` | 9 | Form, suggestions, validation, modal lifecycle |
| `MarketplaceActivate.test.tsx` | 4 + 4 skipped | Token extraction, error path, contracts |

Two skipped categories:
- **Click→fetch chains** in IntegrationsDashboard / MarketplaceActivate — known React 18 + jsdom async-handler flush issue under Vitest 3. Underlying logic is covered by direct unit assertions and the Edge Function validation tests.

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — full system map (templates → deployment → integrations → agents → marketplace)
- [`docs/integrations.md`](docs/integrations.md) — encryption, Edge Functions, "how to add a vendor"
- [`docs/agents.md`](docs/agents.md) — 16-agent registry, provider routing, "how to add an agent"
- [`docs/azure-marketplace.md`](docs/azure-marketplace.md) — AppSource activation, Partner Center checklist, listing copy
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — production deploy steps
- [`SECRETS.md`](SECRETS.md) — secrets management
- [`docs/archive/`](docs/archive/) — historical planning docs (28 files)

## License

MIT — see [LICENSE](LICENSE)

---

Built by [Stigg Technologies](https://stigg.ca). SyncAI is a Stigg Technologies product, separate from Stigg Security.

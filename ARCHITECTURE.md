# SyncAI Architecture

How the four major subsystems — **Templates**, **Deployments**, **Integrations**, **Agents**, **Marketplace** — fit together.

## Three deployed surfaces

```
                      DNS                                   Repo
  ┌───────────────────────────────────────────────────────────────┐
  │  syncai.ca         (Vercel)  → marketing      StiggSyncAIwebsite2.0   │
  │  app.syncai.ca     (Vercel)  → product        ai-maintenance-system    │
  │  os.syncai.ca      (Vercel)  → internal OS    SyncAICommandOS          │
  └───────────────────────────────────────────────────────────────┘
```

This document describes `ai-maintenance-system` (the product at app.syncai.ca).

## Subsystem map

```
┌────────────────────────────────────────────────────────────────────────────┐
│                            Marketing → Product                             │
│                                                                            │
│   /industries (13 verticals) ─── Deploy CTA ───► app.syncai.ca/signup?    │
│       │                                          industry=<slug>           │
│   /microsoft (AppSource page) ── Get It Now ───► /marketplace/activate     │
│                                                  ?token=<marketplace>      │
└──────────────────────────────────────────┬─────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        ai-maintenance-system (this repo)                   │
│                                                                            │
│   App.tsx ──┬─► Login / Signup (industry preserved via sessionStorage)    │
│             │                                                              │
│             ├─► MarketplaceActivate (AppSource buyers)                     │
│             │     │                                                        │
│             │     └─► fetch(/functions/v1/marketplace-fulfillment-webhook)│
│             │             │                                                │
│             │             ├─► Microsoft SaaS Fulfillment v2 /resolve       │
│             │             └─► persist marketplace_subscriptions            │
│             │                                                              │
│             └─► CommandCenter (post-auth)                                  │
│                    │                                                       │
│                    ├─► Overview (KPIs + deployments list)                  │
│                    ├─► TemplateSelector (13 templates) ─┐                  │
│                    ├─► IntegrationsDashboard ─┐         │                  │
│                    ├─► AgentControlCenter ───┐│         │                  │
│                    └─► WorkOrders / Assets / Reliability / etc.            │
│                                              ││         │                  │
└──────────────────────────────────────────────┼┼─────────┼──────────────────┘
                                               ││         │
                              ┌────────────────┘│         │
                              │   ┌─────────────┘         │
                              │   │   ┌───────────────────┘
                              ▼   ▼   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        Supabase Edge Functions                             │
│                                                                            │
│   ai-agent-processor       ─── reads agent_definitions, routes to ────┐    │
│   integration-{connect,                                              │    │
│      test, disconnect}     ─── reads/writes integrations, RPC encrypt │    │
│   deploy-tenant            ─── reads template_config, seeds tenant    │    │
│   marketplace-fulfillment-webhook ─── Microsoft SaaS Fulfillment v2   │    │
│   (+ 22 more existing functions: javis-*, openclaw-*, billing-*,      │    │
│       rag-*, stripe-*, model-router, gateway, autonomous-orchestrator,│    │
│       runbook-executor, …)                                            │    │
│                                                                       │    │
└───────────────────────────────────────────────────────────────────────┼────┘
                                                                        │
                                                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              Supabase Postgres                             │
│                                                                            │
│  GLOBAL (public read):                                                     │
│    integration_catalog       — 26 vendor/product combos                    │
│    deployment_templates      — 13 industry templates                       │
│    agent_definitions         — 15 agents + orchestrator                    │
│    marketplace_offers/plans  — Microsoft AppSource catalog                 │
│                                                                            │
│  PER-ORG (RLS = organization_id):                                          │
│    organizations / sites / user_profiles                                   │
│    deployment_instances / deployment_steps                                 │
│    integrations / integration_events  (encrypted credentials)              │
│    agent_runs                          (full LLM run history)              │
│    marketplace_subscriptions / marketplace_webhook_events                  │
│    billing_subscriptions / billing_invoices                                │
│    assets / work_orders / kpis / etc.                                      │
│                                                                            │
│  HELPER VIEWS:                                                             │
│    v_deployment_templates_public  ── reads template_config summary         │
│    v_integrations_for_org         ── joins integrations + catalog          │
│    v_agent_summary                ── joins agent_definitions + runs(24h)   │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          External vendor APIs
                ┌────────────────────────────────────────────────┐
                │  Anthropic /v1/messages  ── all 15 agents      │
                │  OpenAI /v1/chat         ── fallback path      │
                │  Microsoft Marketplace SaaS API ── fulfillment │
                │  Stripe API              ── direct billing     │
                │  (SAP, Maximo, PI, etc.) ── pending adapters   │
                └────────────────────────────────────────────────┘
```

## End-to-end demo flow

The shipped path from cold prospect to working tenant:

1. **Prospect lands on `syncai.ca/industries`**, clicks "Deploy Pharmaceuticals template"
2. **Redirects to `app.syncai.ca/signup?industry=pharmaceuticals`** — Signup pre-populates industry
3. **Signup completes** → user lands at CommandCenter / Overview
4. **Overview shows "No deployments" empty state** with a "Deploy a Template →" CTA
5. **Click CTA** → routes to TemplateSelector view (DB-driven, 13 templates rendered)
6. **Click "Preview" on Pharmaceuticals** → modal shows asset taxonomy, FMEA library, KPIs, compliance frameworks
7. **Click "Deploy"** → POST to deploy-tenant Edge Function → 11-step pipeline runs (validate → provision → asset taxonomy → failure modes → KPIs → 15 agents configured → integrations registered → compliance applied → synthetic assets seeded → dashboards activated → finalize) → Toast: "Deployed Pharmaceuticals & Life Sciences"
8. **Navigate to Integrations** → "Add Integration" → search "Anthropic" → enter API key → Click Connect → live round-trip test runs (real `POST /v1/messages` to Anthropic) → integration goes green with latency badge
9. **Navigate to Agent Control Center** → 16 agents listed with real metrics (runs/successes/latency) → click "Run" on Reliability Engineering → modal opens with suggested queries
10. **Type query** → POST to ai-agent-processor → Edge Function reads agent_definitions[reliability_engineering], reads org's connected Anthropic integration credentials (encrypted, decrypted via service-role RPC), calls Anthropic with claude-opus-4-7, returns response → response renders in modal with latency + provider/model badge

That's the demo for an enterprise prospect. ~3 minutes from landing to a Claude response generated by *their* Anthropic key, in *their* industry context, against *their* asset class library.

## Migration ordering

```
007_control_plane.sql              — deployment_templates, deployment_instances (initial scaffolding)
008_industrial_platform_merged.sql — broader platform (legacy, IF NOT EXISTS no-ops on top of 007)
011_openclaw_compat.sql            — openclaw_agents, ai_agent_logs (separate agent system)
012_industry_templates_expanded.sql — fills 007's deployment_templates with real content for 13 industries
013_integrations.sql               — integration_catalog, integrations (encrypted), audit log
014_ai_agents.sql                  — agent_definitions registry + agent_runs + v_agent_summary
015_marketplace_microsoft.sql      — marketplace_offers/plans/subscriptions + SaaS Fulfillment v2 schema
```

012-015 are the platform-shipping migrations. They build cleanly on top of 007/008/011 and don't conflict.

## Edge Function inventory

| Function | Purpose | Migrations it depends on |
|---|---|---|
| `ai-agent-processor` | Run any of the 16 agents through Anthropic/OpenAI | 014 + 013 |
| `deploy-tenant` | 11-step tenant provisioning from a template | 012 + 007 |
| `integration-connect` | Encrypt credentials, run live test for vendors with `has_test_endpoint` | 013 |
| `integration-test` | Re-run live test for an existing integration | 013 |
| `integration-disconnect` | Clear credentials, optional hard delete | 013 |
| `marketplace-fulfillment-webhook` | Microsoft SaaS Fulfillment v2 (resolve + lifecycle webhooks) | 015 |
| `gateway` | API gateway / WebSocket bridge (existing) | — |
| `autonomous-orchestrator` | Existing autonomy/governance runtime | — |
| `model-router` | Existing AI model routing logic | — |
| `javis-orchestrator`, `javis-event-listener`, `javis-websocket` | Existing JAVIS agent system | — |
| `openclaw-*` (5 functions) | Existing OpenClaw subsystem | — |
| `runbook-executor` | Existing runbook engine | — |
| `rag-document-processor`, `rag-semantic-search` | Existing RAG search | — |
| `billing-api`, `billing-gainshare`, `billing-invoice` | Existing Stripe billing | — |
| `stripe-checkout`, `stripe-webhook` | Existing Stripe plumbing | — |
| `health-check`, `edge-node-manager`, `job-processor` | Existing infra | — |
| `document-processor` | Existing document ingestion | — |

## Security model summary

- **Authentication**: Supabase Auth (email + password, magic links, enterprise SSO)
- **RLS**: every per-org table has `organization_id = current_user_org_id()` policies
- **Credential encryption**: pgcrypto AES-256, key in `app.integration_encryption_key` database setting, encrypt/decrypt RPCs are SECURITY DEFINER + service_role only
- **Service role**: Edge Functions only — never exposed to browser
- **Marketplace tokens**: never persisted; consumed server-side, exchanged for subscription via AAD client_credentials grant

## Where to look first if you're new

1. Read this file
2. Read [`README.md`](README.md) for setup
3. Open [`docs/agents.md`](docs/agents.md) — that's the highest-leverage subsystem
4. Walk the demo flow above with a real Anthropic key

# SyncAI Microsoft Launch Pack

This folder contains the working package for taking **SyncAI Reliability
Engineering Copilot** into Microsoft customer channels.

It is intentionally split into three Microsoft lanes:

1. **Fast hosted SaaS lane:** SyncAI hosted web app + Teams static tab +
   transactable Microsoft Commercial Marketplace SaaS offer. This is the
   fastest bootstrap path.
2. **Microsoft-native agent lane:** Microsoft Foundry prompt/workflow agent
   published to Microsoft 365 Copilot, Teams, and the Microsoft 365 Agent
   Store.
3. **Customer-tenant deployment lane:** Azure Managed Application or Foundry
   Agent Application package for enterprise buyers who require isolated
   deployment into their own Azure tenant.
4. **Product system-of-record lane:** SyncAI SaaS app for uploads, RAG,
   calculations, RCA/FRACAS/FMEA cases, reports, audit trail, tenant
   administration, and billing.

## Contents

- `foundry/reliability-engineering-copilot.prompt.md` - first Foundry prompt
  agent instruction set.
- `foundry/agent-config.template.json` - non-secret setup template for Foundry.
- `foundry/tool-actions.openapi.yaml` - SyncAI tool/action API contract for
  agent tools.
- `foundry/evals.jsonl` - first evaluation cases for the reliability agent.
- `teams/manifest.json` - Microsoft 365/Teams app manifest scaffold.
- `teams/adaptive-cards/` - Teams card templates for reliability workflows.
- `marketplace/appsource-listing.md` - AppSource listing draft.
- `pilot/onboarding-checklist.md` - paid pilot onboarding checklist.
- `pilot/design-partner-sow.md` - lightweight design partner SOW template.

## Fastest Execution Sequence

1. Sell a paid design-partner pilot using the existing GPT as proof.
2. Keep the hosted SaaS live at the Vercel/Supabase pilot URL while marketplace
   verification is completed.
3. Create a Foundry prompt agent from `foundry/reliability-engineering-copilot.prompt.md`.
4. Add curated knowledge sources and test the evals in `foundry/evals.jsonl`.
5. Publish the Foundry agent to individual Teams/M365 scope for pilot users.
6. Wire SyncAI tool actions behind `foundry/tool-actions.openapi.yaml`.
7. Package the Teams app with `teams/manifest.json` and adaptive cards.
8. Submit AppSource listing once pilot proof, support URLs, terms, privacy,
   icons, and admin test accounts are ready.

## Monetization Architecture

- **Seat-based SaaS:** default bootstrap packaging for Starter, Professional,
  and Enterprise plans.
- **Usage-based add-on:** `marketplace-metering` submits Commercial Marketplace
  metered billing records. Live agent invocations now create pending
  `agent_invocation` records with provider/model metadata when a marketplace
  subscription is mapped.
- **Enterprise isolated deployment:** package the agent/application stack as an
  Azure Managed Application or customer-tenant Foundry Agent Application when a
  buyer requires their data, model endpoints, cache, and logs to remain in their
  own Azure tenant.
- **State/cache strategy:** Supabase is active for the hosted SaaS pilot. Azure
  Managed Redis should be added for high-volume customer-tenant deployments
  where long agent sessions and parallel agent orchestration need distributed
  cache durability.

## Owner Gates

These cannot be completed by code alone:

- Microsoft Partner Center account access.
- Publisher verification.
- Azure subscription and permission to create Foundry, Bot Service, Entra app,
  storage, and search resources.
- Legal approval for privacy, terms, support, and marketplace claims.
- Customer approval for using their documents and work-order exports.
- Final marketplace submit under Stigg / SyncAI authority.

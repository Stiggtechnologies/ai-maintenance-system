# Microsoft Foundry And Marketplace Strategy

SyncAI should use Microsoft distribution in two ways at the same time:

## 1. Hosted SaaS Bootstrap

This is the fastest path to revenue.

- Hosted app: Vercel + Supabase pilot deployment.
- Microsoft entry point: Teams static tab and Commercial Marketplace SaaS offer.
- Identity: multitenant Microsoft Entra app.
- Provisioning: marketplace token resolve/activate flow creates or maps tenant
  records.
- Monetization: per-seat plans first, optional metered billing for agent
  invocations.

This lane is best for paid pilots, small teams, and buyers who can accept a
vendor-hosted product.

## 2. Microsoft-Native Agent Distribution

This is the best path to Microsoft 365 discoverability.

- Build/publish the Reliability Engineering Copilot as a Microsoft Foundry Agent
  Application.
- Publish to Microsoft 365 Copilot and Microsoft Teams when the agent is tested.
- Use the Foundry-generated Teams/M365 package for admin approval and tenant
  deployment.
- Keep SyncAI tool actions behind secure APIs so the agent can call deterministic
  reliability tools, asset onboarding, exports, and RAG.

This lane is best for Agent Store visibility and native user experience inside
Teams, Outlook, Word, Excel, and Microsoft 365 Copilot.

## 3. Customer-Tenant Azure Deployment

This is the highest-trust enterprise path.

- Package SyncAI as an Azure Managed Application or equivalent customer-tenant
  deployment.
- Deploy app services, Foundry Agent Application, storage, vector search,
  Key Vault, monitoring, and optional Azure Managed Redis into the customer's
  Azure tenant.
- Keep customer documents, logs, embeddings, cache, and model traffic inside the
  customer's Azure boundary.

This lane is best for asset-intensive enterprise customers with strict data
residency, security, procurement, or IT architecture requirements.

## What Is Implemented Now

- Hosted SaaS pilot deployment is live.
- Entra multitenant app registration exists.
- Teams static-tab package exists.
- Teams SSO Application ID URI and `access_as_user` scope are configured.
- Teams desktop and web client IDs are pre-authorized.
- Marketplace resolve/activate Edge Function is deployed.
- Live AI endpoint is wired through `ai-agent-processor`.
- Marketplace metering records are created for agent invocations when a
  marketplace subscription is mapped.

## Remaining Decisions

- Use per-seat pricing for first pilots; add metered billing only when customers
  ask for consumption pricing or when enterprise usage is large enough to matter.
- Use hosted SaaS for speed, but offer customer-tenant Managed Application
  deployment as the premium enterprise option.
- Use Microsoft Foundry Agent Store publishing for discovery, not as the only
  product backend. The SyncAI app remains the system of record for reliability
  artifacts, asset context, approvals, exports, and audit trail.

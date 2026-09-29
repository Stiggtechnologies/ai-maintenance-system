# SyncAI Azure Edition and Microsoft Marketplace

**Status: foundation implemented; not yet production deployed.** The repository
contains the first repeatable Azure application stamp and its release gate. No
claim that SyncAI is primarily platformed on Microsoft Azure, Marketplace
certified, transactable, MACC eligible, or co-sell ready is valid until the
corresponding evidence below is green.

## Commercial objective

The objective is a genuine Azure edition that enterprise customers can purchase
through Microsoft Marketplace and that Microsoft sellers can take into their
accounts. Microsoft requires a transactable SaaS offer to be primarily
platformed on Microsoft Azure. A Microsoft login bolted onto a Vercel/Supabase
deployment does not satisfy that objective.

The controlled sequence is:

| Gate | Deliverable                                                                                                 | Current evidence                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A1   | Azure-hosted web foundation, managed identity, registry, Key Vault, logs, health proof                      | Implemented in `infra/azure`; deployment blocked until the Azure OIDC identity and environment secrets are configured |
| A2   | Azure-hosted compute/data plane whose consumption grows with customer use                                   | Not implemented; existing Supabase/Vercel production remains authoritative                                            |
| A3   | Microsoft Entra SSO that establishes a verified application session                                         | Fail-closed in the current product; the legacy hand-decoded-token path remains blocked                                |
| A4   | Backend-only SaaS Fulfillment APIs v2 resolve and activation flow                                           | Legacy code is blocked and is not production evidence                                                                 |
| A5   | Authenticated, idempotent webhook lifecycle and canonical entitlement enforcement                           | Not implemented                                                                                                       |
| A6   | Hourly aggregated, idempotent Marketplace metering from canonical usage                                     | Not implemented                                                                                                       |
| A7   | Preview-offer end-to-end certification suite                                                                | Not run                                                                                                               |
| A8   | Live transactable offer, Partner Center business profile, regional sales contacts, one-pager and pitch deck | External Partner Center work remains                                                                                  |
| A9   | Azure IP co-sell and MACC eligibility                                                                       | Requires Microsoft's technical review and the then-current commercial threshold                                       |

No certification or co-sell claim may be published from source code, a preview
offer, or a successful infrastructure deployment alone.

## Foundation architecture

The first stamp uses:

- Azure Container Registry with the administrator credential disabled.
- Azure Container Apps for the customer web workload, with at least one warm
  production replica and both readiness and liveness probes.
- A user-assigned managed identity for registry pulls and future Key Vault
  references; no Azure client secret is placed in the application.
- Azure Key Vault with RBAC, soft delete, and purge protection.
- Log Analytics and workspace-based Application Insights.
- GitHub-to-Azure workload identity federation. The release workflow accepts no
  `AZURE_CLIENT_SECRET` and refuses to deploy when required values are absent.
- An immutable image digest, followed by a live `/health` proof.

This is a hosting foundation, not yet the complete Azure compute/data plane.
The next platform slice must move the scaling AI/data workload to Azure before
SyncAI represents the edition as primarily Azure-platformed.

The first stamp also keeps the registry and vault public endpoints reachable
while enforcing identity/RBAC. Private endpoints, Front Door/WAF, an approved
egress policy, and customer data-residency selection remain pre-production
network controls; a green foundation deployment alone does not authorize
customer traffic.

## One-time deployment prerequisites

Create a GitHub environment named `azure-production`, apply the organization's
deployment protection rules, and add these environment secrets:

- `AZURE_CLIENT_ID` — client ID of the Microsoft Entra application or
  user-assigned identity trusted through GitHub OIDC.
- `AZURE_TENANT_ID` — SyncAI publisher directory ID.
- `AZURE_SUBSCRIPTION_ID` — the subscription that owns the Azure edition.
- `VITE_SUPABASE_URL` — current public Supabase API URL during the controlled
  migration period.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — browser-publishable key only; never a
  service-role key.

Grant the deployment principal the least roles needed at the target resource
group and configure a federated credential scoped to this repository and the
`azure-production` environment. Then manually run **Deploy Azure Edition
foundation**. A run is successful only when the resource deployments, ACR build,
Container App revision, and external health proof all pass.

## Marketplace contract for the next slices

1. The landing page receives Microsoft's purchase token and sends it to a
   backend endpoint. The browser never calls Microsoft commerce APIs.
2. The backend uses publisher service-to-service credentials to call the SaaS
   Fulfillment APIs v2 resolve endpoint.
3. The buyer signs in through Microsoft Entra SSO. SyncAI uses the verified
   identity/session, minimal consent, and an explicit tenant-admin activation
   step; decoded-but-unverified ID tokens grant nothing.
4. Activation binds the Microsoft subscription to the canonical
   `billing_subscriptions` row for exactly one SyncAI organization. Lifecycle
   events append to the existing immutable `audit_events` ledger rather than a
   new Marketplace-only audit store.
5. A webhook changes entitlement only after SyncAI validates the Microsoft
   identity and calls Get Operation to authorize the event. Retries are
   idempotent.
6. Metering aggregates canonical usage by subscription, dimension, and UTC
   hour. It emits at most one event for that tuple and preserves Microsoft's
   accepted/duplicate/rejected response without inventing usage.
7. Suspend and unsubscribe remove paid entitlement; they do not delete customer
   evidence or bypass retention policy. Human engineering approvals remain
   unrelated to commercial entitlement.

## Microsoft evidence sources

- [Marketplace certification policies](https://learn.microsoft.com/en-us/legal/marketplace/certification-policies)
- [Plan a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer)
- [SaaS Fulfillment APIs](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/pc-saas-fulfillment-apis)
- [SaaS Fulfillment Subscription APIs v2](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/pc-saas-fulfillment-subscription-api)
- [Secure the SaaS webhook](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/pc-saas-fulfillment-webhook)
- [Marketplace metering APIs](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/marketplace-metering-service-apis)
- [Microsoft Entra and transactable SaaS](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/azure-ad-saas)
- [Co-sell requirements](https://learn.microsoft.com/en-us/partner-center/referrals/co-sell-requirements)
- [GitHub Actions OIDC to Azure](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)

These URLs describe current external rules; Partner Center validation remains
the authority at submission time.

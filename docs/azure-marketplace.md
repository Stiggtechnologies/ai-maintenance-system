# SyncAI Azure Edition and Microsoft Marketplace

**Status: Azure foundation, intelligence, Entra, fulfillment, and lifecycle
controls are implemented; commerce is not buyer-proven.** The Supabase/Vercel
production boundary includes the governed A4 fulfillment rail, but its
publisher configuration and real buyer witness remain absent. The repository
also contains a repeatable Azure application stamp and variable-consumption AI
plane that are not yet production-proven. No claim that SyncAI is primarily
platformed on Microsoft Azure, Marketplace certified, transactable, MACC
eligible, or co-sell ready is valid until the corresponding evidence below is
green.

## Commercial objective

The objective is a genuine Azure edition that enterprise customers can purchase
through Microsoft Marketplace and that Microsoft sellers can take into their
accounts. Microsoft requires a transactable SaaS offer to be primarily
platformed on Microsoft Azure. A Microsoft login bolted onto a Vercel/Supabase
deployment does not satisfy that objective.

The controlled sequence is:

| Gate | Deliverable                                                                                                 | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Azure-hosted web foundation, managed identity, registry, Key Vault, logs, health proof                      | Implemented in `infra/azure`; deployment blocked until the Azure OIDC identity and environment secrets are configured                                                                                                                                                                                                                                                                                                                                                                                                            |
| A2   | Azure-hosted compute/data plane whose consumption grows with customer use                                   | Azure Intelligence plane implemented in code: Container Apps + Azure OpenAI with managed identity, Key Vault references, strict Azure-only inference and controlled canonical-cron cutover. It remains unproven until the protected production workflow deploys it and usage evidence shows Azure is the fastest-scaling resource; existing Supabase/Vercel production remains authoritative                                                                                                                                     |
| A3   | Microsoft Entra SSO that establishes a verified application session                                         | Supported Supabase OAuth/PKCE path implemented: hosted Auth owns the provider exchange, the callback verifies the issued user against the Auth server and requires an Azure-backed identity, and identity cannot assign a tenant or activate commerce. Production remains unproven until the multi-tenant Entra app credentials are configured and a real buyer-tenant sign-in is witnessed. The legacy hand-decoded-token path remains blocked.                                                                                 |
| A4   | Backend-only SaaS Fulfillment APIs v2 resolve and activation flow                                           | Governed v2 resolve, explicit activation and authoritative status refresh are deployed. Purchase tokens are scrubbed from the browser URL and never persisted; activation requires a server-verified Microsoft tenant plus an existing SyncAI organization administrator and writes the canonical billing/audit records. The legacy function remains blocked. Publisher credentials are not configured and no real purchase has been witnessed end to end.                                                                       |
| A5   | Authenticated, idempotent webhook lifecycle and canonical entitlement enforcement                           | Authenticated, idempotent webhook lifecycle and canonical entitlement enforcement are implemented in code. Microsoft signature and claims, Get Operation, and Get Subscription must agree before a service-only idempotency transition can alter canonical billing. Suspend/unsubscribe fail closed at the canonical tenant resolver without deleting customer evidence; reinstatement requires authoritative Microsoft success. This is not end-to-end commerce evidence until a preview offer exercises every lifecycle event. |
| A6   | Hourly aggregated, idempotent Marketplace metering from canonical usage                                     | Not implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A7   | Preview-offer end-to-end certification suite                                                                | Not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A8   | Live transactable offer, Partner Center business profile, regional sales contacts, one-pager and pitch deck | External Partner Center work remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A9   | Azure IP co-sell and MACC eligibility                                                                       | Requires Microsoft's technical review and the then-current commercial threshold                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

The Azure Intelligence plane reuses the canonical recommendation records,
LLM-usage records, agent runs, evidence, approvals, and audit history. It does
not create a second queue, decision store, approval model, or audit ledger. A
dedicated Container App runs the governed `agent-loop-enrich` worker and uses
its user-assigned managed identity to call an explicitly deployed Azure OpenAI
model; local Azure OpenAI key authentication is disabled. The only operational
secrets are the canonical Supabase service role and an enrichment caller
secret, both read through Key Vault references. The Azure edition runs in
strict mode and refuses service rather than silently moving inference to a
non-Azure provider.

The protected release proves the web health contract, the Intelligence health
contract, anonymous refusal, shared-caller authentication, acquisition of the
managed-identity token, and a bounded non-persistent inference against the
selected Azure OpenAI deployment. The probe discards the model content and
cannot read or mutate customer records.
Only after those checks pass does it repoint the existing
`private.enrichment_config` through the existing
`configure_agent_enrichment` function. Therefore the canonical cron and
records stay unchanged while variable inference compute moves to Azure. The
worker may enrich rationale and confidence on pending recommendations; it does
not authorize operational action, approve a recommendation, create work, or
change a decision.

This is still not evidence that the Azure edition is primarily platformed. The
production workflow must run successfully and Azure billing/usage evidence
must show that this Azure-hosted plane is the resource whose consumption grows
fastest with customer use before that Marketplace claim is permitted.

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
- `AZURE_DEPLOYMENT_PRINCIPAL_OBJECT_ID` — Microsoft Entra object ID (not the
  client ID) of the GitHub OIDC service principal. The foundation uses it to
  grant that protected release identity Key Vault Secrets Officer on this
  application vault only.
- `VITE_SUPABASE_URL` — current public Supabase API URL during the controlled
  migration period.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — browser-publishable key only; never a
  service-role key.
- `SUPABASE_SERVICE_ROLE_KEY` — used only by the protected release to preserve
  the canonical worker persistence contract and to repoint the private cron
  configuration after the Azure proofs pass. It is stored in Key Vault for the
  runtime and is never compiled into either image.
- `ENRICH_SHARED_SECRET` — existing governed caller secret. Store the same
  value in the Supabase project and the `azure-production` environment; the
  release places it in Key Vault and uses it to prove the Azure caller boundary.

Grant the deployment principal the least roles needed at the target resource
group: resource deployment permission and permission to create the scoped role
assignments. The foundation grants it **Key Vault Secrets Officer** on the
generated application vault; the runtime identity receives only AcrPull, Key
Vault Secrets User, and Cognitive Services OpenAI User. Configure a federated
credential scoped to this repository and the `azure-production` environment.
Then manually run **Deploy Azure Edition
foundation** and explicitly select the approved Azure OpenAI region, model,
version, and deployment SKU. Model availability is regional; do not substitute
a global SKU without a data-processing and residency review. A run is
successful only when both immutable ACR images, the web revision, Azure OpenAI
deployment, Intelligence revision, refusal probes, managed-identity probe, and
canonical-cron cutover all pass.

Configure Microsoft Entra SSO independently of the Azure deployment identity
and Marketplace publisher service principal:

- Register a multi-tenant web application that accepts the Supabase Auth
  callback `https://<project-ref>.supabase.co/auth/v1/callback`. The browser
  callback at `https://app.syncai.ca/auth/callback/azure` belongs in the
  Supabase redirect allow-list, not as a direct Microsoft token endpoint.
- Store `ENTRA_SSO_CLIENT_ID` and `ENTRA_SSO_CLIENT_SECRET` as GitHub repository
  secrets. Set the `ENTRA_SSO_TENANT` repository variable to `common` for the
  Microsoft Marketplace buyer flow. The production Auth deployment configures
  and verifies the provider through the Supabase Management API.
- Do not reuse the GitHub OIDC deployment identity or assume the Marketplace
  publisher credentials have the correct account-type and redirect settings.
- A code deployment is not end-to-end proof. Before marking A3 green, witness
  sign-in from a non-publisher Entra tenant, verify the Supabase user/provider,
  verify the user receives only a pre-provisioned organization membership, and
  confirm a Microsoft login alone cannot activate a subscription or elevate a
  role.

Configure the A4 Marketplace publisher service principal independently of both
the user-facing Entra SSO app and the Azure deployment identity. Store these as
GitHub repository secrets; the protected deployment copies the complete set to
Supabase Edge Function secrets and refuses a partial configuration. None may be
exposed as a `VITE_` variable:

- `AZURE_MARKETPLACE_CLIENT_ID` and `AZURE_MARKETPLACE_CLIENT_SECRET` — the
  service principal registered for the Partner Center publisher application.
- `AZURE_MARKETPLACE_TENANT_ID` — the publisher directory that issues the
  service-to-service access token.
- `AZURE_MARKETPLACE_PUBLISHER_ID` and `AZURE_MARKETPLACE_OFFER_ID` — exact
  Partner Center identities. Resolve and status responses that do not match
  both values are refused.

The `marketplace-fulfillment` Edge Function uses those credentials only on the
server. The landing page sends the single-use, URL-encoded purchase token to
that function, immediately removes it from browser history, and retains only a
short-lived opaque continuation proof. The public resolution rail reuses the
canonical fail-closed, server-derived per-IP daily allowance before it calls
Microsoft, so rotating client input cannot create unbounded publisher-API
traffic. Because modern Supabase publishable keys are not JWTs, this public
landing rail is an explicitly reviewed `--no-verify-jwt` exception; activation
and status still fail closed unless the function independently verifies the
presented session against Supabase Auth and derives exactly one Azure tenant
from that server-returned identity. Resolution creates no organization,
membership or entitlement. A user must then sign in through the separately
verified multi-tenant Entra path and explicitly activate as an administrator of
an existing SyncAI organization whose verified Microsoft tenant matches the
beneficiary or purchaser tenant. A billing record remains pending until
Microsoft reports `Subscribed`; `Suspended` and `Unsubscribed` never produce an
active entitlement.

The `marketplace-webhook` function uses the same publisher configuration but a
separate authentication boundary. Supabase gateway JWT verification is
disabled only because Microsoft signs the bearer token with Entra keys rather
than the Supabase JWT secret. The function independently verifies that
signature, audience, publisher tenant, Microsoft SaaS Fulfillment caller and
issuer before reading the payload. It then requires Get Operation to match the
webhook envelope and Get Subscription to match the configured publisher and
offer. Only a service-role RPC may claim and apply the event. The inbox retains
only a SHA-256 payload fingerprint and correlation identifiers; canonical
commercial state remains in `billing_subscriptions`, and retained lifecycle
history remains in `audit_events`.

The current offer contract is **manual activation**. A resolved purchase must
be bound to an existing organization by the governed A4 flow before lifecycle
events can grant or restore access. A valid but unbound event is quarantined and
grants no entitlement; acknowledgment-required changes are refused back to
Microsoft. Do not configure Partner Center for automatic activation until a
separately reviewed tenant-provisioning design exists.

Rollback does not delete evidence or reverse a model decision. Re-run
`configure_agent_enrichment` with the previously approved Supabase Edge
Function URL and its existing caller secret, then verify the Azure endpoint is
no longer receiving cron traffic. Keep the Azure resources for log and billing
evidence until the incident review authorizes their removal.

## Marketplace contract and remaining slices

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

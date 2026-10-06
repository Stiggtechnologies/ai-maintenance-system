# SyncAI Azure Edition and Microsoft Marketplace

**Status: Azure foundation, intelligence, Entra, fulfillment, lifecycle,
metering, and the preview-certification harness are implemented; commerce is
not buyer-proven.** The
Supabase/Vercel production boundary includes the governed A4 fulfillment and A5
lifecycle rails, but publisher configuration and a real buyer witness remain
absent. Hourly metering is implemented in code but remains disabled until the
exact Partner Center plan/dimension contract and protected dispatcher are
configured. No live usage event has been submitted to Microsoft. The
repository also contains a repeatable Azure application stamp and
variable-consumption AI plane that are not yet production-proven. No claim that
SyncAI is primarily platformed on Microsoft Azure, Marketplace certified, transactable, MACC
eligible, or co-sell ready is valid until the corresponding evidence below is
green.

## Commercial objective

The objective is a genuine Azure edition that enterprise customers can purchase
through Microsoft Marketplace and that Microsoft sellers can take into their
accounts. Microsoft requires a transactable SaaS offer to be primarily
platformed on Microsoft Azure. A Microsoft login bolted onto a Vercel/Supabase
deployment does not satisfy that objective.

The controlled sequence is:

| Gate | Deliverable                                                                                                 | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1   | Azure-hosted web foundation, managed identity, registry, Key Vault, logs, health proof                      | Implemented in `infra/azure`; a dedicated client-secret-free Entra deployment application exists and six required values are stored in the protected GitHub environment. Deployment remains blocked because the federated credential is not yet saved, the Azure directory has no subscription, no resource group or scoped roles exist, and `AZURE_SUBSCRIPTION_ID` plus `ENRICH_SHARED_SECRET` remain absent                                                              |
| A2   | Azure-hosted compute/data plane whose consumption grows with customer use                                   | Azure Intelligence plane implemented in code: Container Apps + Azure OpenAI with managed identity, Key Vault references, strict Azure-only inference and controlled canonical-cron cutover. It remains unproven until the protected production workflow deploys it and usage evidence shows Azure is the fastest-scaling resource; existing Supabase/Vercel production remains authoritative                                                                                |
| A3   | Microsoft Entra SSO that establishes a verified application session                                         | Supported Supabase OAuth/PKCE path implemented: hosted Auth owns the provider exchange, the callback verifies the issued user against the Auth server and requires an Azure-backed identity, and identity cannot assign a tenant or activate commerce. Production remains unproven until the multi-tenant Entra app credentials are configured and a real buyer-tenant sign-in is witnessed. The legacy hand-decoded-token path remains blocked.                            |
| A4   | Backend-only SaaS Fulfillment APIs v2 resolve and activation flow                                           | Governed v2 resolve, explicit activation and authoritative status refresh are deployed. Purchase tokens are scrubbed from the browser URL and never persisted; activation requires a server-verified Microsoft tenant plus an existing SyncAI organization administrator and writes the canonical billing/audit records. The legacy function remains blocked. Publisher credentials are not configured and no real purchase has been witnessed end to end.                  |
| A5   | Authenticated, idempotent webhook lifecycle and canonical entitlement enforcement                           | Deployed behind independent Microsoft JWT validation. Microsoft signature and claims, Get Operation, and Get Subscription must agree before a service-only idempotency transition can alter canonical billing. Suspend/unsubscribe fail closed at the canonical tenant resolver without deleting customer evidence; reinstatement requires authoritative Microsoft success. This is not end-to-end commerce evidence until a preview offer exercises every lifecycle event. |
| A6   | Hourly aggregated, idempotent Marketplace metering from canonical usage                                     | Deployed behind a service-only boundary. Settled canonical token usage is aggregated by subscription, configured dimension, term, and UTC hour; included units are subtracted cumulatively; claims are bounded to 25; accepted and exact-duplicate results preserve Microsoft's response. Dispatch remains disabled until protected plan-meter configuration exists, and no live Microsoft submission has been witnessed.                                                   |
| A7   | Preview-offer end-to-end certification suite                                                                | Protected, fail-closed live suite implemented in `.github/workflows/azure-marketplace-preview-certification.yml`; not run. It requires two real preview purchases, all lifecycle witnesses, a recent accepted usage event, exact Microsoft duplicate and safe rejection responses, included-quantity reconciliation, a hashed Partner Center usage-view artifact, and distinct observer/reviewer identities. A source-code or dry run cannot pass it.                       |
| A8   | Live transactable offer, Partner Center business profile, regional sales contacts, one-pager and pitch deck | External Partner Center work remains                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A9   | Azure IP co-sell and MACC eligibility                                                                       | Requires Microsoft's technical review and the then-current commercial threshold                                                                                                                                                                                                                                                                                                                                                                                             |

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

### Verified bootstrap state — 2026-10-06

The `azure-production` environment exists and is restricted to protected
branches. Administrators cannot bypass its protection rule. On 2026-10-06 a
dedicated single-tenant Entra deployment application named `SyncAI GitHub Azure
Production` was registered without a client secret. Its GitHub Actions
federated-credential form is prepared for the protected `azure-production`
environment and immutable GitHub organization/repository IDs, but the final
credential has not yet been saved.

The GitHub environment now contains exactly six required names:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_DEPLOYMENT_PRINCIPAL_OBJECT_ID`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Values are not
exposed by the inventory. The public URL and publishable key were sourced from
the production `app.syncai.ca` deployment, and the service-role value was
transferred directly from the active Supabase project without printing or
storing it in the repository. The remaining two required names are absent:
`AZURE_SUBSCRIPTION_ID` and `ENRICH_SHARED_SECRET`.

The active Supabase project contains an `ENRICH_SHARED_SECRET`, but its value is
write-only through the available administration boundary and the database
correctly refuses direct reads from `private.enrichment_config`. Do not create a
placeholder. Either the existing value must be supplied through an authorized
secure handoff, or a separately approved rotation must update the Supabase
function secret, canonical private cron configuration, and protected GitHub
environment together.

The Azure portal subscription inventory for the publisher directory reports
**zero subscriptions**. Therefore no production resource group or scoped Azure
role assignment can be created, and the production workflow is not
dispatch-ready. Creating or purchasing a subscription is a separate financial
decision and is not implied by the identity bootstrap. Repository-level
inventory still contains only `SUPABASE_ACCESS_TOKEN` and `XAI_API_KEY`; neither
supplies the deployment, runtime, Entra SSO, or Marketplace publisher contract.
The non-secret `ENTRA_SSO_TENANT=common` repository variable is present.

### Cost-controlled subscription decision

Do not default directly to a pay-as-you-go production subscription. Use this
order:

1. Inspect any Azure-credit entitlement already attached to the Microsoft AI
   Cloud Partner Program account.
2. Apply to Microsoft for Startups Founders Hub if Stigg Technologies is
   eligible. Microsoft currently describes it as no-cost to join with staged
   access to as much as US$150,000 in Azure credits; neither eligibility nor an
   award is assumed.
3. If an immediate paid partner route is required, compare the current Partner
   Launch Benefits package (US$350/year with US$700 in bulk Azure credits) with
   the forecast first-year Azure burn before purchase.
4. Use pay-as-you-go only when the credit routes are unavailable or delay is
   more expensive than the cash outlay, and obtain explicit financial approval
   before creating the subscription.

The currently signed-in Partner Center user cannot inspect or redeem Azure
benefits because the account does not hold the `Microsoft AI Cloud Partner
Program Partner Admin` role. Granting that role changes cloud-account
permissions and requires separate action-time approval. No package,
subscription, or benefit has been purchased or activated.

This is a name-and-policy inventory only; it does not expose or prove any secret
value. Do not dispatch the Azure production workflow until all eight environment
secret names below are present, the federation is saved, a real subscription
and resource group are selected, and the Azure identity/resource-scope witness
is attached.

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

Bootstrap the protected environment in this order:

1. Obtain action-time approval to create paid Azure production resources and to
   change the canonical enrichment route after deployment proofs pass.
2. Pre-create or explicitly approve the `rg-syncai-production` resource group
   in `canadacentral`, so the deployment identity can be scoped to the resource
   group rather than granted open-ended subscription authority.
3. Create the dedicated GitHub OIDC Entra identity and federated credential for
   the immutable subject
   `repo:Stiggtechnologies@<organization-id>/ai-maintenance-system@<repository-id>:environment:azure-production`.
4. Grant only the resource deployment and scoped role-assignment permissions
   required by the templates, recording the client, tenant, subscription and
   principal object IDs without placing credentials in source control.
5. Populate the eight environment secrets through the GitHub protected-secret
   interface. Never echo, paste into chat, log or commit the service-role key or
   shared caller secret.
6. Re-run a names-only inventory and confirm the workflow's fail-closed
   prerequisite list exactly matches the environment.
7. Merge the reviewed deployment machinery to protected `main`, then request a
   separate action-time confirmation before dispatching the paid production
   workflow.

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

The A6 meter consumes only settled rows from the existing
`private.llm_usage` ledger (`reserved = false`). It never accepts a quantity
from a browser or API caller and never stores prompts or completions. For each
active, subscribed Azure Marketplace billing record it converts cumulative
token use through one explicitly configured plan/dimension definition, removes
the included quantity once per subscription term, and creates at most one
emission record per subscription, dimension, and UTC hour. A late-settling
usage row is carried into the next unsent hour as the remaining cumulative
delta instead of being discarded or double-counted. Microsoft submissions use
the batch API in groups of no more than 25 and preserve the exact accepted,
duplicate, expired, rejected, or conflicting response and correlation IDs.

Production dispatch remains a deliberate no-op until these repository settings
are supplied together:

- Secret `SUPABASE_SERVICE_ROLE_KEY`, used only by the protected deployment and
  stored in the private dispatcher configuration.
- Variables `AZURE_MARKETPLACE_METER_PLAN_ID` and
  `AZURE_MARKETPLACE_METER_DIMENSION`, matching the Partner Center plan and
  custom meter exactly.
- Variables `AZURE_MARKETPLACE_METER_UNIT_SIZE`,
  `AZURE_MARKETPLACE_METER_INCLUDED_QUANTITY`, and
  `AZURE_MARKETPLACE_METER_QUANTITY_SCALE`, defining the reviewed conversion
  from canonical token counts to billable Marketplace units.

The protected deployment refuses partial configuration. Even when configured,
the code and production boundary probes are not commerce evidence: Gate A7
must witness an accepted preview-offer event, its exact duplicate behavior,
the Partner Center usage view, included-quantity reconciliation, suspension,
and a deliberately rejected event before A6 can be treated as buyer-proven.

## Gate A7 protected preview certification

The manual **Azure Marketplace preview certification** workflow is the only
repository automation allowed to emit a Gate A7 pass report. It runs in the
protected `azure-production` environment and fails closed unless all publisher,
offer, meter, Supabase service, and preview-subscription inputs are present.
The suite does not create a purchase, activate a tenant, invent canonical
usage, or change an entitlement.

Use two preview purchases so terminal cancellation evidence does not destroy
the active subscription needed for metering and authoritative status checks:

1. On the primary preview subscription, complete governed activation, plan
   change, quantity change, renewal, suspension, and reinstatement. Generate
   real settled SyncAI usage above the included quantity and wait for one
   accepted hourly event.
2. On a separate preview subscription, complete governed activation and then
   unsubscribe. The canonical billing row must be `cancelled` and the retained
   resolution must be `Unsubscribed`; no evidence may be deleted.
3. Capture the Partner Center usage view after Microsoft displays the primary
   event. Retain the original artifact, calculate its SHA-256, and provide a
   stable reference without an access token, query string, or fragment. The
   protected run refuses evidence captured before the accepted canonical meter
   event or more than 24 hours earlier.
4. Have one person witness the buyer and Partner Center flow and a different
   person review the reconciliation. Supply both identities to the protected
   workflow.
5. Run the workflow while the accepted primary event is less than 23 hours
   old. It safely resubmits that exact resource, plan, dimension, hour, and
   quantity to witness Microsoft's `Duplicate` response. It separately submits
   one random nonexistent resource ID to witness a non-billable rejection.

The generated JSON artifact contains the Git commit and workflow run, hashed
publisher, offer, subscription and external-reference identifiers, the exact
plan and meter dimension, canonical checks, external-evidence digest, hashed
human-witness identities, and a SHA-256 of the report. It deliberately contains no purchase
token, bearer token, client secret, prompt, completion, email, or Entra object
ID. A green
suite means the preview evidence passed SyncAI's controlled A7 checks; it does
not mean Microsoft has certified or published the offer. Partner Center remains
the authority for Gate A8.

Before the workflow reports success, a service-only database function repeats
the canonical entitlement, lifecycle, unsubscribe, and recent accepted-meter
checks and appends the report digest and hashed identifiers to the existing
append-only `audit_events` ledger. Re-running the same report is idempotent.
There is no parallel certification ledger and no mutation or deletion path.

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
- [Microsoft partner benefit packages and current Azure-credit amounts](https://partner.microsoft.com/en-US/partnership/partner-benefits-packages-benefits)
- [Use Azure credits in Partner Center](https://learn.microsoft.com/en-us/partner-center/benefits/mpn-benefits-azure-cloud)
- [Microsoft partner-program comparison and Founders Hub](https://partner.microsoft.com/en-us/partnership/compare-programs/)

These URLs describe current external rules; Partner Center validation remains
the authority at submission time.

# Supplemental content — controlled answer set

**Status: draft with external evidence blockers. Do not represent this page as
complete until the Azure subscription and consumption witnesses are attached.**

Microsoft uses the Supplemental content page to assess whether a transactable
SaaS offer is primarily platformed on Azure and complies with Marketplace
policy. A code design or undeployed resource template is not sufficient
evidence.

## Product functionality

### Copy-ready description

> SyncAI is a governed industrial engineering intelligence workspace for asset
> and reliability teams. It links organization-scoped operational records,
> asset and component context, engineering evidence, deterministic calculations
> where inputs support them, AI-assisted analysis, recommendations, human
> approvals, work context, outcomes, and audit history. Users investigate
> equipment issues and structure evidence-backed decisions; SyncAI does not
> independently authorize consequential operational action.

### Customer and use case

> The intended users are industrial reliability, maintenance, engineering, and
> asset-management teams. Typical uses include equipment issue investigation,
> evidence grading, failure and inspection analysis, reliability modelling,
> recommendation review, and preserving the evidence and rationale behind an
> engineering decision. Delivered capabilities depend on the configured data,
> purchased scope, deployment, and agreement.

## Azure architecture

### Copy-ready architecture description

> The SyncAI Azure edition is designed with Azure Container Apps for the web
> workload and governed intelligence worker, Azure Container Registry for
> immutable images, user-assigned managed identities, Azure Key Vault for
> runtime secrets, Log Analytics and workspace-based Application Insights, and
> Azure OpenAI for explicitly deployed inference. GitHub Actions uses workload
> identity federation rather than a client secret for deployment. The
> intelligence worker reuses SyncAI's canonical recommendation, evidence,
> approval, usage, and audit records; it does not create a separate decision or
> approval store. Consequential action remains human-controlled.

### Mandatory qualification immediately following that description

> As of 2026-10-03, the repository contains the Azure deployment and validation
> machinery, but production deployment and commensurate Azure consumption have
> not been evidenced in this package. Existing Supabase/Vercel production
> remains authoritative during the controlled transition. SyncAI must not be
> described as primarily platformed on Azure until a protected production
> deployment and Azure billing/usage evidence demonstrate that the
> Azure-hosted plane is the resource whose consumption grows with customer use.

If the Partner Center form does not permit this qualification next to the
architecture description, do not submit a misleading answer. Close the Azure
deployment evidence first.

## Azure service inventory

| Service | Intended role | Repository evidence | Publication evidence state |
| --- | --- | --- | --- |
| Azure Container Apps | Web workload and intelligence worker | `infra/azure`, `docs/azure-marketplace.md` | Deployment witness required |
| Azure Container Registry | Immutable application images | `infra/azure`, deployment workflow | Digest and deployed resource witness required |
| User-assigned managed identity | Registry, Key Vault and Azure OpenAI access | IaC and deployment workflow | Role-assignment witness required |
| Azure Key Vault | Runtime secrets via references | IaC and deployment workflow | Deployed vault/configuration witness required; never attach secret values |
| Azure OpenAI | Strict Azure inference plane | IaC, worker and protected probes | Approved model/region/SKU and successful bounded probe required |
| Log Analytics / Application Insights | Runtime diagnostics | IaC | Deployed workspace and telemetry witness required |
| Microsoft Entra ID | Buyer sign-in and publisher service identities | Auth and Marketplace implementation | Non-publisher tenant sign-in and exact app/tenant configuration witness required |
| Marketplace Fulfillment APIs v2 | Resolve, activate and status lifecycle | Edge Functions and database contracts | Real preview purchase witness required |
| Marketplace Metering Service | Usage submission for an approved dimension | Code and protected dispatcher | Approved plan/dimension plus accepted live preview event required |

## Owner-supplied fields

Replace these only from Partner Center/Azure evidence. Do not infer them from
source code or local CLI account access.

| Field | Required controlled value | Status |
| --- | --- | --- |
| Azure subscription ID hosting the product | `[OWNER EVIDENCE: subscription GUID]` | Blocked |
| Subscription owner / internal evidence custodian | `[OWNER DECISION: name and role]` | Blocked |
| Resource group(s) | `[DEPLOYMENT EVIDENCE]` | Blocked |
| Production region(s) | `[DEPLOYMENT EVIDENCE plus data-processing/residency approval]` | Blocked |
| Azure OpenAI region, model, version and SKU | `[DEPLOYMENT EVIDENCE and owner approval]` | Blocked |
| Monthly Azure consumption or other requested usage measure | `[AZURE COST/USAGE EXPORT for production scope]` | Blocked |
| Architecture diagram | `[REVIEWED diagram matching deployed resources and external dependencies]` | Blocked |
| External infrastructure dependencies | `Supabase/Vercel remain authoritative during transition; update from deployed truth` | Known limitation; certification review required |

## Evidence attachment inventory

Attach sanitized evidence; never upload credentials, access tokens, customer
records, prompts, completions, or production secrets.

- Azure resource inventory scoped to the named subscription/resource group.
- Successful protected Azure production deployment run and immutable image
  digests.
- Container App revision details and health proof.
- Managed identity and scoped role assignment evidence.
- Key Vault reference configuration with values redacted.
- Azure OpenAI deployment identity, approved region/model/version/SKU, and
  successful bounded non-persistent probe.
- Azure consumption/cost export covering an agreed representative period.
- Architecture/data-flow diagram showing Azure and non-Azure dependencies.
- Marketplace preview resolve, activation, lifecycle and metering evidence.
- Named reviewer attestation that the description matches the deployed state.

## Policy-safe representations

Permitted:

- “Azure edition deployment machinery is implemented in code.”
- “Marketplace fulfillment, lifecycle, metering, and preview-certification
  controls are implemented but not buyer-proven.”
- “The system keeps consequential operational decisions subject to human
  authority.”

Not permitted until separately evidenced:

- “Primarily platformed on Azure.”
- “Microsoft certified,” “Marketplace certified,” “transactable,” “published,”
  “MACC eligible,” or “co-sell ready.”
- Any assurance certification, availability, response-time, savings, ROI,
  accuracy, data-residency, private deployment, or connector claim not listed
  as authorized in the claims register.

Official reference: [Add supplemental content for a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-supplemental).

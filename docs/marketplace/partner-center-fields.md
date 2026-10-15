# Partner Center field copy

**Status: controlled draft. Bracketed `OWNER DECISION` markers must be replaced
with approved values; never paste the marker itself into a public listing.**

## Offer listing

### Name

`SyncAI Industrial Engineering Intelligence`

Owner check: confirm this is the existing public offer name before changing it.

### Search results summary (100 characters maximum)

`Governed condition monitoring and reliability decision support for industrial asset teams.`

Length: 90 characters.

### Description

> SyncAI helps industrial asset teams turn condition readings, work history,
> operating context, asset data, and engineering evidence into traceable
> reliability decisions. It combines organization-scoped records,
> evidence-linked engineering knowledge, governed AI-assisted analysis, and
> deterministic engineering methods in one workspace.
>
> Current pilot capabilities include governed condition monitoring across
> vibration, oil analysis, thermography, motor current, and process-condition
> signals; evidence-graded FRACAS, root-cause, inspection, and failure-analysis
> workflows; censored life-data analysis; selected deterministic reliability
> and physics-of-failure calculations; asset onboarding; downtime-recovery
> coordination; and auditable decision cases. Analyses expose data-quality,
> context, applicability, and evidence gaps rather than inventing a diagnosis,
> threshold, or source record.
>
> SyncAI can begin with customer-provided exports and supports integration
> patterns using APIs, database views, file exchange, event streams, or a
> customer-side gateway. Read-only CMMS connector patterns include generic
> HTTPS JSON, SAP PM, IBM Maximo, and Oracle EAM for scoped validation.
> Production connectors and historian links are configured and validated for
> each customer environment.
>
> Consequential recommendations remain subject to named human review and
> approval. SyncAI does not autonomously change engineering limits,
> maintenance intervals, work orders, schedules, asset state, or return
> equipment to service. It does not replace qualified engineering judgment,
> operating authority, legal requirements, OEM limits, or site procedures.
> Availability depends on the purchased scope, authorized data, deployment,
> and applicable agreement. No savings, uptime, failure-avoidance, accuracy,
> certification, or ROI outcome is guaranteed.

### Getting started instructions

> 1. After purchase, select **Configure account** in Microsoft Marketplace.
> 2. Sign in on the SyncAI Marketplace page with the Microsoft identity used
>    for the purchasing organization.
> 3. Review the resolved offer, plan, and subscription details. Do not continue
>    if they do not match the purchase.
> 4. An administrator of an existing SyncAI organization with the matching
>    verified Microsoft tenant must confirm activation. A Microsoft sign-in
>    alone does not create a production tenant, grant a role, or activate the
>    subscription.
> 5. After activation, follow the workspace onboarding steps. Contact
>    support@syncai.ca if the purchase cannot be resolved or the organization
>    cannot be matched.

### Search keywords

1. `condition monitoring`
2. `asset reliability`
3. `maintenance engineering`

### Contacts and URLs

| Partner Center field | Value | Status |
| --- | --- | --- |
| Support contact email | `support@syncai.ca` | Repository-backed; owner must confirm monitored response process |
| Engineering contact email | `[OWNER DECISION: named monitored engineering contact]` | Blocked |
| Privacy policy URL | `[OWNER ACTION: publish a directly addressable HTTPS privacy policy]` | Blocked; the SPA `/privacy` path does not select the policy page on a fresh load |
| Terms URL / EULA | `[OWNER ACTION: select Microsoft Standard Contract or publish approved terms and amendments]` | Blocked; obtain legal approval |
| Support URL, if requested | `[OWNER ACTION: publish support page, or confirm Partner Center accepts the support contact fields without one]` | Blocked |
| Useful link — product | `https://syncai.ca` | Owner must verify current content is consistent with the claims register |
| Useful link — documentation | `[OWNER ACTION: publish reviewed customer documentation]` | Blocked |

## Technical configuration

| Field | Controlled value | Status and operator note |
| --- | --- | --- |
| Landing page URL | `https://app.syncai.ca/marketplace/activate` | Saved in the Partner Center draft on 2026-10-06. Custom-domain HTTP 200 and signed-out activation UI observed; source-commit aliasing, first purchase, and returning manage flow remain unproven |
| Connection webhook | `https://app.syncai.ca/api/marketplace/webhook` | Saved in the Partner Center draft on 2026-10-06. Custom-domain `GET` returns `405` with `Allow: POST` and unsigned JSON `POST` returns the proxy's expected `401`, but those paths do not resolve or confirm the upstream project |
| Microsoft Entra tenant ID | `[OWNER VERIFY: exact publisher tenant GUID already configured]` | Must match server secret and webhook token validation |
| Microsoft Entra application ID | `[OWNER VERIFY: exact Marketplace publisher application GUID already configured]` | Must match webhook audience and publisher credentials |
| Auto activation | `No / Off` | Required by the current manual-activation contract |

Do not place secrets, SAS tokens, keys, or authorization material in either
URL. The webhook authenticates the Microsoft bearer token sent in the
`Authorization` header.

### App-domain route witness and production gate

Merged PR #602 implements these controlled same-origin values:

- `https://app.syncai.ca/marketplace/activate`
- `https://app.syncai.ca/api/marketplace/webhook`

Custom-domain route observations passed on 2026-10-03: the activation path
visibly rendered the bounded Marketplace no-token state, webhook `GET` returned
`405` with `Allow: POST`, and an unsigned JSON `POST` returned the proxy's `401`
token refusal. On 2026-10-06, Vercel project inventory and a redacted production
environment witness verified that `app.syncai.ca` is the production URL of the
`syncai-github` project and that the proxy targets the active Supabase project
named `SyncAI`. The upstream project has active Marketplace fulfillment,
webhook, and metering functions.

Both URLs were saved to the correct Partner Center offer draft on 2026-10-06.
That draft entry and the upstream witness are evidence of configuration, not of
a working paid purchase. The live SyncAI Supabase project contains the verified
client ID, tenant ID, publisher ID, and offer ID, but it does not contain
`AZURE_MARKETPLACE_CLIENT_SECRET`. Authenticated resolution, activation,
lifecycle, metering, and certification therefore remain blocked.

## Plans

Microsoft plan descriptions should explain only how the plans differ. These
descriptions are intentionally conservative because the repository contains no
approved tier entitlement matrix.

### Starter

- Proposed Plan ID: `starter`
- Plan name: `Starter`
- Plan description:

> Starter is the entry scope for a bounded SyncAI rollout with one purchasing
> organization. It provides access to the governed industrial engineering
> workspace and human-reviewed reliability decision workflows included in the
> approved order. Exact users, sites, assets, integrations, usage allowance,
> onboarding, retention, support, and service commitments are the values
> published for this plan and in the applicable agreement. Starter does not
> authorize autonomous operational action or include an uncontracted SLA,
> certification, production connector, or outcome guarantee.

- Pricing model: `[OWNER DECISION: flat rate OR flat rate plus metered billing]`
- Billing term and price: `[OWNER DECISION]`
- Markets/currencies/tax handling: `[OWNER DECISION]`
- Included usage and dimensions: `[OWNER DECISION; must match the meter configuration exactly]`
- Free trial: `[OWNER DECISION; do not enable without an approved trial lifecycle]`
- Visibility: `[OWNER DECISION: public or named private audience]`
- Auto activation: `Off`

### Professional

- Proposed Plan ID: `professional`
- Plan name: `Professional`
- Plan description:

> Professional is an expanded commercial scope for teams that need a broader
> governed rollout than Starter. It provides the same evidence, recommendation,
> approval, and human-authority boundaries across the users, sites, assets,
> integrations, and usage allowance explicitly published for this plan and in
> the applicable agreement. Professional does not by itself promise production
> enterprise SSO, private deployment, a specific connector, an SLA, or a
> quantified business outcome.

- Pricing model: `[OWNER DECISION: must be compatible with the offer-wide pricing model]`
- Billing term and price: `[OWNER DECISION]`
- Markets/currencies/tax handling: `[OWNER DECISION]`
- Included usage and dimensions: `[OWNER DECISION; must match the meter configuration exactly]`
- Free trial: `[OWNER DECISION]`
- Visibility: `[OWNER DECISION: public or named private audience]`
- Auto activation: `Off`

### Enterprise

- Proposed Plan ID: `enterprise`
- Plan name: `Enterprise`
- Plan description:

> Enterprise is a contract-defined organizational rollout of SyncAI's governed
> industrial engineering workspace. The purchased scope may cover additional
> organizations, sites, assets, integrations, deployment controls, onboarding,
> and support only when those items are explicitly published for the plan and
> agreed in the order. The plan name alone does not represent production SSO,
> private or on-premises hosting, data residency, 24/7 support, an SLA, SOC 2 or
> ISO certification, autonomous control, or guaranteed savings, uptime,
> accuracy, failure avoidance, or ROI.

- Pricing model: `[OWNER DECISION: must be compatible with the offer-wide pricing model]`
- Billing term and price: `[OWNER DECISION]`
- Markets/currencies/tax handling: `[OWNER DECISION]`
- Included usage and dimensions: `[OWNER DECISION; must match the meter configuration exactly]`
- Free trial: `[OWNER DECISION]`
- Visibility: `[OWNER DECISION: public or named private audience]`
- Auto activation: `Off`

### Required plan decision record

Before any plan can be marked complete, its owner-approved record must name:

- immutable Plan ID and public name;
- offer-wide pricing model;
- billing term, price and every market-specific price;
- public/private visibility and audience;
- purchaser quantity semantics, if any;
- included and overage quantities;
- meter dimension, unit size, scale and price, if metering is used;
- users, organizations, sites, assets and integrations included;
- onboarding, retention, support hours, response targets and exclusions;
- upgrade/downgrade behavior; and
- contract/version approval with approver and date.

The deployed meter currently supports one explicitly configured plan and
dimension definition at a time. Publishing three metered plans requires an
engineering review that proves the dispatcher configuration and every plan's
dimension contract; plan copy cannot establish that capability.

## CSP reseller audience

The Partner Center draft currently selects **Any partner in the CSP program**.
That choice was saved on 2026-10-06 to support the owner's explicit broad-channel
test strategy. It is a distribution experiment, not evidence that partner-led
demand or delivery readiness has been validated.

Before publication, assign channel support ownership and publish a minimum CSP
enablement pack covering positioning, qualification, implementation boundary,
break-fix routing, service-health communications, pricing rules, and escalation.
Microsoft keeps the publisher responsible for product support; unrestricted
reach therefore creates real representation and support obligations. If those
controls cannot be staffed before release, narrow the audience to **Specific
partners** rather than silently removing the channel test.

## Tax and payout status

Keep two independent records:

| Record | Controlled value | Meaning |
| --- | --- | --- |
| Publisher/user submission | `[OWNER EVIDENCE: form/profile submitted, by whom, when, and receipt if available]` | Records only that information was submitted |
| Partner Center status | `[PARTNER CENTER EVIDENCE: exact displayed validation/assignment state, account, timestamp and screenshot/export]` | Records Microsoft's current processing/assignment result |

On 2026-10-06, every plan's Pricing and availability page displayed: **“This
account is not publish eligible due to either an invalid payout, payout on hold,
or invalid tax.”** The account owner then submitted the Azure Marketplace
assignment using the existing completed Canadian tax profile and Canadian
business-bank payment profile in CAD. Partner Center confirmed **“Your program
profiles are updated.”** The authoritative assignment status now shows tax
**Complete**, payment **Pending Microsoft validation**, and verification **Not
started**. Treat Microsoft payment validation and any subsequent verification
prompt as the current account release gate. Microsoft states that processing
can take up to 48 hours.

Do not mark tax or payout setup complete from an email, verbal report, or a
submitted form alone. The Marketplace release owner must verify that the
commercial marketplace account, tax profile, payout profile, and any market
assignments required for the selected plan markets are accepted in Partner
Center. The per-plan **Tax Remitted** market option describes Microsoft's tax
remittance treatment for a market; it is not evidence that the publisher's tax
or payout profile is validated.

## Supporting documents and media inventory

| Asset | Requirement/posture | Current state | Action |
| --- | --- | --- | --- |
| Marketing PDF | Microsoft requires 1–3 PDFs | Content source drafted | Design, legal/claims review, export accessible PDF, upload |
| Large square logo | PNG, 216–350 px square | Not inventoried in this package | Brand owner supplies reviewed asset |
| Screenshots | Up to five, recommended 1280×720 | Not inventoried | Capture production-like surfaces without customer/confidential data or unsupported claims |
| Video | Optional | None | Do not block initial submission unless owner elects to add one |
| Useful links | Optional | Product site only | Review site claims; publish customer documentation before linking it |

## Official field constraints

- SaaS Plan ID: maximum 50 characters; lowercase alphanumeric, dashes or
  underscores; immutable after publication.
- Plan name: maximum 200 characters.
- Plan description: maximum 3,000 characters.
- Offer search summary: maximum 100 characters.
- Offer description: maximum 5,000 characters including markup and spaces.
- Getting started instructions: maximum 3,000 characters.
- Up to three search keywords.
- Privacy link must begin with HTTPS.
- At least one and at most three supporting marketing PDFs.

Sources: [SaaS plan setup](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-plans),
[SaaS listing details](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing),
and [plans and pricing](https://learn.microsoft.com/en-us/partner-center/marketplace/plans-pricing).

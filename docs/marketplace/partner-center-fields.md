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

| Partner Center field        | Value                                                                                                            | Status                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Support contact email       | `support@syncai.ca`                                                                                              | Repository-backed; owner must confirm monitored response process                                           |
| Engineering contact email   | `[OWNER DECISION: named monitored engineering contact]`                                                          | Blocked                                                                                                    |
| Privacy policy URL          | `https://syncai.ca/privacy`                                                                                      | Exact saved Partner Center value directly rendered a dedicated policy signed out on 2026-11-01             |
| Terms URL / EULA            | `Microsoft Standard Contract selected`                                                                           | Saved selection observed on 2026-11-01; blocked on named legal approval and an explicit amendment decision |
| Support URL, if requested   | `[OWNER ACTION: publish support page, or confirm Partner Center accepts the support contact fields without one]` | Blocked                                                                                                    |
| Useful link — product       | `https://syncai.ca`                                                                                              | Owner must verify current content is consistent with the claims register                                   |
| Useful link — documentation | `[OWNER ACTION: publish reviewed customer documentation]`                                                        | Blocked                                                                                                    |

## Technical configuration

| Field                          | Controlled value                                                                  | Status and operator note                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing page URL               | `https://app.syncai.ca/marketplace/activate`                                      | Saved in the Partner Center draft on 2026-10-06. Custom-domain HTTP 200 and signed-out activation UI observed; source-commit aliasing, first purchase, and returning manage flow remain unproven                                  |
| Connection webhook             | `https://app.syncai.ca/api/marketplace/webhook`                                   | Saved in the Partner Center draft on 2026-10-06. Custom-domain `GET` returns `405` with `Allow: POST` and unsigned JSON `POST` returns the proxy's expected `401`, but those paths do not resolve or confirm the upstream project |
| Microsoft Entra tenant ID      | `[OWNER VERIFY: exact publisher tenant GUID already configured]`                  | Must match server secret and webhook token validation                                                                                                                                                                             |
| Microsoft Entra application ID | `[OWNER VERIFY: exact Marketplace publisher application GUID already configured]` | Must match webhook audience and publisher credentials                                                                                                                                                                             |
| Auto activation                | `No / Off`                                                                        | Required by the current manual-activation contract                                                                                                                                                                                |

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
lifecycle, metering, and certification therefore remain blocked. The
repository-scoped GitHub Actions secrets used by `deploy-migrations.yml` contain
none of the five Marketplace input names, so durable setup must place all five
there as well as the missing runtime secret. Secret values were not inspected
and must never be committed or pasted into chat.

## Plans

Microsoft plan descriptions explain how the plans differ while preserving the
same governed Decision Case product. The commercial authority is
`marketplace/commercial-offer-decision.json`; prices and limits below must match
the approved production policy before a subscription can activate.

### Site Reliability

- Proposed Plan ID: `starter`
- Partner Center resource ID: `792e22d3-8169-4cc5-a422-575799ff78ec`
- Plan name: `Site Reliability`
- Plan description:

> Site Reliability is the public single-site plan for organizations that want
> to reduce the recurrence, duration, and economic impact of unplanned downtime
> through governed reliability decisions. It includes one site, up to 25 named
> users, and up to 20 governed AI-assisted decisions per month, bounded by 100
> model calls and 10 million tokens. Workflows cover evidence intake, failure
> investigation, downtime recovery, preventive-maintenance decisions, human
> approval, audit trail, and verified learning. AI usage stops at the included
> limit; there is no automatic overage. Standard remote product support is
> included. Implementation, integrations, engineering services, custom
> residency, and outcome guarantees require a separate approved order. SyncAI
> does not autonomously control equipment.

- Pricing model: `Flat rate`
- Billing term and price: `One year, USD 5,000 per month (USD 60,000 ACV)`
- Markets: `141 current draft markets, subject to legal, tax and release gates`
- Included usage: `20 governed decisions, 100 model calls and 10,000,000 tokens per month; hard stop`
- Free trial: `Off`
- Visibility: `Public`
- Auto activation: `Off`

### Reliability Network

- Proposed Plan ID: `professional`
- Partner Center resource ID: `c5fd0cf9-b83b-4203-9b21-df1970a17c10`
- Plan name: `Reliability Network`
- Plan description:

> Reliability Network extends the same governed reliability-decision platform
> across up to five sites and 100 named users. It includes up to 60 governed
> AI-assisted decisions per month, bounded by 300 model calls and 30 million
> tokens. Teams use common evidence, failure-investigation, downtime-recovery,
> preventive-maintenance, approval, audit, cost and verified-learning workflows
> without transferring operational authority to SyncAI. AI usage stops at the
> included limit; there is no automatic overage. Enhanced remote product
> support is included. Rollout, integrations, engineering services, custom
> residency, service levels and outcome guarantees require a separate approved
> order.

- Pricing model: `Flat rate`
- Billing term and price: `One year, USD 15,000 per month (USD 180,000 ACV)`
- Markets: `Named private audience in approved markets`
- Included usage: `60 governed decisions, 300 model calls and 30,000,000 tokens per month; hard stop`
- Free trial: `Off`
- Visibility: `Private`
- Auto activation: `Off`

### Enterprise Reliability

- Proposed Plan ID: `enterprise`
- Partner Center resource ID: `7a494a0b-e89f-4211-8cf6-46c6d187b1ab`
- Plan name: `Enterprise Reliability`
- Plan description:

> Enterprise Reliability standardizes SyncAI's governed reliability-decision
> platform across up to 15 sites and 250 named users. It includes up to 120
> governed AI-assisted decisions per month, bounded by 600 model calls and 60
> million tokens, with shared evidence, failure-investigation,
> downtime-recovery, preventive-maintenance, approval, audit, cost and
> verified-learning workflows. AI usage stops at the included limit; there is
> no automatic overage. Enterprise remote product support is included. Custom
> rollout, integrations, deployment controls, residency, 24/7 support, service
> levels, certifications and outcome guarantees require a separate approved
> order. SyncAI does not autonomously control equipment.

- Pricing model: `Flat rate`
- Billing term and price: `One year, USD 30,000 per month (USD 360,000 ACV)`
- Markets: `Named private audience in approved markets`
- Included usage: `120 governed decisions, 600 model calls and 60,000,000 tokens per month; hard stop`
- Free trial: `Off`
- Visibility: `Private`
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

| Record                    | Controlled value                                                                                                   | Meaning                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Publisher/user submission | `[OWNER EVIDENCE: form/profile submitted, by whom, when, and receipt if available]`                                | Records only that information was submitted              |
| Partner Center status     | `[PARTNER CENTER EVIDENCE: exact displayed validation/assignment state, account, timestamp and screenshot/export]` | Records Microsoft's current processing/assignment result |

On 2026-10-06, every plan's Pricing and availability page displayed: **“This
account is not publish eligible due to either an invalid payout, payout on hold,
or invalid tax.”** The account owner then submitted the Azure Marketplace
assignment using the existing completed Canadian tax profile and Canadian
business-bank payment profile in CAD. Partner Center confirmed **“Your program
profiles are updated.”** That submission did not clear eligibility. On
2026-11-01 the authoritative assignment status showed tax **Complete**, payment
**Action required**, and verification **Not started**; the selected CAD payment
profile stated that its bank profile needs to be updated. Update that existing
bank profile, return to the Azure Marketplace assignment and complete any
verification prompt. The previous 48-hour processing window has elapsed, so
open a Microsoft support case if the completed profile remains ineligible.

Do not mark tax or payout setup complete from an email, verbal report, or a
submitted form alone. The Marketplace release owner must verify that the
commercial marketplace account, tax profile, payout profile, and any market
assignments required for the selected plan markets are accepted in Partner
Center. The per-plan **Tax Remitted** market option describes Microsoft's tax
remittance treatment for a market; it is not evidence that the publisher's tax
or payout profile is validated.

## Supporting documents and media inventory

| Asset             | Requirement/posture              | Current state                   | Action                                                                                    |
| ----------------- | -------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| Marketing PDF     | Microsoft requires 1–3 PDFs      | Content source drafted          | Design, legal/claims review, export accessible PDF, upload                                |
| Large square logo | PNG, 216–350 px square           | Not inventoried in this package | Brand owner supplies reviewed asset                                                       |
| Screenshots       | Up to five, recommended 1280×720 | Not inventoried                 | Capture production-like surfaces without customer/confidential data or unsupported claims |
| Video             | Optional                         | None                            | Do not block initial submission unless owner elects to add one                            |
| Useful links      | Optional                         | Product site only               | Review site claims; publish customer documentation before linking it                      |

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

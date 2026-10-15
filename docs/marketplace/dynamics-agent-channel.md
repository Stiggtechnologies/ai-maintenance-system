# Dynamics agent distribution channel

**Status: qualified channel hypothesis — no Dynamics-native package, offer,
preview, certification, or publication exists.**

## Decision

Microsoft Dynamics is a valid distribution channel for focused SyncAI agents.
It is not the correct offer type for the whole SyncAI platform.

Use one governed SyncAI product and data plane, then package selected agents as
host-native acquisition and workflow surfaces. Each agent listing must solve a
specific Dynamics user problem, install or provision through the selected
Microsoft offer model, preserve SyncAI's human-approval and evidence controls,
and route qualified customers into the same governed SyncAI platform and
underlying tenant. Do not
fork the decision model, agent authority, audit history, or customer record.

Microsoft's current offer definitions explicitly include AI apps and agents
supporting Dynamics 365 products. The commercial route differs by offer family:

- **Dynamics 365 Operations Apps** supports ERP, finance, manufacturing and
  supply-chain applications or agents. Treat it first as an in-product
  discovery, trial, or lead surface for a focused agent; it is not a substitute
  for the core transactable SaaS checkout.
- **Dynamics 365 apps on Dataverse and Power Apps** supports AI apps and agents
  for those products and can support per-user Marketplace transactions. It
  requires a real Dataverse/Power Apps technical package and Microsoft license
  management, not only a link to SyncAI.
- **Microsoft 365 and Copilot agents** use their own technical manifest and can
  be monetized through a linked SaaS offer. This is a later surface for briefing
  and conversational agents, not a Dynamics offer by default.

## CEO product-line decision

Use **SyncAI Industrial Reliability Agents** as the customer-facing product-line
name. Keep **SyncAI** as the platform and commercial account; the agents are
bounded entry products, not separate companies, data planes, tenants, decision
models, or approval systems.

Name every offer with the pattern **SyncAI + buyer problem or outcome + Agent**.
Do not lead with an internal module name, an unexplained reliability acronym, or
an autonomy claim. In particular:

- use **Agent** for the commercial product and Marketplace offer name;
- use **copilot** only as a descriptive experience term, or the exact
  **works with Microsoft 365 Copilot** compatibility statement after a real
  Microsoft 365 package and integration are proven;
- do not use `Copilot` in an owned SyncAI product name without Microsoft
  trademark review;
- do not use `autonomous` while consequential actions remain human-approved;
- keep FRACAS, RCA, MRO, RCM and PM as search keywords or explanatory copy
  unless the target buyer routinely uses the acronym; and
- use `for Dynamics 365 Supply Chain Management` as a listing subtitle or
  compatibility statement, not as part of the owned product-line name.

The two terms therefore have different jobs:

- **Agents are what customers discover, evaluate, buy, activate and govern.**
  Each agent has a bounded job, evidence contract and named-human approval
  boundary.
- **The copilot is how a person can converse with those agents.** It is a shared
  interface or Microsoft host, not a second product catalogue. A customer can
  ask the copilot to start a failure investigation, while the Failure
  Investigation Agent performs the bounded workflow and creates the auditable
  decision case.

This is a commercial naming decision, not trademark clearance. Targeted web and
Marketplace checks found that `Maintenance Planning Agent`, `Asset Strategy
Agent`, `Parts Readiness Agent`, `PM Optimization Agent`, and generic
`Reliability Agent` naming are already used by other industrial-software
vendors. No exact Microsoft Marketplace match was found for `Failure
Investigation Agent` in the targeted check, and the complete umbrella phrase
`SyncAI Industrial Reliability Agents` was materially less crowded in the same
checks. Search results are not legal clearance; legal and trademark review
remains a release gate.

## Best-fit customer population

The primary population is not every Dynamics user. It is an account and role
subset with all of the following characteristics:

- asset-intensive operations where an equipment stop affects production,
  service, safety, quality, or customer commitments;
- Dynamics 365 Supply Chain Management, Asset Management, Field Service, or a
  Dataverse workflow already contains useful asset, work-order, inventory,
  procurement, or service evidence;
- repeated failures, readiness gaps, slow restoration, weak evidence, or
  preventive-maintenance waste are visible business problems; and
- a named human remains accountable for work release, purchasing, strategy,
  risk acceptance, and return to service.

Prioritize multi-site manufacturing and process operations first, then mining,
energy, utilities, transportation and other physical-asset fleets where the
same workflow and evidence tests fit. Industry labels are targeting
hypotheses—not proof of customer demand.

| Buying or operating role                     | Pain that opens the conversation                                                                               | Best named entry agent                           | Expansion path into SyncAI                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Maintenance planner or supervisor            | Work cannot start because scope, parts, labour, tools, permits, or timing are not ready                        | **SyncAI Maintenance Readiness Agent**           | Planning, materials, scheduling, handover, Recovery and governed decision cases                     |
| MRO, inventory, or procurement manager       | Critical spares are missing while excess and obsolete stock consume working capital                            | **SyncAI Maintenance Readiness Agent**           | Materials evidence, supplier/delivery risk, asset strategy and site expansion                       |
| Reliability engineer or reliability manager  | The same failures recur because evidence, causes, actions, and effectiveness are not closed                    | **SyncAI Failure Investigation Agent**           | FRACAS/RCA, condition evidence, strategy updates, verified outcomes and fleet learning              |
| Site maintenance or operations manager       | A disruption lasts longer because blockers, decisions, handoffs, and return-to-service evidence are fragmented | **SyncAI Downtime Recovery Agent**               | Recovery control, scheduling, materials, shift handover, economics and multi-site operating cadence |
| Asset strategy or maintenance-program owner  | Static PM intervals create avoidable work or leave material failure risk untreated                             | **SyncAI Preventive Maintenance Decision Agent** | Asset strategy, lifecycle economics, condition monitoring and governed programme change             |
| Plant, maintenance, or reliability executive | Leaders cannot see the evidence, exposure, decision owner, cost track, and verified result in one view         | **SyncAI Reliability Briefing Agent**            | Enterprise roll-up and cross-site expansion after the core executive role is proven complete        |

Microsoft's own Asset Management process identifies asset management,
operations, procurement, finance, IT, compliance, and executive leadership as
participants. That makes the first three rows the daily users and champions,
while plant, finance, and executive leadership are the economic and governance
buyers. Microsoft also positions Supply Chain Management around reducing costly
machine downtime, improving OEE, coordinating maintenance with production, and
managing spare parts—direct alignment with the first two entry agents.

## Recommended experiment sequence

| Sequence | Agent-shaped offer                               | Microsoft surface                                                                                                                               | Existing SyncAI capability basis                                                                                                                                                                                | What must be built before listing                                                                                                                                              |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **SyncAI Maintenance Readiness Agent**           | Dynamics 365 Operations Apps, aimed at Supply Chain Management and Asset Management users                                                       | Governed MRO Materials plus Planning and Scheduling capabilities; exact catalogue, stock, demand, BOM, supplier, delivery and work-plan evidence; no autonomous purchasing, stock mutation, or schedule release | Dynamics-native launch surface, authenticated tenant binding, read-only Dynamics contracts, install/remove path, support runbook, trial or lead handoff and Marketplace assets |
| 2        | **SyncAI Failure Investigation Agent**           | Dynamics 365 apps on Dataverse and Power Apps, with Field Service as the first workflow hypothesis; pain-led core-SaaS landing path in parallel | Governed FRACAS/RCA workflow on `/reliability`; immutable investigation evidence, recurrence measurement and named-human corrective-action/effectiveness handoff                                                | Dataverse solution package, schema and permission model, environment install/remove proof, per-user licensing, app-license checks and certification evidence                   |
| 3        | **SyncAI Downtime Recovery Agent**               | Dynamics 365 apps on Dataverse and Power Apps; Microsoft 365/Teams notification surface only after the canonical workflow is preserved          | Governed Sync Recovery control, optimize and learn surfaces; blocker, handoff, parts-risk, timing, counterfactual and economic evidence with human return-to-service authority                                  | Native incident/restoration case surface, authorized event and work-order mapping, notification boundary, install/remove proof and clean handoff to canonical Recovery         |
| 4        | **SyncAI Preventive Maintenance Decision Agent** | Dynamics 365 Operations Apps                                                                                                                    | Governed Asset Strategy Agent on `/reliability/intervals`; PM interval, condition-inspection and run-to-failure screening with fail-closed safety and cost evidence                                             | Native asset/maintenance-plan context, source-version binding, review experience and certification evidence                                                                    |
| 5        | **SyncAI Reliability Briefing Agent**            | Microsoft 365 and Copilot, linked to the core SaaS offer                                                                                        | Site Maintenance Manager handover is governed and live; the broader Maintenance Executive capability is still incomplete in the current capability register                                                     | Close the core executive role, produce a Microsoft 365/Copilot manifest, prove tenant-safe retrieval and link licensing to the published SaaS offer                            |

Sequence 1 and 2 are the launch pair. They test different pains and different
champions while entering the same platform:

- **Readiness message:** reduce avoidable downtime caused by missing parts and
  incomplete work plans.
- **Failure-investigation message:** investigate repeat failures and close the
  evidence-to-action and effectiveness loop.

`Failure Investigation` is the product job; `failure elimination` is a desired
and measurable customer outcome. The listing may test outcome-led copy such as
"from failure investigation to verified failure elimination," but it must not
promise root-cause certainty, recurrence elimination or savings before customer
evidence verifies the result.

Keep the product names and downstream experience stable; randomize the approved
listing/landing message and preserve source, offer and variant attribution. Do
not launch five offers at once. Advance Recovery only after the launch pair
produces comparable qualified-lead, activation, first-decision, paid-conversion,
verified-outcome and expansion evidence.

## Market-size evidence and $100M scale math

Microsoft does not publish a current standalone total for Dynamics 365 active
users or paid seats. Do not repeat third-party estimates as fact. The latest
explicit official adjacent-population figure found is **56 million monthly
active Power Platform users** in Microsoft FY2025 Q3. Power Platform overlaps
the Dynamics ecosystem but is broader than Dynamics 365, so 56 million is a
reach indicator and scenario denominator—not a Dynamics user count, serviceable
market, forecast, or demand witness.

The following arithmetic shows that this channel is large enough to test. It
does not approve pricing or predict conversion:

| Scenario                         | Pure arithmetic                             | Evidence boundary                                                              |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Adjacent-user reach illustration | 0.1% of 56 million = 56,000 users           | Not a forecast; the relevant Dynamics and asset-intensive subset is unknown    |
| Seat-led $100M illustration      | 56,000 × US$150/month × 12 = US$100.8M ARR  | US$150 is a scenario input, not approved SyncAI agent pricing                  |
| Enterprise expansion path A      | 100 customers × US$1M ARR = US$100M ARR     | Requires full-platform enterprise value and renewals, not agent installs alone |
| Enterprise expansion path B      | 250 customers × US$400k ARR = US$100M ARR   | Requires repeatable multi-site expansion                                       |
| Enterprise expansion path C      | 500 customers × US$200k ARR = US$100M ARR   | Requires efficient acquisition and durable retention                           |
| Enterprise expansion path D      | 1,000 customers × US$100k ARR = US$100M ARR | Requires a much broader sales and support engine                               |

The operating thesis is therefore **agent entry, platform expansion**. Measure
each offer through one comparable funnel:

1. Marketplace impression and listing view;
2. qualified lead, trial, or install by a target maintenance, reliability,
   materials, planning, operations, or asset-management buyer;
3. authorized tenant connection and first governed agent activation;
4. first bounded decision case completed with sufficient evidence;
5. paid agent entitlement or core SaaS purchase;
6. expansion to additional agents, sites, assets, or enterprise scope; and
7. retained usage, verified customer outcome, renewal and net revenue retention.

The channel remains unvalidated until real observations populate that funnel.
Raw Marketplace traffic, free installs and the 56-million ecosystem figure do
not count as revenue evidence.

## Shared product and commercial rules

1. The listing name may foreground one agent and one pain, but the customer
   account, evidence, approvals and outcomes remain in the canonical SyncAI
   platform.
2. A Dynamics install must never create a second agent authority model or bypass
   SyncAI's named-human approval boundaries.
3. The source Dynamics tenant and environment must map to exactly one authorized
   SyncAI organization; Microsoft identity alone cannot grant membership.
4. A listing must state whether it is a free install, external trial, lead
   route, per-user Marketplace purchase, or entitlement to the linked SaaS
   offer. Never imply Microsoft checkout where none exists.
5. Every offer gets its own source, campaign, variant and offer identifiers so
   discovery, qualified lead, activation, retained usage, paid conversion and
   platform expansion can be compared with the core SaaS offer.
6. Unsupported uptime, savings, autonomous-control, native-integration,
   certification, co-sell and MACC claims remain prohibited.

## Release gates for any Dynamics agent

- Named Dynamics product and buyer workflow are fixed.
- A native package or manifest exists and installs into a clean test tenant.
- Install, upgrade and uninstall are proven without leaving orphaned access.
- Tenant mapping, least privilege, consent, token validation and revocation are
  tested across two separate organizations.
- The Dynamics surface invokes an existing governed SyncAI capability rather
  than duplicating its decision or approval logic.
- Entitlement and licensing match the selected Marketplace interaction model.
- Privacy, terms, support, data-flow description, logo and 1280×720 screenshots
  are approved.
- Preview users complete the pain-to-decision flow and all failure/refusal paths
  before submission.
- Marketplace submission and publication receive separate action-time approval.

## Current evidence boundary

The repository contains the governed MRO Materials, FRACAS/RCA, Planning and
Scheduling, Site Maintenance Manager, Condition Monitoring and Asset Strategy
capabilities that make focused agent products credible. It does **not** contain
a Dynamics solution package, Dataverse package, Marketplace offer, certified
preview, install witness, Dynamics license enforcement or customer demand proof.
This document authorizes discovery and build planning only; it does not
authorize Partner Center submission or publication.

## Microsoft sources

- [Create a Dynamics 365 Operations Apps offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/dynamics-365-operations-offer-setup)
- [Create a Dynamics 365 apps on Dataverse and Power Apps offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/dynamics-365-customer-engage-offer-setup)
- [Microsoft Marketplace listing options](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/determine-your-listing-type)
- [Microsoft Marketplace transaction capabilities](https://learn.microsoft.com/en-us/partner-center/marketplace/marketplace-commercial-transaction-capabilities-and-considerations)
- [Publish and release an AI app or agent](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/artificial-intelligence-app-agent-publish-release)
- [Microsoft 365 app model — agents are apps](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agents-are-apps)
- [Publish agents for Microsoft 365 Copilot](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/publish)
- [Declarative-agent naming and experience guidance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-best-practices)
- [Microsoft FY2025 Q3 earnings call — 56 million monthly active Power Platform users](https://www.microsoft.com/en-us/investor/events/fy-2025/earnings-fy-2025-q3)
- [Dynamics 365 Supply Chain Management product page — downtime, OEE, maintenance and spare-parts positioning](https://www.microsoft.com/en-us/dynamics-365/products/supply-chain-management)
- [Microsoft Asset Management process — stakeholder and maintenance-process map](https://learn.microsoft.com/en-us/dynamics365/guidance/business-processes/acquire-to-dispose-maintain-repair-internal-asset)
- [Microsoft Asset Management — assets and work orders](https://learn.microsoft.com/en-us/dynamics365/supply-chain/asset-management/overview/objects-and-work-orders)

## External demand and naming signals

These sources inform the hypothesis; they do not prove SyncAI demand or
authorize their vendors' claims:

- [ABB 2025 downtime study — 3,600 industrial decision-makers](https://new.abb.com/news/detail/129763/industrial-downtime-costs-up-to-500-000-per-hour-and-can-happen-every-week)
- [MaintainX 2025 industrial-maintenance research — cost, workforce and parts/inventory pressure](https://www.getmaintainx.com/newsroom/state-of-industrial-maintenance-report-2025)
- [PMMI 2025 workforce-gap research — retention, expertise and skills gaps](https://pmmi-fonteva.s3.us-east-1.amazonaws.com/2025_PMMI-BI-3532-2025-Inside%20the%20Workforce%20Gap-Whitepaper-final.pdf)
- [UptimeAI AI Expert Marketplace listing — competing reliability-agent positioning](https://marketplace.microsoft.com/en-us/product/saas/uptimeai1633602630982.uptimeai_may_26?tab=overview)
- [Redlist AI agents — role-based reliability positioning](https://www.getredlist.com/ai-agents/)
- [Twintivo — existing Parts Readiness Agent naming](https://twintivo.com/)

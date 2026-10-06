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

## Recommended experiment sequence

| Sequence | Agent-shaped offer | Microsoft surface | Existing SyncAI capability basis | What must be built before listing |
| --- | --- | --- | --- | --- |
| 1 | **SyncAI MRO Readiness Agent** | Dynamics 365 Operations Apps, aimed at Supply Chain Management and Asset Management users | Governed MRO Materials Agent on `/materials`; exact catalogue, stock, demand, BOM, supplier and delivery evidence; no autonomous purchasing or stock mutation | Dynamics-native launch surface, authenticated tenant binding, read-only Dynamics data contract, install/remove path, support runbook, trial or lead handoff and Marketplace assets |
| 2 | **SyncAI FRACAS Investigation Agent** | Dynamics 365 apps on Dataverse and Power Apps, with Field Service as the first workflow hypothesis | Governed FRACAS/RCA workflow on `/reliability`; immutable investigation evidence, recurrence measurement and named-human corrective-action handoff | Dataverse solution package, schema and permission model, environment install/remove proof, per-user licensing, app-license checks and certification evidence |
| 3 | **SyncAI Maintenance Planning Agent** | Dynamics 365 Operations Apps | Governed Planning and Scheduling Agent; evidence-bounded job-plan drafts and human-controlled schedule release | Native work-order context, Dynamics permission boundary, deterministic handoff to the canonical SyncAI plan, trial and support evidence |
| 4 | **SyncAI Asset Strategy Agent** | Dynamics 365 Operations Apps | Governed Asset Strategy Agent on `/reliability/intervals`; PM interval, condition-inspection and run-to-failure screening with fail-closed safety and cost evidence | Native asset/maintenance-plan context, source-version binding, review experience and certification evidence |
| 5 | **SyncAI Maintenance Executive Briefing Agent** | Microsoft 365 and Copilot, linked to the core SaaS offer | Executive briefing is a credible acquisition concept, but the capability register does not yet show the complete Maintenance Executive role | Close the core role, produce a Microsoft 365/Copilot manifest, prove tenant-safe retrieval and link licensing to the published SaaS offer |

Sequence 1 and 2 are deliberately different experiments: Operations tests
in-product problem discovery and qualified lead conversion; Dataverse/Power Apps
tests a genuinely installable, per-user agent. Do not launch five offers at once.
Advance the next candidate only after the first two produce comparable funnel,
activation, usage and expansion evidence.

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

| Scenario | Pure arithmetic | Evidence boundary |
| --- | --- | --- |
| Adjacent-user reach illustration | 0.1% of 56 million = 56,000 users | Not a forecast; the relevant Dynamics and asset-intensive subset is unknown |
| Seat-led $100M illustration | 56,000 × US$150/month × 12 = US$100.8M ARR | US$150 is a scenario input, not approved SyncAI agent pricing |
| Enterprise expansion path A | 100 customers × US$1M ARR = US$100M ARR | Requires full-platform enterprise value and renewals, not agent installs alone |
| Enterprise expansion path B | 250 customers × US$400k ARR = US$100M ARR | Requires repeatable multi-site expansion |
| Enterprise expansion path C | 500 customers × US$200k ARR = US$100M ARR | Requires efficient acquisition and durable retention |
| Enterprise expansion path D | 1,000 customers × US$100k ARR = US$100M ARR | Requires a much broader sales and support engine |

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
- [Microsoft FY2025 Q3 earnings call — 56 million monthly active Power Platform users](https://www.microsoft.com/en-us/investor/events/fy-2025/earnings-fy-2025-q3)

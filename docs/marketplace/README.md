# Microsoft Marketplace publication package

**Controlled draft — 2026-10-06. This package does not state that the offer is
published, certified, transactable, MACC eligible, co-sell ready, or complete.**

This directory is the content and operator package for completing the SyncAI
SaaS offer in Partner Center. It converts repository-backed facts into
copy-ready fields and keeps commercial or external decisions visibly blocked.
The machine-readable source of status is
[`../../marketplace/partner-center-manifest.json`](../../marketplace/partner-center-manifest.json).

The adjacent professional-service package productizes the customer path from
assessment through proof and implementation, including bounded
Forward-Deployed Engineering. It remains a separate transaction family from
the recurring SaaS plans and is controlled by
[`../../marketplace/professional-services-offers.json`](../../marketplace/professional-services-offers.json).

## Current publication posture

| Area                    | Status                                                  | What can be done now                                                        | Remaining authority or evidence                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Starter plan            | Controlled description saved in Partner Center draft   | Preserve the saved description and observed per-user pricing                | Account is not publish eligible; commercial boundary and runtime enforcement still require validation                                                                               |
| Professional plan       | Controlled description saved in Partner Center draft   | Preserve the saved description and observed per-user pricing                | Same account gate; no legacy `PRO` claims or unproved tier limits may be introduced                                                                                                  |
| Enterprise plan         | Controlled description saved in Partner Center draft   | Preserve the saved description and observed per-user pricing                | Same account gate; Enterprise does not imply SSO, private hosting, certifications or an SLA                                                                                          |
| Technical configuration | URLs and production upstream verified                   | Keep the saved `app.syncai.ca` activation and webhook values                 | Configure the five required `AZURE_MARKETPLACE_*` secrets on the live SyncAI Supabase project; authenticated preview remains separate                                                |
| CSP resale              | **Any partner** saved as a draft channel experiment     | Build the minimum enablement, support, pricing, and escalation controls      | Publisher support obligations remain; narrow to specific partners if the controls cannot be staffed before release                                                                   |
| Supplemental content    | Mixed-cloud answer prepared but not saved               | Save the truthful **Other** architecture narrative                           | Current Azure-primary posture is not proven; do not claim it                                                                                                                         |
| Tax and payout profile  | Exact Microsoft account gate identified                 | Complete the Azure Marketplace payment/tax assignment and verification       | Tax profile is complete, but payment profile and all Azure Marketplace assignment statuses are **Not started**; Microsoft allows up to 48 hours to process                           |
| Offer listing           | Capability-audited copy and caption saved in draft      | Preserve the governed condition-monitoring and reliability wording           | Privacy/terms and collateral controls remain; listing is not public                                                                                                                   |
| Preview/certification   | Checklist ready                                         | Configure preview audience and execute the checklist                        | Requires Partner Center access, two real preview purchases and Microsoft-side evidence                                                                                               |
| Publish control         | Disabled                                                | Close every validation item, then request action-time publish approval       | Microsoft account eligibility and incomplete required sections currently prevent submission                                                                                          |

## Copy-ready artifacts

- [`partner-center-fields.md`](partner-center-fields.md) — exact offer and plan
  copy, URLs, CSP posture, and Partner Center field map.
- [`supplemental-content.md`](supplemental-content.md) — controlled answers and
  evidence inventory for the Supplemental content page.
- [`supporting-document-source.md`](supporting-document-source.md) — safe source
  for the required customer-facing PDF; it is not itself an uploadable PDF.
- [`preview-and-certification.md`](preview-and-certification.md) — external
  operator checklist and release gates.
- [`professional-services-and-fde.md`](professional-services-and-fde.md) —
  controlled Assessment, Proof of concept and Implementation listings, the
  value ladder, FDE authority boundary, and private-offer operator sequence.
- [`professional-services-supporting-document-source.md`](professional-services-supporting-document-source.md)
  — customer-facing source for the required accessible offer collateral.
- [`../../output/pdf/syncai-professional-services-and-fde.pdf`](../../output/pdf/syncai-professional-services-and-fde.pdf)
  — rendered four-page collateral; visual and text-extraction QA passed, while
  accessibility tagging and brand/legal/claims approvals remain blocked.

## Partner Center changes saved on 2026-10-06

The correct offer identity was confirmed and the following draft values were
saved. They remain unpublished and do not prove transaction readiness.

| Field              | Saved draft value                                      | Evidence scope                                                                                                                                             |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing page URL   | `https://app.syncai.ca/marketplace/activate`           | Partner Center save succeeded; custom-domain HTTP 200 and bounded signed-out UI observed, but no paid activation witness exists                            |
| Connection webhook | `https://app.syncai.ca/api/marketplace/webhook`         | Partner Center save succeeded; 405/401 refusal boundary observed, but no Microsoft-signed lifecycle event or authenticated upstream witness exists         |
| Offer listing      | `SyncAI Industrial Engineering Intelligence` copy set  | Saved copy is repository-backed and explicitly bounded; it remains a private draft                                                                         |
| Plan descriptions  | Starter, Professional, and Enterprise controlled copy  | All three descriptions saved; existing pricing was observed and left unchanged                                                                              |
| CSP audience       | `Any partner in the CSP program`                       | Saved as a user-directed acquisition experiment; support and channel enablement remain release controls                                                     |
| Auto activation    | **Off** for every plan                                 | Observed configuration matches the implemented manual-activation contract                                                                                   |

Merged PR #602 contains the same-origin route implementation at merge commit
`a0c4186efd1d449fbd80d67d5150d63f18684875`. Its Vercel status records identify
three successful deployments attached to that merge commit: project
`ai-maintenance-system` / deployment `2fyc2u4isGgjpBwRCWueNvPf9V54`, project
`repo` / deployment `3Re57JFiNpHEe77ac7mZMajSYKKu`, and project
`syncai-github` / deployment `DqYhNWUvqzpMb9aE9pzY1EdWzpr3`. The immutable
status URLs are recorded in the manifest. Those records prove the deployment
statuses and their commit association; they do not prove that `app.syncai.ca`
aliases one of those deployments.

The custom-domain observations on 2026-10-03 proved public routing and the
unauthenticated refusal boundary. On 2026-10-06, Vercel project inventory and a
redacted production-environment witness additionally established that
`app.syncai.ca` is the production URL of the `syncai-github` project and that
its `VITE_SUPABASE_URL` points to the active Supabase project named `SyncAI`.
That project has active `marketplace-fulfillment`, `marketplace-webhook`, and
`marketplace-metering` functions. PC-000 is therefore closed.

This still does **not** prove a paid purchase. The live SyncAI Supabase project
does not currently list any of the five required `AZURE_MARKETPLACE_*` secret
names. Until the publisher application credentials and exact publisher/offer
identifiers are configured there, token acquisition, subscription resolution,
activation, lifecycle processing, and metering cannot be buyer-proven. Never
commit or display the secret values.

## Non-negotiable blockers

1. Do not publish legacy `$4,000 / $9,000 / $18,000` prices, asset/site limits,
   credit quantities, or the `PRO` plan. The repository marks those figures as
   historically unconfirmed and superseded.
2. Do not use the fixed US$35,000 Reliability Intelligence Assessment fee as a
   SaaS subscription price. It is a separate, bounded service engagement.
3. Do not claim guaranteed savings, ROI, availability, accuracy, 24/7 support,
   SOC 2, ISO certification, production enterprise SSO, production
   SAP/Maximo/historian connectivity, private/on-premises deployment,
   autonomous control execution, Marketplace certification, MACC eligibility,
   or co-sell readiness.
4. `https://app.syncai.ca/privacy`, `/terms`, and `/security` return the SPA
   shell but are not dedicated path-addressable document routes in the current
   application. They are not approved Partner Center URLs until a browser
   witness proves the requested document loads directly in a fresh signed-out
   session.
5. Keep the Publish button blocked until the manifest has no `blocked` item and
   Partner Center reports every required section complete. A green repository
   check cannot replace Microsoft certification.
6. Do not translate “tax information submitted” into “validated,” “assigned,”
   or “complete.” User submission state and Partner Center's tax/payout status
   are separate evidence fields.
7. Partner Center currently states that the publisher account is not publish
   eligible. The Canadian tax profile is complete, but the payment profile and
   the Azure Marketplace tax/payment assignment and verification statuses are
   all **Not started**. The account owner must complete that financial setup;
   Microsoft says processing can take up to 48 hours.
8. Do not publish while the live SyncAI Supabase project lacks
   `AZURE_MARKETPLACE_CLIENT_ID`, `AZURE_MARKETPLACE_CLIENT_SECRET`,
   `AZURE_MARKETPLACE_TENANT_ID`, `AZURE_MARKETPLACE_PUBLISHER_ID`, and
   `AZURE_MARKETPLACE_OFFER_ID`.

## Source hierarchy

If content conflicts, use this order:

1. `docs/enterprise-readiness/claims-and-evidence-register.md`
2. `README.md`
3. `docs/azure-marketplace.md`
4. this controlled package

Do not use `README-STAKEHOLDER.md`, archived pricing guides, legacy migrations,
or legacy Stripe provisioning as publication evidence.

## Microsoft guidance used

- [Create plans for a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-plans)
- [Configure SaaS offer listing details](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing)
- [Plan a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/plan-saas-offer)
- [Add supplemental content](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-supplemental)
- [Cloud Solution Provider program](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/cloud-solution-providers)
- [Test and publish a SaaS offer](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/test-publish-saas-offer)

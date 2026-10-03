# Microsoft Marketplace publication package

**Controlled draft — 2026-10-03. This package does not state that the offer is
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
| Starter plan            | Draft copy ready                                        | Paste the controlled description                                            | Owner must approve the boundary, Plan ID, price, term, markets, allowances, metered dimensions and support level                                                                     |
| Professional plan       | Draft copy ready                                        | Paste the controlled description                                            | Same commercial decisions; no legacy `PRO` price or limits may be reused                                                                                                             |
| Enterprise plan         | Draft copy ready                                        | Paste the controlled description                                            | Same commercial decisions; Enterprise does not imply SSO, private hosting, certifications or an SLA                                                                                  |
| Technical configuration | Public routes observed; production upstream unconfirmed | The landing-page value can be prepared; keep the webhook and PC-001 blocked | A production owner must prove the Vercel proxy targets the intended production Supabase project before either URL set is treated as complete; authenticated preview remains separate |
| CSP resale              | Recommendation ready                                    | Select **No partners in the CSP program** for first publication             | Owner may later authorize named partners after channel support and commercial terms exist                                                                                            |
| Supplemental content    | Draft answers ready                                     | Paste the architecture narrative                                            | Owner must supply the Azure subscription ID and deployed consumption evidence; current Azure-primary posture is not proven                                                           |
| Tax and payout profile  | Externally unverified                                   | Record any user-submitted tax form as a submission fact only                | A Partner Center operator must separately capture Microsoft's current validation/assignment status and payout-profile readiness                                                      |
| Offer listing           | Draft copy ready                                        | Paste the listing text and contacts                                         | Privacy policy must be reachable at a stable public URL; marketing PDF and media must be produced and reviewed                                                                       |
| Preview/certification   | Checklist ready                                         | Configure preview audience and execute the checklist                        | Requires Partner Center access, two real preview purchases and Microsoft-side evidence                                                                                               |
| Publish control         | Blocked                                                 | None                                                                        | Partner Center sections must be complete and every blocking item below closed                                                                                                        |

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

## Immediate corrections in Partner Center

The values below have field-specific gates. Confirm the offer identity and save
a screenshot/export of every Partner Center change. Do not enter the webhook
until a production owner closes PC-000 in the manifest.

| Field              | Current value                                                   | Controlled replacement                                           | Evidence                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing page URL   | `https://syncai.ca/marketplace/activate` (404 on 2026-10-03)    | `https://app.syncai.ca/marketplace/activate`                     | The custom domain returned HTTP 200 and a signed-out browser rendered the bounded Marketplace no-token state                                              |
| Connection webhook | `https://syncai.ca/api/marketplace/webhook` (404 on 2026-10-03) | `https://app.syncai.ca/api/marketplace/webhook` **after PC-000** | The custom domain returned 405/`Allow: POST` for `GET` and the expected unsigned 401; neither probe reaches or identifies the configured upstream project |
| Auto activation    | Unknown                                                         | **Off** for every plan                                           | The implemented offer contract is manual activation                                                                                                       |

Merged PR #602 contains the same-origin route implementation at merge commit
`a0c4186efd1d449fbd80d67d5150d63f18684875`. Its Vercel status records identify
three successful deployments attached to that merge commit: project
`ai-maintenance-system` / deployment `2fyc2u4isGgjpBwRCWueNvPf9V54`, project
`repo` / deployment `3Re57JFiNpHEe77ac7mZMajSYKKu`, and project
`syncai-github` / deployment `DqYhNWUvqzpMb9aE9pzY1EdWzpr3`. The immutable
status URLs are recorded in the manifest. Those records prove the deployment
statuses and their commit association; they do not prove that `app.syncai.ca`
aliases one of those deployments.

The custom-domain observations on 2026-10-03 prove only public routing and the
unauthenticated refusal boundary. A fresh signed-out browser reached the
Marketplace activation UI; webhook `GET` returned `405` with `Allow: POST`; and
an unsigned JSON `POST` returned
`marketplace_webhook_token_required` with `no-store` and `nosniff`. Because both
webhook requests return before the proxy resolves its upstream URL, they do
**not** prove the intended production Supabase project, Microsoft token
validation, subscription resolution, activation, lifecycle processing,
metering, or a Partner Center purchase. The historical direct Supabase URL is
an unconfirmed candidate, not a fallback. PC-000 and all authenticated preview
gates remain blocked.

PC-000 requires owner-controlled evidence that names the Vercel project and
production environment, identifies the intended Supabase project reference,
and shows that the proxy's production `SUPABASE_URL` or `VITE_SUPABASE_URL`
resolves to that project. Store only a redacted export, checksum, or signed
attestation; never commit the URL value if it contains credentials or any
secret.

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

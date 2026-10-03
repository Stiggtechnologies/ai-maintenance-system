# Microsoft Marketplace publication package

**Controlled draft — 2026-10-03. This package does not state that the offer is
published, certified, transactable, MACC eligible, co-sell ready, or complete.**

This directory is the content and operator package for completing the SyncAI
SaaS offer in Partner Center. It converts repository-backed facts into
copy-ready fields and keeps commercial or external decisions visibly blocked.
The machine-readable source of status is
[`../../marketplace/partner-center-manifest.json`](../../marketplace/partner-center-manifest.json).

## Current publication posture

| Area | Status | What can be done now | Remaining authority or evidence |
| --- | --- | --- | --- |
| Starter plan | Draft copy ready | Paste the controlled description | Owner must approve the boundary, Plan ID, price, term, markets, allowances, metered dimensions and support level |
| Professional plan | Draft copy ready | Paste the controlled description | Same commercial decisions; no legacy `PRO` price or limits may be reused |
| Enterprise plan | Draft copy ready | Paste the controlled description | Same commercial decisions; Enterprise does not imply SSO, private hosting, certifications or an SLA |
| Technical configuration | Production routes verified; Partner Center change pending | Replace the two 404 values with the production app-domain URLs below | Save and export the Partner Center configuration, then complete an authenticated preview lifecycle |
| CSP resale | Recommendation ready | Select **No partners in the CSP program** for first publication | Owner may later authorize named partners after channel support and commercial terms exist |
| Supplemental content | Draft answers ready | Paste the architecture narrative | Owner must supply the Azure subscription ID and deployed consumption evidence; current Azure-primary posture is not proven |
| Tax and payout profile | Externally unverified | Record any user-submitted tax form as a submission fact only | A Partner Center operator must separately capture Microsoft's current validation/assignment status and payout-profile readiness |
| Offer listing | Draft copy ready | Paste the listing text and contacts | Privacy policy must be reachable at a stable public URL; marketing PDF and media must be produced and reviewed |
| Preview/certification | Checklist ready | Configure preview audience and execute the checklist | Requires Partner Center access, two real preview purchases and Microsoft-side evidence |
| Publish control | Blocked | None | Partner Center sections must be complete and every blocking item below closed |

## Copy-ready artifacts

- [`partner-center-fields.md`](partner-center-fields.md) — exact offer and plan
  copy, URLs, CSP posture, and Partner Center field map.
- [`supplemental-content.md`](supplemental-content.md) — controlled answers and
  evidence inventory for the Supplemental content page.
- [`supporting-document-source.md`](supporting-document-source.md) — safe source
  for the required customer-facing PDF; it is not itself an uploadable PDF.
- [`preview-and-certification.md`](preview-and-certification.md) — external
  operator checklist and release gates.

## Immediate corrections in Partner Center

Use the following values only after a Partner Center operator confirms the
offer identity and saves a screenshot/export of the change:

| Field | Current value | Controlled replacement | Evidence |
| --- | --- | --- | --- |
| Landing page URL | `https://syncai.ca/marketplace/activate` (404 on 2026-10-03) | `https://app.syncai.ca/marketplace/activate` | Production HTTP 200 and signed-out browser rendered the Marketplace activation refusal on merged SHA `a0c4186` |
| Connection webhook | `https://syncai.ca/api/marketplace/webhook` (404 on 2026-10-03) | `https://app.syncai.ca/api/marketplace/webhook` | Production `GET` returns 405 with `Allow: POST`; unsigned JSON `POST` returns the proxy's 401 token refusal on merged SHA `a0c4186` |
| Auto activation | Unknown | **Off** for every plan | The implemented offer contract is manual activation |

The same-origin routes were deployed by merged PR #602 as SHA `a0c4186` and
verified in production on 2026-10-03. A fresh signed-out browser reached the
Marketplace activation UI and showed the bounded no-token message. The
webhook returned `405` with `Allow: POST` for `GET` and the proxy's
`marketplace_webhook_token_required` 401 for an unsigned JSON `POST`; both
responses were `no-store` and `nosniff`. These witnesses prove the public route
and unauthenticated refusal boundary. They do **not** prove Microsoft token
validation, subscription resolution, activation, lifecycle processing,
metering, or a Partner Center purchase. Those remain preview gates.

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

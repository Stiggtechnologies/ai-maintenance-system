# Preview, certification, and publication checklist

**This checklist controls external Partner Center work. It does not authorize
publishing while a blocking item remains open.**

## 1. Content and commercial approval

- [ ] Record owner approval for the offer name, summary, description, getting
      started text and keywords.
- [ ] Approve immutable Plan IDs for Starter, Professional and Enterprise.
- [ ] Approve one offer-wide pricing model and each plan's price, term, markets,
      quantities, allowances, dimensions, entitlements, support and exclusions.
- [ ] Confirm no value was copied from archived pricing, a legacy migration,
      legacy Stripe provisioning, or the separate fixed-fee assessment.
- [ ] Obtain legal approval for the contract/EULA approach and any amendments.
- [ ] Record user-submitted tax information separately from Partner Center's
      current tax validation/assignment and payout-profile statuses.
- [ ] Verify the commercial marketplace account, tax profile and payout profile
      are accepted for the selected markets; do not infer this from submission.
- [ ] Publish a stable, directly addressable HTTPS privacy policy and witness it
      in a fresh signed-out browser session.
- [ ] Confirm support and engineering contacts are named and monitored.
- [ ] Produce, review, visually inspect and upload at least one accessible
      marketing PDF.
- [ ] Supply reviewed logo and any optional screenshots/video.

## 2. Technical configuration

- [ ] Replace `https://syncai.ca/marketplace/activate` with
      `https://app.syncai.ca/marketplace/signup`.
- [ ] After commit `50a2452` is deployed, verify the preferred app-domain
      activation alias visibly renders the Marketplace flow; only then may the
      landing page be changed to `https://app.syncai.ca/marketplace/activate`.
- [ ] Confirm that Supabase project `pjvoswbwomesuwhygpby` is the production
      project paired with the offer.
- [ ] Replace `https://syncai.ca/api/marketplace/webhook` with
      `https://pjvoswbwomesuwhygpby.supabase.co/functions/v1/marketplace-webhook`.
- [ ] After commit `50a2452` is deployed, verify app-domain webhook `GET`
      returns `405` with `Allow: POST` and unsigned JSON `POST` returns `401`;
      only then may it replace the direct Supabase webhook.
- [ ] Keep auto activation off on every plan.
- [ ] Confirm the configured Partner Center publisher/offer IDs exactly match
      the server secrets.
- [ ] Confirm the configured Microsoft Entra tenant/application IDs exactly
      match webhook token validation and publisher credentials.
- [ ] Probe the landing page with no token and verify it renders the controlled
      Marketplace experience without leaking data.
- [ ] Probe the webhook with an unsigned POST and verify HTTP 401. Do not treat
      this as an authenticated lifecycle pass.

## 3. CSP and supplemental content

- [ ] Select **No partners in the CSP program** for initial publication.
- [ ] Enter the controlled Supplemental content narrative.
- [ ] Supply the production Azure subscription ID from owner-controlled
      evidence.
- [ ] Attach the deployed Azure resource, identity, health, architecture, and
      consumption witnesses listed in `supplemental-content.md`.
- [ ] Confirm the narrative names non-Azure dependencies and does not claim an
      Azure-primary state before consumption evidence supports it.

## 4. Preview audience

- [ ] Use a separate DEV/test offer if available, as Microsoft recommends.
- [ ] Add only named preview customer Microsoft Entra tenant IDs; do not make
      the offer public to bypass preview testing.
- [ ] Record the publisher operator, preview tenants, offer ID, Plan IDs,
      configuration timestamp and screenshots/export in the evidence log.
- [ ] Confirm preview buyers can use Microsoft Entra SSO and that a Microsoft
      login alone cannot grant organization membership, activate commerce, or
      elevate a role.

## 5. End-to-end preview witnesses

Use two preview purchases: one stays active for metering/status checks and one
is taken through terminal cancellation.

- [ ] Resolve a real Marketplace purchase token and confirm publisher, offer,
      plan, quantity and subscription identity match.
- [ ] Sign in from a non-publisher buyer tenant.
- [ ] Bind only to an existing SyncAI organization whose verified Microsoft
      tenant matches the purchaser/beneficiary tenant.
- [ ] Activate through the manual activation flow and verify Microsoft reports
      `Subscribed` before internal active entitlement is granted.
- [ ] Reopen **Configure account** for the active purchase and confirm the
      returning manage flow works.
- [ ] Exercise Subscribe, ChangePlan, ChangeQuantity, Suspend, Reinstate and
      Unsubscribe as applicable; verify authenticated, idempotent, fail-closed
      handling and canonical audit evidence.
- [ ] Verify a deliberately invalid/mismatched event is refused without
      changing entitlement.
- [ ] If metering is enabled, submit canonical settled usage for the exact
      approved Plan ID/dimension, witness Microsoft's accepted response and
      exact-duplicate behavior, reconcile included quantity, and retain a
      hashed Partner Center usage-view artifact.
- [ ] Confirm unsubscribe cancels the commercial entitlement without deleting
      customer evidence.

## 6. Repository certification harness

After the external purchases and witnesses exist, configure the protected
`azure-production` environment and run:

```bash
npm run marketplace:certify-preview
```

- [ ] The run uses two real preview subscription IDs.
- [ ] Required publisher, offer, plan, meter and Supabase inputs are protected
      and exact.
- [ ] Observer and reviewer are distinct named identities.
- [ ] The report is retained with the source commit and external evidence.
- [ ] A passing run is described only as a repository Gate A7 preview pass; it
      is not called Microsoft certification or publication.

## 7. Partner Center certification and go-live

- [ ] Review Partner Center's validation messages and clear every incomplete
      required section.
- [ ] Select **Review and publish** only after the machine-readable manifest has
      no `blocked` item and the evidence custodian signs the release record.
- [ ] Submit to Microsoft certification and retain certification correspondence.
- [ ] If certification raises a policy question, update the controlled package
      and evidence; do not weaken or omit a material limitation just to pass.
- [ ] Preview the certified listing and retest purchase/configuration before
      selecting **Go live**.
- [ ] Record the Microsoft certification result and live listing URL. Only then
      may publication claims be considered for approval.

## Abort conditions

Stop the release if any of these occurs:

- landing page or webhook is unavailable or points to an unconfirmed project;
- publisher, offer, tenant, application, Plan ID or meter dimension differs
  between Partner Center and server configuration;
- a plan price, allowance, service level or entitlement lacks owner approval;
- privacy/terms/support material is unavailable or misleading;
- a preview identity can self-assign a tenant/role or activate a mismatched
  subscription;
- lifecycle or metering evidence is synthetic, unauthenticated, stale or
  incomplete; or
- the offer would require an unsupported product, security, Azure-primary,
  certification, ROI, savings, availability, accuracy or support claim.

Official references:
[test and publish](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/test-publish-saas-offer),
[SaaS lifecycle](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/pc-saas-fulfillment-life-cycle),
[webhook](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/pc-saas-fulfillment-webhook),
and [landing page](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/azure-ad-transactable-saas-landing-page).

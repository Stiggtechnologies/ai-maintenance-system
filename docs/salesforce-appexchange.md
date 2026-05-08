# Salesforce AppExchange

How SyncAI is structured on Salesforce AppExchange and how license
events from the License Management App (LMA) flow into our backend.

## Offer summary

- **Offer name:** SyncAI — Industrial AI Infrastructure (Salesforce)
- **Offer code (internal):** `syncai_industrial_sf`
- **Publisher:** StiggTechnologies
- **Type:** Managed Package (AppExchange)
- **Pricing model:** Per-seat, monthly recurring
- **Plans:** Starter ($99) · Professional ($199) · Enterprise ($349)

## Activation flow

Salesforce doesn't redirect with a token after install (unlike Microsoft
and AWS). The flow is:

```
1. Customer installs the SyncAI managed package from AppExchange
2. Post-install, customer hits:
       https://app.syncai.ca/marketplace/salesforce/activate
       ?organization_id=00D...
       &package_version_id=04t...
3. SalesforceActivate page renders 3 setup steps:
   a. Configure object permissions (Asset, WorkOrder, MaintenanceWorkRule)
   b. Activate the LMA license-event Flow (ships with the package)
   c. Continue to SyncAI signup
4. Customer signs up at SyncAI; their org_id is linked to their LMA
   license record by the next license-event POST.
5. Within ~5 minutes, the LMA Flow fires its first license-event POST
   (Active status, current seat count). Backend status flips to sf_active.
```

## License-event webhook

The managed package ships with a Flow on the License object that POSTs
license changes to:

```
POST https://app.syncai.ca/functions/v1/marketplace-salesforce-license
Authorization: Bearer <SF_LMA_SHARED_SECRET>
Content-Type: application/json
Body: {
  "action": "license_event",
  "license_id": "a0X...",                 // LMA License Id (18-char)
  "organization_id": "00D...",            // customer org id
  "package_version_id": "04t...",         // managed package version
  "offer_code": "syncai_industrial_sf",
  "plan_code": "pro" | "starter" | "enterprise",
  "seats": 25,
  "status": "Active" | "Trial" | "Suspended" | "Uninstalled" | "Expired",
  "expires_at": "2026-12-31T00:00:00Z" | null
}
```

The endpoint authenticates via a shared secret (`SF_LMA_SHARED_SECRET`)
and persists/upserts the subscription idempotently keyed by `license_id`.

| LMA status | Local status |
|---|---|
| `Active` | `sf_active` |
| `Trial` | `sf_trial` |
| `Suspended` | `sf_suspended` |
| `Uninstalled` | `sf_uninstalled` |
| `Expired` | `sf_expired` |

## Why a shared secret instead of OAuth?

Salesforce Flow Outbound Messages don't natively support OAuth. The
shared-secret pattern is standard for ISV-side license sync — we
generate one secret per customer and ship it inside the managed
package's named credential. Rotating the secret is a package-version
update.

## Required env

```bash
supabase secrets set SF_LMA_SHARED_SECRET=<long random string>
```

## Managed package contents (high level)

- **Permission set: SyncAI Integration User** — read/write on Asset,
  WorkOrder, MaintenanceWorkRule
- **Custom metadata: SyncAI Settings** — endpoint URL, shared secret
- **Flow: SyncAI License Sync** — fires on License create/update,
  POSTs to our webhook
- **Lightning Components: SyncAI Insights** — embeds agent
  recommendations on Account, Asset, WorkOrder pages
- **Apex classes: SyncAIBridge** — bidirectional sync helpers

(Package version IDs: `04tXX0000000Xyz` for v1.0; bump on each release.)

## Deployment checklist

- [ ] AppExchange listing approved (security review passed)
- [ ] Managed package version released (`04t...` ID published)
- [ ] LMA enabled in publisher org
- [ ] License-event Flow shipped inside the package
- [ ] Customer-specific shared secret deployed via named credential
- [ ] DNS: `app.syncai.ca/marketplace/salesforce/activate` resolves
- [ ] Listing page on syncai.ca/salesforce live
- [ ] SF_LMA_SHARED_SECRET set in Supabase secrets
- [ ] Test: install package → Flow fires → license syncs to SyncAI

## Related

- Migration: [`supabase/migrations/016_marketplace_aws_salesforce.sql`](../supabase/migrations/016_marketplace_aws_salesforce.sql)
- Edge Function: [`supabase/functions/marketplace-salesforce-license/index.ts`](../supabase/functions/marketplace-salesforce-license/index.ts)
- Activation UI: [`src/pages/SalesforceActivate.tsx`](../src/pages/SalesforceActivate.tsx)
- Marketing: `StiggSyncAIwebsite2.0/app/salesforce/page.tsx`

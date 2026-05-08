# Salesforce AppExchange

How SyncAI is structured on Salesforce AppExchange and how license
events from the License Management App (LMA) flow into our backend.

## Offer summary

- **Type:** Managed Package (AppExchange)
- **Pricing model:** Per-seat, monthly recurring
- **Plans:** Starter ($99) · Professional ($199) · Enterprise ($349)

## Activation flow

Salesforce doesn't redirect with a token after install (unlike Microsoft
and AWS). The flow is:

```
1. Customer installs SyncAI managed package from AppExchange
2. Post-install, customer hits:
       https://app.syncai.ca/marketplace/salesforce/signup
       ?organization_id=00D...
       &package_version_id=04t...
3. SalesforceSignup page renders 3 setup steps:
   a. Configure object permissions (Asset, WorkOrder, MaintenanceWorkRule)
   b. Activate the LMA license-event Flow (ships with the package)
   c. Continue to SyncAI signup
4. Customer signs up at SyncAI; their org_id is linked to their LMA
   license record by the next license-event POST.
5. Within ~5 minutes, the LMA Flow fires its first license-event POST
   (Active status, current seat count) → status flips to sf_active.
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
  "license_id": "a0X...",
  "organization_id": "00D...",
  "package_version_id": "04t...",
  "seats": 25,
  "status": "Active" | "Trial" | "Suspended" | "Uninstalled" | "Expired",
  "expires_at": "2026-12-31T00:00:00Z" | null
}
```

The endpoint authenticates via a shared secret (`SF_LMA_SHARED_SECRET`)
and persists/upserts via `upsert_salesforce_license_subscription` RPC,
idempotently keyed by `license_id`.

| LMA status    | billing_subscriptions.sf_status |
| ------------- | ------------------------------- |
| `Active`      | `sf_active`                     |
| `Trial`       | `sf_trial`                      |
| `Suspended`   | `sf_suspended`                  |
| `Uninstalled` | `sf_uninstalled`                |
| `Expired`     | `sf_expired`                    |

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

## Tables (added by `20260513000000_aws_salesforce_marketplace_integration.sql`)

| Object                                       | Purpose                                                        |
| -------------------------------------------- | -------------------------------------------------------------- |
| `billing_subscriptions.sf_*` columns         | Per-org SF subscription identity (UUID-keyed by sf_license_id) |
| `salesforce_license_events`                  | Audit log; idempotent on `event_id`                            |
| `upsert_salesforce_license_subscription` RPC | service-role-only helper                                       |

## Deployment checklist

- [ ] AppExchange listing approved (security review passed)
- [ ] Managed package version released (`04t...` ID published)
- [ ] LMA enabled in publisher org
- [ ] License-event Flow shipped inside the package
- [ ] Customer-specific shared secret deployed via named credential
- [ ] DNS: `app.syncai.ca/marketplace/salesforce/signup` resolves
- [ ] SF_LMA_SHARED_SECRET set in Supabase secrets
- [ ] Migration `20260513000000_aws_salesforce_marketplace_integration.sql` applied
- [ ] Edge Function `marketplace-salesforce-license` deployed
- [ ] Test: install package → Flow fires → license syncs to SyncAI

## Related

- Migration: [`supabase/migrations/20260513000000_aws_salesforce_marketplace_integration.sql`](../supabase/migrations/20260513000000_aws_salesforce_marketplace_integration.sql)
- Edge Function: [`supabase/functions/marketplace-salesforce-license/index.ts`](../supabase/functions/marketplace-salesforce-license/index.ts)
- Activation UI: [`src/pages/SalesforceSignup.tsx`](../src/pages/SalesforceSignup.tsx)
- Client lib: [`src/lib/salesforce-license.ts`](../src/lib/salesforce-license.ts)
- Marketing landing: `StiggSyncAIwebsite2.0/app/salesforce/page.tsx` (already deployed at syncai.ca/salesforce)
- Microsoft (companion): [`docs/azure-marketplace.md`](./azure-marketplace.md)
- AWS (companion): [`docs/aws-marketplace.md`](./aws-marketplace.md)

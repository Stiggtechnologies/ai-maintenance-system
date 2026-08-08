# Microsoft Commercial Marketplace SaaS Offer

How SyncAI is structured for Microsoft AppSource / Azure Marketplace, how
purchases flow into a working tenant, and what still needs verification before
certification.

## Offer Summary

- **Offer type:** Transactable SaaS offer
- **Pilot activation route:** `https://repo-lime-nu.vercel.app/marketplace/signup?token=<marketplace_token>`
- **Future production route:** `https://app.syncai.ca/marketplace/signup?token=<marketplace_token>`
- **Resolve/activate function:** Supabase Edge Function `marketplace-resolve`
- **Pilot resolve endpoint:** `https://snlevbkyjipucmkpkqka.supabase.co/functions/v1/marketplace-resolve`
- **Lifecycle webhook:** `https://app.syncai.ca/functions/v1/marketplace-webhook`
- **Pricing model:** Per-seat recurring SaaS
- **Plans:** Starter, Professional, Enterprise
- **Existing Partner Center draft offer:** `SyncAI Predictive Maintenance`
  (`syncai-predictive-maintenance`), offer type `Software as a Service`,
  status `Draft`.

## Activation Flow

```text
1. Buyer selects Get It Now in Microsoft AppSource / Azure Marketplace.
2. Microsoft redirects to /marketplace/signup with a marketplace token.
3. MarketplaceSignup calls marketplace-resolve with action=resolve-token.
4. marketplace-resolve:
   a. Acquires a Microsoft Marketplace access token with client credentials.
   b. Calls the SaaS Fulfillment API resolve endpoint.
   c. Provisions or updates the tenant/subscription record.
   d. Activates the SaaS subscription with Microsoft.
5. Buyer signs in with Microsoft Entra ID.
6. AzureADCallback exchanges the auth code through marketplace-resolve.
7. The buyer lands in the SyncAI application.
```

## Runtime Contracts

### Resolve Token

```http
POST /functions/v1/marketplace-resolve
Content-Type: application/json

{
  "action": "resolve-token",
  "token": "<marketplace_token>"
}
```

### Activate Subscription

```http
POST /functions/v1/marketplace-resolve
Content-Type: application/json

{
  "action": "activate-subscription",
  "subscriptionId": "<microsoft_subscription_id>",
  "planId": "professional",
  "quantity": 25
}
```

### Exchange Entra ID Code

```http
POST /functions/v1/marketplace-resolve
Content-Type: application/json

{
  "action": "exchange-code",
  "code": "<authorization_code>",
  "redirect_uri": "https://repo-lime-nu.vercel.app/auth/callback/azure"
}
```

### Lifecycle Webhook

Microsoft lifecycle notifications are handled by `marketplace-webhook`.

Supported actions:

| Action           | Effect                                   |
| ---------------- | ---------------------------------------- |
| `ChangePlan`     | Updates the subscription plan            |
| `ChangeQuantity` | Updates seat quantity                    |
| `Suspend`        | Marks marketplace subscription suspended |
| `Reinstate`      | Marks marketplace subscription active    |
| `Unsubscribe`    | Cancels marketplace subscription         |
| `Renew`          | Extends the current billing period       |

## Required Secrets

Set these in Supabase Edge Function secrets:

```bash
supabase secrets set \
  AZURE_AD_CLIENT_ID=09b1f6e1-99b3-46f7-bb23-48b2aa4a6399 \
  AZURE_AD_CLIENT_SECRET=... \
  AZURE_AD_TENANT_ID=6f239ab2-6991-45d8-9ddf-58588a505458 \
  AZURE_AD_REDIRECT_URI=https://repo-lime-nu.vercel.app/auth/callback/azure \
  ALLOWED_ORIGIN=https://repo-lime-nu.vercel.app
```

Frontend hosting must also expose:

```bash
VITE_AZURE_AD_CLIENT_ID=09b1f6e1-99b3-46f7-bb23-48b2aa4a6399
VITE_AZURE_AD_TENANT_ID=common
VITE_AZURE_AD_REDIRECT_URI=https://repo-lime-nu.vercel.app/auth/callback/azure
VITE_APP_URL=https://repo-lime-nu.vercel.app
```

## Teams SSO Configuration

The Entra app is configured for the current Teams static-tab pilot package:

- Application ID URI:
  `api://repo-lime-nu.vercel.app/09b1f6e1-99b3-46f7-bb23-48b2aa4a6399`
- Delegated scope:
  `api://repo-lime-nu.vercel.app/09b1f6e1-99b3-46f7-bb23-48b2aa4a6399/access_as_user`
- Pre-authorized Teams desktop client:
  `1fec8e78-bce4-4aaf-ab1b-5451cc387264`
- Pre-authorized Teams web client:
  `5e3ce6c0-2b1f-4285-8d4b-75ee78787346`

These values align with `microsoft/teams/manifest.json`.

## Partner Center Checklist

- [x] Publisher exists: Stigg Technologies, seller ID `94486950`, publisher ID
      `stiggtechnologies`, Partner ID `7109393`.
- [ ] Publisher profile fully approved: legal, payout, tax, support contacts.
- [x] SaaS offer draft exists.
- [ ] SaaS offer renamed/reshaped for Reliability Engineering Copilot or a new
      dedicated offer is created with final offer ID and plan IDs.
- [ ] Technical configuration uses the production landing page and webhook URLs.
- [x] Microsoft Entra app registration matches current pilot redirect URL.
- [x] `marketplace-resolve` deployed with live Vercel CORS origin.
- [x] Authenticated Edge Function smoke test reaches production function.
- [x] Teams SSO Application ID URI, `access_as_user` scope, and Teams desktop/web
      pre-authorized clients configured in Entra.
- [x] Production `marketplace_metering_records` table created.
- [x] Live agent invocation writes pending `agent_invocation` usage records when
      a marketplace subscription ID is mapped.
- [ ] Marketplace token resolution tested from a Partner Center preview purchase.
- [ ] Activation moves subscription from pending fulfillment to subscribed.
- [ ] Lifecycle webhook tested for quantity, plan, suspend, reinstate, unsubscribe, and renew.
- [ ] Terms, privacy policy, support URL, screenshots, logos, and listing copy are final.
- [ ] Production monitoring and audit logs are enabled for every marketplace operation.

## Current Gaps To Close

- Prove end-to-end signup with a real Microsoft preview purchase token.
- Confirm the Entra ID code exchange creates or maps to a valid Supabase session.
- Add idempotency keys and signature/source validation around lifecycle webhook handling.
- Replace pilot Vercel URLs with `app.syncai.ca` after DNS is live and add the
  new redirect URI to Entra.
- Confirm Partner Center plan IDs exactly match `billing_plans.code` values.
- Add verified publisher/MPN ID in Entra; Microsoft warns that external tenants
  cannot grant consent to new multitenant apps until the publisher is verified.
- Decide whether to reuse the existing `syncai-predictive-maintenance` SaaS
  offer or create a clean `syncai-reliability-engineering-copilot` offer.

## Related

- Activation UI: `src/pages/MarketplaceSignup.tsx`
- Client library: `src/lib/azure-marketplace.ts`
- Entra ID client: `src/lib/azure-ad.ts`
- Resolve/code exchange function: `supabase/functions/marketplace-resolve/index.ts`
- Lifecycle webhook function: `supabase/functions/marketplace-webhook/index.ts`
- Azure migration: `supabase/migrations/20260430120000_azure_marketplace_integration.sql`

# Microsoft AppSource / Azure Marketplace

How the SyncAI offer is structured on Microsoft AppSource and how
purchases flow from Marketplace to a working SyncAI tenant.

## Offer summary

- **Offer name:** `SyncAI — Industrial AI Infrastructure`
- **Offer id:** `syncai_industrial`
- **Publisher id:** `stiggtechnologies`
- **Type:** SaaS Offer (Transactable)
- **Pricing model:** Per-seat, monthly recurring
- **Plans:** Starter ($99/seat/mo) · Professional ($199/seat/mo) · Enterprise ($349/seat/mo)
- **Industries:** All 13 asset-intensive verticals (see [docs/integrations.md](./integrations.md) and migration 012)

## Activation flow

```
1. Buyer hits "Get It Now" on Microsoft AppSource listing
2. AppSource collects payment + redirects to:
       https://app.syncai.ca/marketplace/activate?token=<marketplace_token>
3. MarketplaceActivate page calls marketplace-fulfillment-webhook
       action: "resolve"  (POST + token)
4. Edge Function:
       a. Acquires AAD token (client_credentials grant against
          MARKETPLACE_AAD_CLIENT_ID/SECRET, MARKETPLACE_AAD_TENANT_ID)
       b. POSTs token to Microsoft Marketplace SaaS API
          /api/saas/subscriptions/resolve?api-version=2018-08-31
       c. Persists the resolved subscription to marketplace_subscriptions
          (idempotent on subscription_id)
5. UI shows offer/plan/quantity/purchaser to the buyer
6. Buyer clicks "Continue to account setup" → /signup?email=<purchaser>
       with plan code preserved in sessionStorage
7. Signup creates the org. The Marketplace subscription row is then
   linked to the org via UPDATE marketplace_subscriptions ... WHERE
   marketplace_subscription_id = <stashed id>.
```

## Lifecycle webhooks

Microsoft posts to:
```
POST https://app.syncai.ca/functions/v1/marketplace-fulfillment-webhook
Body: { "action": "webhook", "event": <SaaSWebhookV2> }
```

Supported event actions (mapped 1:1 to Microsoft's enum):

| Action | Effect |
|---|---|
| `Renew` | log only, status stays `Subscribed` |
| `ChangeQuantity` | update `quantity` |
| `ChangePlan` | update `plan_id` |
| `Suspend` | status → `Suspended` |
| `Reinstate` | status → `Subscribed` |
| `Unsubscribe` | status → `Unsubscribed`, set `canceled_at` |

All events are persisted to `marketplace_webhook_events` first
(idempotent on `event_id`) so a retry from Microsoft never double-applies.

## Tables

- `marketplace_offers` — global catalog (one row per offer)
- `marketplace_plans` — plans within an offer
- `marketplace_subscriptions` — per-org subscriptions resolved from tokens
- `marketplace_webhook_events` — audit log (idempotency key: event_id)

## Required secrets

```bash
supabase secrets set \
  MARKETPLACE_AAD_TENANT_ID=<your aad tenant id> \
  MARKETPLACE_AAD_CLIENT_ID=<your single-tenant app reg> \
  MARKETPLACE_AAD_CLIENT_SECRET=<secret>
```

The AAD app registration must have a redirect URI of
`https://app.syncai.ca/marketplace/activate` and be configured to
acquire tokens for the Marketplace API resource
`62d94f6c-d599-489b-a797-3e10e42fbe22`.

## Partner Center submission checklist

- [ ] Publisher profile — legal entity, payout, tax forms
- [ ] Offer setup — id `syncai_industrial`, name, alias
- [ ] Properties — categories (DevOps, IoT, AI + ML), industries
- [ ] Listing — description (see below), search keywords, video, screenshots, logos
- [ ] Plan overview — Starter / Professional / Enterprise pricing
- [ ] Technical configuration:
    - Landing page: `https://app.syncai.ca/marketplace/activate`
    - Connection webhook: `https://app.syncai.ca/functions/v1/marketplace-fulfillment-webhook`
    - AAD App ID / Tenant ID
- [ ] Co-sell options (optional but recommended)
- [ ] Submit for certification (review = 2-4 weeks)

## Listing copy (suggested)

**Short description (under 100 chars):**
> Autonomous AI agents for asset-intensive industries — 15 specialized agents, real-time SAP/Maximo integrations.

**Search keywords:**
> industrial AI, predictive maintenance, asset management, ISO 55000, CMMS, SAP PM, Maximo, autonomous agents, condition monitoring, reliability engineering

**Long description:**

> SyncAI is the autonomous industrial layer for asset-intensive maintenance. 15 specialized AI agents — Reliability Engineering, Condition Monitoring, Compliance Auditing, and 12 more — read your existing CMMS and historian data and surface decisions, not dashboards.
>
> Built for Oil & Gas, Mining, Utilities, Pharmaceuticals, Aerospace, Pipelines, Data Centers, and 6 more verticals. Every deployment uses an industry-specific template — asset taxonomy, FMEA library, ISO 55000 KPIs, and integration roster pre-configured.
>
> 60-second tenant provisioning. Native integrations with SAP PM, IBM Maximo, AVEVA PI, Schneider EcoStruxure, and 22 more vendors. Customer-controlled credentials encrypted at rest with AES-256.
>
> **Why this works:** instead of replacing your CMMS, SyncAI sits above it as the autonomous decision layer — risk-scoring assets, prioritizing work, and predicting failures before they happen. ROI in a single avoided unplanned outage.

## Per-plan feature matrix

| | Starter | Professional | Enterprise |
|---|---|---|---|
| Users | up to 10 | unlimited | unlimited |
| AI agents | 5 | All 15 + orchestrator | All 15 + custom prompts |
| Industry templates | 3 | All 13 | All 13 + custom |
| Integrations | core (Anthropic, OpenAI) | full roster (26 vendors) | full + on-prem connectors |
| SOC 2 reports | — | ✓ | ✓ |
| Multi-site | — | up to 5 | unlimited |
| Autonomy modes | advisory only | advisory + conditional | + autonomous |
| Custom system prompts | — | — | ✓ |
| On-prem deployment option | — | — | ✓ |
| Dedicated support | email | priority email | named CSM |

## Testing the activation flow locally

```bash
# Apply the migration
supabase db push

# Deploy the Edge Function
supabase functions deploy marketplace-fulfillment-webhook

# Test resolve with a fake token (will fail at AAD acquisition without real secrets)
curl -X POST $SUPABASE_URL/functions/v1/marketplace-fulfillment-webhook \
  -H 'Content-Type: application/json' \
  -d '{"action":"resolve","marketplace_token":"<token>"}'

# Test webhook event apply (no AAD needed — pure DB write)
curl -X POST $SUPABASE_URL/functions/v1/marketplace-fulfillment-webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "action":"webhook",
    "event": {
      "id":"test-event-1","activityId":"act-1",
      "subscriptionId":"<existing-sub-uuid>",
      "publisherId":"stiggtechnologies","offerId":"syncai_industrial",
      "planId":"pro","quantity":15,
      "timeStamp":"2026-05-08T00:00:00Z",
      "action":"ChangeQuantity","status":"Subscribed"
    }
  }'
```

## Related

- Migration: [`supabase/migrations/015_marketplace_microsoft.sql`](../supabase/migrations/015_marketplace_microsoft.sql)
- Edge Function: [`supabase/functions/marketplace-fulfillment-webhook/index.ts`](../supabase/functions/marketplace-fulfillment-webhook/index.ts)
- Activation UI: [`src/pages/MarketplaceActivate.tsx`](../src/pages/MarketplaceActivate.tsx)
- Marketing landing: `StiggSyncAIwebsite2.0/app/microsoft/page.tsx`

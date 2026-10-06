# AWS Marketplace SaaS Listing

**2026-10-06 — DESIGN SCAFFOLDING, NOT A PUBLISHED OR TRANSACTABLE
LISTING.** The public marketing and activation routes respond, but the AWS
Marketplace Edge Functions are not deployed on the live SyncAI Supabase
project, the required AWS secrets are absent, and the referenced database
migration is archived rather than active. AWS's current buyer onboarding sends
`x-amzn-marketplace-token` to the registration URL as an HTTP `POST`; the
checked-in SPA reads a query parameter and therefore is not a conforming buyer
handoff. Do not describe this channel as available until the seller account,
product, POST registration endpoint, lifecycle integration, production schema,
and preview purchase are verified.

How SyncAI is structured on AWS Marketplace, how purchases flow from
the listing into a working tenant, and how lifecycle events are kept
in sync.

This is the AWS counterpart of [`azure-marketplace.md`](./azure-marketplace.md)
— same pattern, AWS APIs.

## Offer summary

- **Listing type:** SaaS Listing (not SaaS Contract or AMI)
- **Pricing model:** Per-seat, monthly recurring, billed via AWS invoice
- **Plans:** Starter · Professional · Enterprise (private offer). Per-seat
  prices are under commercial review and are set in AWS Marketplace at
  listing time; no price is committed in this document.
- **EDP eligibility:** Not evidenced. Do not claim eligibility before AWS
  confirms the published product's program treatment.

## Intended activation flow

```
1. Buyer subscribes via AWS Marketplace product page
2. AWS sends an HTTP `POST` to the seller registration URL with the form field
   `x-amzn-marketplace-token=<token>`.
3. A server-side registration handler exchanges the token and then hands the
   buyer to the bounded account-setup UI. That server-side handler is not
   implemented in the current production route.
4. Edge Function:
       a. SigV4-signs a POST to:
          https://metering.marketplace.<region>.amazonaws.com/customer
          X-Amz-Target: AWSMPMeteringService.ResolveCustomer
          Body: { "RegistrationToken": "<token>" }
       b. AWS returns:
          { CustomerIdentifier, CustomerAWSAccountId, ProductCode }
       c. Persists via upsert_aws_marketplace_subscription RPC, which
          inserts into billing_subscriptions with billing_source = 'aws_marketplace'
       d. Logs audit row in aws_marketplace_events
5. UI shows resolved customer details
6. Buyer clicks "Continue to account setup" → standard signup
7. Within ~5 min, AWS sends a SubscribeSuccess SNS event → SQS → relay
   Lambda → POST to marketplace-aws-webhook. Status flips to aws_subscribed.
```

## Lifecycle events (SNS → SQS → relay)

AWS publishes lifecycle events to a topic you subscribe an SQS queue to.
A small relay (typically a Lambda function) forwards each SQS message to:

```
POST https://app.syncai.ca/functions/v1/marketplace-aws-webhook
Body: {
  "message_id": "<sqs-message-id>",   // idempotency key (UNIQUE constraint)
  "event": {
    "action": "subscribe-success" | "unsubscribe-pending" |
              "unsubscribe-success" | "subscribe-fail",
    "customer-identifier": "<resolved-customer-id>",
    "product-code": "<product-code>",
    "offer-identifier": "<offer-code>",
    "timestamp": "..."
  }
}
```

| AWS action            | billing_subscriptions.aws_status          |
| --------------------- | ----------------------------------------- |
| `subscribe-success`   | `aws_subscribed` (status → `active`)      |
| `unsubscribe-pending` | `aws_unsubscribe_pending`                 |
| `unsubscribe-success` | `aws_unsubscribed` (status → `cancelled`) |
| `subscribe-fail`      | `aws_expired`                             |

Idempotency: every event log is keyed by `message_id` with a UNIQUE
constraint. Duplicate SQS deliveries return `idempotent: true` without
re-applying.

## Required env

```bash
supabase secrets set \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=...
```

The IAM principal needs:

```json
{
  "Effect": "Allow",
  "Action": [
    "aws-marketplace:ResolveCustomer",
    "aws-marketplace:GetEntitlements",
    "aws-marketplace:BatchMeterUsage"
  ],
  "Resource": "*"
}
```

## SigV4 signing

The Edge Function ships with an inline SigV4 signer (no AWS SDK
dependency, keeps cold start tight). It signs the ResolveCustomer call
with the standard `Authorization` header. The signer is reusable — for
Metering or Entitlement calls, change `service` and `X-Amz-Target` in
`sigV4SignRequest`.

## Proposed tables (archived migration only)

The referenced migration lives under `supabase/_legacy_migrations/`; it is not
part of the active migration chain and its columns/RPCs must not be assumed to
exist in production.

| Object                                    | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `billing_subscriptions.aws_*` columns     | Per-org AWS subscription identity (UUID-keyed by aws_customer_identifier) |
| `aws_marketplace_events`                  | Audit log; idempotent on `message_id`                                     |
| `upsert_aws_marketplace_subscription` RPC | service-role-only helper for the Edge Function                            |

## Deployment checklist

- [ ] AWS Marketplace seller account approved
- [ ] Product registered with productCode
- [ ] IAM role created with the policy above
- [ ] SNS topic subscribed for lifecycle events
- [ ] SQS queue subscribed to the SNS topic
- [ ] Lambda relay deployed (forwards SQS messages → webhook URL)
- [ ] DNS: `app.syncai.ca/marketplace/aws/signup` resolves
- [ ] AWS env vars set in Supabase secrets (above)
- [ ] Migration `20260513000000_aws_salesforce_marketplace_integration.sql` applied
- [ ] Edge Functions `marketplace-aws-resolve` and `marketplace-aws-webhook` deployed
- [ ] Test: purchase → ResolveCustomer succeeds → first SubscribeSuccess flips status to aws_subscribed within 5 min

## Related

- Archived migration: [`supabase/_legacy_migrations/20260513000000_aws_salesforce_marketplace_integration.sql`](../supabase/_legacy_migrations/20260513000000_aws_salesforce_marketplace_integration.sql)
- Resolve Edge Function: [`supabase/functions/marketplace-aws-resolve/index.ts`](../supabase/functions/marketplace-aws-resolve/index.ts)
- Webhook Edge Function: [`supabase/functions/marketplace-aws-webhook/index.ts`](../supabase/functions/marketplace-aws-webhook/index.ts)
- Activation UI: [`src/pages/AwsMarketplaceSignup.tsx`](../src/pages/AwsMarketplaceSignup.tsx)
- Client lib: [`src/lib/aws-marketplace.ts`](../src/lib/aws-marketplace.ts)
- Marketing landing: `https://syncai.ca/aws` responds, but is not an AWS
  Marketplace listing or purchase surface.
- Microsoft (companion): [`docs/azure-marketplace.md`](./azure-marketplace.md)

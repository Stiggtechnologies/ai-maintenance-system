# AWS Marketplace SaaS Listing

How SyncAI is structured on AWS Marketplace and how purchases flow from
the listing to a working tenant.

## Offer summary

- **Offer name:** SyncAI — Industrial AI Infrastructure (AWS)
- **Offer code (internal):** `syncai_industrial_aws`
- **Publisher seller account:** stigg-technologies
- **Type:** SaaS Listing (not SaaS Contract or AMI)
- **Pricing model:** Per-seat, monthly recurring, billed on AWS invoice
- **Plans:** Starter ($99) · Professional ($199) · Enterprise (private offer)

## Activation flow

```
1. Buyer subscribes via AWS Marketplace product page
2. AWS redirects to:
       https://app.syncai.ca/marketplace/aws/activate?x-amzn-marketplace-token=<token>
3. AwsMarketplaceActivate page calls marketplace-aws-fulfillment-webhook
       action: "resolve"  (POST + token)
4. Edge Function:
       a. SigV4-signs a POST to:
          https://metering.marketplace.<region>.amazonaws.com/customer
          X-Amz-Target: AWSMPMeteringService.ResolveCustomer
          Body: { "RegistrationToken": "<token>" }
       b. AWS returns:
          { CustomerIdentifier, CustomerAWSAccountId, ProductCode }
       c. Persists to marketplace_subscriptions (idempotent on
          marketplace_subscription_id = CustomerIdentifier)
       d. Initial status: aws_pending_subscription
5. UI shows resolved customer details
6. Buyer clicks "Continue to account setup" → /signup
7. Within ~5 minutes, AWS sends a SubscribeSuccess SNS event →
   our SQS queue → relay Lambda → POST to fulfillment-webhook with
   action: "event". Status flips to aws_subscribed.
```

## Lifecycle events (SNS → SQS → relay)

AWS publishes lifecycle events to a topic; you subscribe an SQS queue
and run a relay (typically a small Lambda) that POSTs each message to:

```
POST https://app.syncai.ca/functions/v1/marketplace-aws-fulfillment-webhook
Body: {
  "action": "event",
  "message_id": "<sqs-message-id>",   // idempotency key
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

| AWS action | Local status |
|---|---|
| `subscribe-success` | `aws_subscribed` |
| `unsubscribe-pending` | `aws_unsubscribe_pending` |
| `unsubscribe-success` | `aws_unsubscribed` (sets `canceled_at`) |
| `subscribe-fail` | `aws_expired` |

Idempotency: every event log is keyed by `message_id`. A retry from AWS
or a duplicate SQS delivery is a no-op on the second attempt.

## Required env

```bash
supabase secrets set \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=... \
  AWS_PRODUCT_CODE=<your-product-code> \
  AWS_OFFER_CODE=syncai_industrial_aws
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

The Edge Function ships with a small inline SigV4 signer (no AWS SDK
dependency, keeps cold start tight). It signs the ResolveCustomer call
with the standard Authorization header. If you ever need to add Metering
or Entitlement calls, the signer is reusable — change `service` and
`X-Amz-Target` in `sigV4SignRequest`.

## Deployment checklist

- [ ] AWS Marketplace seller account approved
- [ ] Product registered with productCode + offerCode
- [ ] IAM role created for Marketplace API access (see env above)
- [ ] SNS topic subscribed for the offer's lifecycle events
- [ ] SQS queue subscribed to the SNS topic
- [ ] Lambda relay deployed (forwards SQS messages → our webhook)
- [ ] DNS: `app.syncai.ca/marketplace/aws/activate` resolves
- [ ] Listing page on syncai.ca/aws live (matching offer code + plans)
- [ ] AWS secrets set (above)
- [ ] Test: purchase → ResolveCustomer succeeds → first SubscribeSuccess
      flips status to aws_subscribed within 5 min

## Related

- Migration: [`supabase/migrations/016_marketplace_aws_salesforce.sql`](../supabase/migrations/016_marketplace_aws_salesforce.sql)
- Edge Function: [`supabase/functions/marketplace-aws-fulfillment-webhook/index.ts`](../supabase/functions/marketplace-aws-fulfillment-webhook/index.ts)
- Activation UI: [`src/pages/AwsMarketplaceActivate.tsx`](../src/pages/AwsMarketplaceActivate.tsx)
- Marketing: `StiggSyncAIwebsite2.0/app/aws/page.tsx`
- Multi-marketplace schema (Microsoft + AWS + Salesforce): [`docs/azure-marketplace.md`](./azure-marketplace.md)

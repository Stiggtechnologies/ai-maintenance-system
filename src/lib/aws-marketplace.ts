/**
 * AWS Marketplace SaaS Listing — client-side integration
 *
 * Mirrors the structure of `lib/azure-marketplace.ts`:
 *  - Token resolution (exchange the AWS Marketplace registration token for
 *    a CustomerIdentifier via the marketplace-aws-resolve Edge Function)
 *  - Subscription details fetching
 *  - Wrapped Edge Function calls so pages can be thin
 */
import { supabase } from "./supabase";

/**
 * AWS Marketplace subscription details, post-resolve.
 *
 * Mirrors the AWS ResolveCustomer response shape:
 * https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_ResolveCustomer.html
 */
export interface AwsMarketplaceSubscription {
  /** AWS Marketplace customer identifier (UUID-like) */
  customerIdentifier: string;
  /** Customer's AWS account id (12-digit) */
  customerAWSAccountId: string;
  /** AWS product code for the subscribed offer */
  productCode: string;
  /** Offer identifier within the product code */
  offerIdentifier?: string;
  /** Local lifecycle status (mirrors AWS lifecycle) */
  status:
    | "aws_pending_subscription"
    | "aws_subscribed"
    | "aws_unsubscribe_pending"
    | "aws_unsubscribed"
    | "aws_expired";
  /** Seat count from the buyer's AWS subscription */
  quantity?: number;
  /** Local billing_subscriptions row id (after persistence) */
  subscriptionId?: string;
}

interface ResolveResponse {
  ok: boolean;
  subscription_id?: string;
  customer_identifier?: string;
  aws_account_id?: string;
  product_code?: string;
  offer_identifier?: string;
  status?: AwsMarketplaceSubscription["status"];
  quantity?: number;
  error?: string;
}

/**
 * Resolve an AWS Marketplace registration token via the
 * marketplace-aws-resolve Edge Function.
 *
 * Throws on failure (matching the Azure helper's behavior).
 */
export async function resolveAwsMarketplaceToken(
  token: string,
): Promise<AwsMarketplaceSubscription> {
  const supabaseUrl = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL not configured");

  const res = await fetch(
    `${supabaseUrl}/functions/v1/marketplace-aws-resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplace_token: token }),
    },
  );

  const json = (await res.json().catch(() => ({}))) as ResolveResponse;
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `Resolve failed: HTTP ${res.status}`);
  }

  return {
    customerIdentifier: json.customer_identifier!,
    customerAWSAccountId: json.aws_account_id ?? "",
    productCode: json.product_code ?? "",
    offerIdentifier: json.offer_identifier,
    status: json.status ?? "aws_pending_subscription",
    quantity: json.quantity,
    subscriptionId: json.subscription_id,
  };
}

/**
 * Link a resolved AWS Marketplace customer to an authenticated SyncAI user.
 * Called after the user signs up; sets billing_subscriptions.tenant_id to
 * the user's organization.
 */
export async function linkAwsCustomerToOrg(
  customerIdentifier: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("billing_subscriptions")
    .update({ tenant_id: organizationId, status: "active" })
    .eq("aws_customer_identifier", customerIdentifier);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

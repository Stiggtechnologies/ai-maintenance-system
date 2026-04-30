/**
 * Azure Marketplace SaaS Integration for SyncAI Platform
 *
 * This module handles client-side marketplace operations including:
 * - Token resolution to retrieve subscription details
 * - Subscription activation and status management
 * - Communication with Supabase Edge Functions for server-side operations
 */

/**
 * Azure Marketplace subscription details
 *
 * Represents a SaaS subscription created through Azure Marketplace
 */
export interface MarketplaceSubscription {
  /** Subscription resource ID */
  id: string;
  /** Microsoft partner/publisher ID */
  publisherId: string;
  /** Marketplace offer ID */
  offerId: string;
  /** Subscription plan ID */
  planId: string;
  /** Subscription details */
  subscription: {
    /** Display name of the subscription */
    name: string;
    /** Subscription resource ID */
    id: string;
  };
  /** Beneficiary (customer) details */
  beneficiary: {
    /** Azure AD email address */
    emailId: string;
    /** Azure AD object ID */
    objectId: string;
    /** Azure AD tenant ID */
    tenantId: string;
  };
  /** Purchaser account details (may differ from beneficiary) */
  purchaser: {
    /** Azure AD email address */
    emailId: string;
    /** Azure AD object ID */
    objectId: string;
    /** Azure AD tenant ID */
    tenantId: string;
  };
  /** Number of seats/licenses purchased */
  quantity: number;
  /** Billing term (e.g., "monthly", "yearly") */
  term: string;
  /** Whether this is a test subscription */
  isTest: boolean;
  /** Current status (e.g., "Subscribed", "Suspended", "Unsubscribed") */
  saasSubscriptionStatus: string;
}

/**
 * Resolves a marketplace token to retrieve subscription details
 *
 * Calls the marketplace-resolve Supabase Edge Function which:
 * - Validates the token with Azure Marketplace
 * - Retrieves subscription details from Azure
 * - Returns the subscription information
 *
 * @param token - Marketplace purchase token from Azure
 * @returns The resolved subscription details
 * @throws {Error} If token resolution fails
 *
 * @example
 * const token = getMarketplaceToken();
 * const subscription = await resolveMarketplaceToken(token);
 * console.log(subscription.subscription.name);
 */
export async function resolveMarketplaceToken(
  token: string,
): Promise<MarketplaceSubscription> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: "resolve-token",
          token,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to resolve marketplace token: ${error}`);
    }

    const subscription = (await response.json()) as MarketplaceSubscription;
    return subscription;
  } catch (error) {
    console.error("Error resolving marketplace token:", error);
    throw error;
  }
}

/**
 * Activates a marketplace subscription
 *
 * Notifies Azure Marketplace that the subscription has been activated
 * on the SyncAI platform, transitioning it from "PendingFulfillment"
 * to "Subscribed" status.
 *
 * @param subscriptionId - The subscription resource ID
 * @param planId - The plan ID being activated
 * @param quantity - The number of seats/licenses for this subscription
 * @throws {Error} If activation fails
 *
 * @example
 * await activateMarketplaceSubscription(
 *   'subscription-123',
 *   'basic-plan',
 *   5
 * );
 */
export async function activateMarketplaceSubscription(
  subscriptionId: string,
  planId: string,
  quantity: number,
): Promise<void> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: "activate-subscription",
          subscriptionId,
          planId,
          quantity,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to activate subscription: ${error}`);
    }
  } catch (error) {
    console.error("Error activating marketplace subscription:", error);
    throw error;
  }
}

/**
 * Retrieves the current status of a marketplace subscription
 *
 * Checks the subscription status with Azure Marketplace and returns
 * the current state (e.g., "Subscribed", "Suspended", "Unsubscribed").
 *
 * @param subscriptionId - The subscription resource ID
 * @returns The current subscription status
 * @throws {Error} If status check fails
 *
 * @example
 * const status = await getMarketplaceSubscriptionStatus('subscription-123');
 * if (status === 'Suspended') {
 *   // Handle suspended subscription
 * }
 */
export async function getMarketplaceSubscriptionStatus(
  subscriptionId: string,
): Promise<string> {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/marketplace-resolve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: "get-subscription-status",
          subscriptionId,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get subscription status: ${error}`);
    }

    const data = (await response.json()) as { status: string };
    return data.status;
  } catch (error) {
    console.error("Error getting marketplace subscription status:", error);
    throw error;
  }
}

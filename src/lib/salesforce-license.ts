/**
 * Salesforce AppExchange — client-side integration
 *
 * Salesforce doesn't have a redirect-with-token flow like Microsoft and AWS.
 * The customer installs the SyncAI managed package; LMA license events
 * post asynchronously to marketplace-salesforce-license. This module is
 * primarily TypeScript types for the activation page + a helper to look
 * up the license-event status for a Salesforce org.
 */
import { supabase } from "./supabase";

export interface SalesforceLicenseSubscription {
  /** SF License Id (18-char) — primary key in our system */
  sfLicenseId: string;
  /** SF organization id (15- or 18-char) */
  sfOrganizationId: string;
  /** Managed package version id (e.g. 04t...) */
  sfPackageVersionId: string;
  /** Seat count from LMA */
  seats: number;
  /** Local lifecycle status */
  status:
    | "sf_active"
    | "sf_trial"
    | "sf_suspended"
    | "sf_uninstalled"
    | "sf_expired";
  /** When the license expires (LMA-provided) */
  expiresAt?: string | null;
  /** Local billing_subscriptions row id */
  subscriptionId?: string;
}

/**
 * Fetch the most recent license record for a given SF organization id.
 * Used by SalesforceSignup to confirm activation completed.
 */
export async function fetchSalesforceLicenseForOrg(
  sfOrganizationId: string,
): Promise<SalesforceLicenseSubscription | null> {
  const { data, error } = await supabase
    .from("billing_subscriptions")
    .select(
      "id, sf_license_id, sf_organization_id, sf_package_version_id, sf_seats, sf_status, sf_expires_at",
    )
    .eq("sf_organization_id", sfOrganizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.sf_license_id) return null;

  return {
    sfLicenseId: data.sf_license_id,
    sfOrganizationId: data.sf_organization_id,
    sfPackageVersionId: data.sf_package_version_id ?? "",
    seats: data.sf_seats ?? 0,
    status: data.sf_status ?? "sf_active",
    expiresAt: data.sf_expires_at,
    subscriptionId: data.id,
  };
}

/**
 * Link a Salesforce subscription (via license_id) to an authenticated
 * SyncAI user's organization.
 */
export async function linkSalesforceLicenseToOrg(
  sfLicenseId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("billing_subscriptions")
    .update({ tenant_id: organizationId, status: "active" })
    .eq("sf_license_id", sfLicenseId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

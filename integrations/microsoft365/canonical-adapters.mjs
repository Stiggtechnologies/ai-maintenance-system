// Reuse the repository's existing verified Azure identity helper, not a copy.
import { verifiedAzureTenantId } from "../../supabase/functions/marketplace-fulfillment/core.ts";
export function canonicalAdapters({
  supabaseUrl,
  publishableKey,
  exchangeUserToken,
  resolveApprovedEntitlement,
  fetchImpl = fetch,
}) {
  const url = new URL(supabaseUrl);
  if (
    url.protocol !== "https:" ||
    !publishableKey ||
    !exchangeUserToken ||
    !resolveApprovedEntitlement
  )
    throw new Error("approved canonical integration configuration required");
  async function request(path, token) {
    const response = await fetchImpl(new URL(path, url), {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("canonical read refused");
    return response.json();
  }
  return {
    async verifyIdentity(userToken) {
      // Microsoft channel/user token is NOT a Supabase session token.
      const token = await exchangeUserToken(userToken);
      if (!token) throw new Error("canonical user session missing");
      const user = await request("/auth/v1/user", token);
      const tenantId = verifiedAzureTenantId(user);
      if (!tenantId || !user.id)
        throw new Error("verified Azure user required");
      const profiles = await request(
        `/rest/v1/user_profiles?select=organization_id,role&id=eq.${encodeURIComponent(user.id)}`,
        token,
      );
      if (
        !Array.isArray(profiles) ||
        profiles.length !== 1 ||
        !profiles[0].organization_id
      )
        throw new Error("canonical membership required");
      return {
        verified: true,
        tenantId,
        organizationId: profiles[0].organization_id,
        subject: user.id,
        sessionToken: token,
      };
    },
    readEntitlement(identity) {
      return resolveApprovedEntitlement(identity);
    },
    async readTenantAgents(identity) {
      if (!identity.verified || !identity.sessionToken)
        throw new Error("canonical session required");
      return request(
        `/rest/v1/ai_agents?select=key,name,status,organization_id&organization_id=eq.${encodeURIComponent(identity.organizationId)}`,
        identity.sessionToken,
      );
    },
  };
}

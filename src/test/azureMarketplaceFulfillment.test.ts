import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
  activeFunctions: string[];
  blockedLegacyFunctions: string[];
  allowedNoVerifyJwt: string[];
};
const edge = read("supabase/functions/marketplace-fulfillment/index.ts");
const core = read("supabase/functions/marketplace-fulfillment/core.ts");
const client = read("src/lib/azure-marketplace.ts");
const signup = read("src/pages/MarketplaceSignup.tsx");
const callback = read("src/pages/AzureADCallback.tsx");
const migration = read(
  "supabase/migrations/20261227100000_azure_marketplace_fulfillment.sql",
);
const deploy = read(".github/workflows/deploy-migrations.yml");
const ci = read(".github/workflows/ci.yml");
const docs = read("docs/azure-marketplace.md");
const supabaseConfig = read("supabase/config.toml");

describe("Azure Marketplace A4 production boundary", () => {
  it("deploys only the new reviewed custom-auth function and keeps legacy resolve blocked", () => {
    expect(boundary.activeFunctions).toContain("marketplace-fulfillment");
    expect(boundary.blockedLegacyFunctions).toContain("marketplace-resolve");
    expect(boundary.allowedNoVerifyJwt).toContain("marketplace-fulfillment");
    expect(supabaseConfig).toMatch(
      /\[functions\.marketplace-fulfillment\]\s+verify_jwt = false/,
    );
    expect(deploy).toContain(
      "supabase functions deploy marketplace-fulfillment --no-verify-jwt",
    );
    expect(deploy).not.toMatch(/supabase functions deploy marketplace-resolve/);
    expect(deploy).toContain("Prove Azure Marketplace Fulfillment is deployed");
    expect(deploy).toContain(
      '"action":"activate","resolutionId":"11111111-1111-4111-8111-111111111111"',
    );
    expect(edge).toContain("verified_azure_session_required");
  });

  it("keeps all Microsoft commerce calls and publisher credentials server-side", () => {
    expect(core).toContain("marketplaceapi.microsoft.com");
    expect(edge).toContain('method: "POST"');
    expect(edge).toContain("marketplaceActivateUrl(subscriptionId)");
    expect(edge).toContain("marketplaceSubscriptionUrl(subscriptionId)");
    expect(edge).toContain('method: "GET"');
    expect(edge.indexOf("let current = await marketplaceCall")).toBeLessThan(
      edge.lastIndexOf("shouldActivateMarketplaceSubscription"),
    );
    expect(client).not.toContain("marketplaceapi.microsoft.com");
    expect(signup).not.toContain("marketplaceapi.microsoft.com");
    expect(edge).toContain("AZURE_MARKETPLACE_CLIENT_ID");
    expect(edge).toContain("AZURE_MARKETPLACE_CLIENT_SECRET");
    expect(edge).not.toContain("ENTRA_SSO_CLIENT_SECRET");
    expect(client).not.toContain("AZURE_MARKETPLACE_CLIENT_SECRET");
    expect(edge).toContain("consume_public_reliability_ip_allowance");
    expect(edge).toContain('request.headers.get("cf-connecting-ip")');
    expect(edge).toContain('forwardedChain?.split(",").pop()');
    expect(edge).toContain("resolve_rate_limit_reached");
  });

  it("never persists or redisplays the raw Microsoft purchase token", () => {
    expect(migration).not.toMatch(/\bpurchase_token\b/i);
    expect(migration).toContain("token_fingerprint");
    expect(signup).toContain('scrubbed.searchParams.delete("token")');
    expect(signup).not.toContain('sessionStorage.setItem("marketplace_token"');
    expect(signup).not.toContain(
      'sessionStorage.setItem("marketplace_subscription"',
    );
    expect(callback).not.toContain(
      'sessionStorage.getItem("marketplace_token"',
    );
    expect(client).toContain("marketplace_fulfillment_resolution");
  });

  it("binds only through existing tenant authority and canonical records", () => {
    expect(migration).toContain(
      "Marketplace activation requires an existing organization administrator",
    );
    expect(migration).toContain(
      "verified Microsoft tenant does not match the purchase",
    );
    expect(migration).not.toMatch(/insert into public\.organizations/i);
    expect(migration).not.toMatch(/insert into public\.user_profiles/i);
    expect(migration).toContain("insert into public.billing_subscriptions");
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).not.toMatch(/create table.*marketplace_events/is);
    expect(migration).toContain(
      "Marketplace purchase is already bound to another organization",
    );
  });

  it("keeps service RPCs and private identity data outside the browser surface", () => {
    expect(migration).toMatch(
      /revoke all on function public\.claim_marketplace_fulfillment_activation[\s\S]+from public,anon,authenticated/,
    );
    expect(core).toContain("publicSubscription");
    expect(core).not.toMatch(
      /return \{[\s\S]{0,300}(beneficiary|purchaser): subscription\./,
    );
    expect(signup).not.toMatch(/beneficiary|purchaser|emailId|objectId/);
  });

  it("runs the tenant/idempotency smoke in the required migration gate", () => {
    expect(ci).toContain("ci-azure-marketplace-fulfillment-smoke.sh");
    const smoke = read("scripts/ci-azure-marketplace-fulfillment-smoke.sh");
    expect(smoke).toContain("non-admin activation was not refused");
    expect(smoke).toContain("cross-tenant rebinding was not refused");
    expect(smoke).toContain("activation claim is not idempotent");
    expect(smoke).toContain("canonical billing record did not become active");
    expect(smoke).toContain("raw purchase token material was persisted");
  });

  it("documents the deployed A4 boundary without claiming a buyer-proven offer", () => {
    expect(docs).toContain(
      "Governed v2 resolve, explicit activation and authoritative status refresh are deployed",
    );
    expect(docs).toContain(
      "Publisher credentials are not configured and no real purchase has been witnessed end to end",
    );
    expect(docs).toContain("A5");
    expect(docs).toContain(
      "Deployed behind independent Microsoft JWT validation",
    );
  });
});

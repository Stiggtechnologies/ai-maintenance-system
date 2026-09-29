import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const federation = readFileSync("src/lib/azure-ad.ts", "utf8");
const authClient = readFileSync("src/lib/supabase.ts", "utf8");
const callback = readFileSync("src/pages/AzureADCallback.tsx", "utf8");
const application = readFileSync("src/App.tsx", "utf8");
const hostedAuth = readFileSync("scripts/configure-production-auth.mjs", "utf8");

describe("Azure A3 verified Entra session contract", () => {
  it("delegates OAuth and PKCE exchange to Supabase Auth", () => {
    expect(federation).toContain('provider: "azure"');
    expect(federation).toContain("supabase.auth.signInWithOAuth");
    expect(federation).toContain("supabase.auth.exchangeCodeForSession");
    expect(federation).toContain("await supabase.auth.getUser()");
    expect(federation).toContain("isAzureBackedUser");
    expect(federation).not.toContain("decodeJWT");
    expect(federation).not.toContain("oauth2/v2.0/token");
    expect(federation).not.toContain("client_secret");
  });

  it("uses PKCE while reserving the Entra callback for explicit verification", () => {
    expect(authClient).toContain('flowType: "pkce"');
    expect(authClient).toContain(
      'url.pathname !== "/auth/callback/azure"',
    );
    expect(federation).toContain("PKCE_FLOW_ID_PARAM");
    expect(federation).toContain("Implicit Microsoft tokens are not accepted");
  });

  it("keeps authentication separate from commerce and tenant entitlement", () => {
    expect(callback).not.toContain("activateMarketplaceSubscription");
    expect(callback).toContain("Authentication and commerce are separate controls");
    expect(federation).not.toContain("organization_id");
    expect(federation).not.toContain("marketplace-resolve");
    expect(callback).toContain("hasWorkspaceMembership(verified.user.id)");
    expect(callback).toContain("it has not been provisioned into a SyncAI organization");
    expect(application).toContain("hasWorkspaceMembership(session.user.id)");
    expect(application).toContain("await supabase.auth.signOut()");
  });

  it("deploys hosted Azure provider configuration only from protected secrets", () => {
    expect(hostedAuth).toContain("external_azure_enabled: true");
    expect(hostedAuth).toContain("external_azure_client_id: entraClientId");
    expect(hostedAuth).toContain("external_azure_secret: entraClientSecret");
    expect(hostedAuth).toContain(
      "ENTRA_SSO_CLIENT_ID and ENTRA_SSO_CLIENT_SECRET must be configured together",
    );
  });
});

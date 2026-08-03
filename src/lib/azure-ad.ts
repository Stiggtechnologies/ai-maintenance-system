/**
 * Enterprise federation safety boundary.
 *
 * Azure/OIDC sign-in is intentionally disabled until SyncAI has a supported
 * server-side identity exchange that establishes a verified Supabase session.
 * Keeping the block in this shared module makes every current caller fail
 * closed, including direct callback and marketplace flows.
 */

export interface AzureADConfig {
  clientId: string;
  tenantId: string;
  redirectUri: string;
}

const browserOrigin =
  typeof window === "undefined" ? "" : window.location.origin;

export const azureAdConfig: AzureADConfig = {
  clientId: import.meta.env.VITE_AZURE_AD_CLIENT_ID || "",
  tenantId: import.meta.env.VITE_AZURE_AD_TENANT_ID || "common",
  redirectUri:
    import.meta.env.VITE_AZURE_AD_REDIRECT_URI ||
    (browserOrigin ? `${browserOrigin}/auth/callback/azure` : ""),
};

export const AZURE_AD_CLIENT_ID = azureAdConfig.clientId;
export const AZURE_AD_TENANT_ID = azureAdConfig.tenantId;
export const AZURE_AD_REDIRECT_URI = azureAdConfig.redirectUri;

export const ENTERPRISE_SSO_ENABLED = false as const;
export const ENTERPRISE_SSO_DISABLED_MESSAGE =
  "Enterprise SSO is not enabled in this environment. Use an approved SyncAI account or contact your administrator.";

const MARKETPLACE_TOKEN_PARAM = "marketplace_token";
const STATE_STORAGE_KEY = "azure_ad_state";

function enterpriseSsoDisabledError(): Error {
  return new Error(ENTERPRISE_SSO_DISABLED_MESSAGE);
}

/**
 * Authorization URL generation is blocked until the complete, verified OIDC
 * session flow is implemented and independently tested.
 */
export function getAzureADAuthUrl(state?: string): never {
  void state;
  throw enterpriseSsoDisabledError();
}

/** Fail closed instead of initiating an incomplete OAuth flow. */
export async function signInWithAzureAD(): Promise<never> {
  throw enterpriseSsoDisabledError();
}

/**
 * A callback URL must never be treated as authenticated while federation is
 * disabled. Clear stale state and return no authorization result.
 */
export async function handleAzureADCallback(): Promise<null> {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(STATE_STORAGE_KEY);
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
  return null;
}

/** Fail closed instead of accepting an unverified token exchange response. */
export async function exchangeCodeForSession(code: string): Promise<never> {
  void code;
  throw enterpriseSsoDisabledError();
}

export function isMarketplaceSignup(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(
    MARKETPLACE_TOKEN_PARAM,
  );
}

export function getMarketplaceToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(
    MARKETPLACE_TOKEN_PARAM,
  );
}

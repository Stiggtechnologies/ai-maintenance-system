/**
 * Azure AD OAuth 2.0 SSO Integration for SyncAI Platform
 *
 * This module handles client-side Azure AD authentication including:
 * - Authorization URL generation with Microsoft OAuth 2.0
 * - Authorization code flow with CSRF state validation
 * - Token exchange via Supabase Edge Functions
 * - Marketplace integration support
 */

/**
 * Configuration interface for Azure AD authentication
 */
export interface AzureADConfig {
  /** Azure AD application (client) ID */
  clientId: string;
  /** Azure AD tenant ID ('common' for multi-tenant) */
  tenantId: string;
  /** OAuth 2.0 callback URI */
  redirectUri: string;
}

/**
 * Azure AD configuration loaded from environment variables
 */
export const azureAdConfig: AzureADConfig = {
  clientId: import.meta.env.VITE_AZURE_AD_CLIENT_ID || "",
  tenantId: import.meta.env.VITE_AZURE_AD_TENANT_ID || "common",
  redirectUri:
    import.meta.env.VITE_AZURE_AD_REDIRECT_URI ||
    `${window.location.origin}/auth/callback/azure`,
};

/**
 * Configuration constants
 */
export const AZURE_AD_CLIENT_ID = azureAdConfig.clientId;
export const AZURE_AD_TENANT_ID = azureAdConfig.tenantId;
export const AZURE_AD_REDIRECT_URI = azureAdConfig.redirectUri;

/**
 * Storage key for CSRF state token
 */
const STATE_STORAGE_KEY = "azure_ad_state";

/**
 * Marketplace token URL parameter name
 */
const MARKETPLACE_TOKEN_PARAM = "marketplace_token";

/**
 * Generates a random state token for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Constructs the Microsoft OAuth 2.0 authorization URL
 *
 * @param state - Optional CSRF state token. If not provided, a new one will be generated.
 * @returns The authorization URL for redirecting the user to Azure AD login
 *
 * @example
 * const authUrl = getAzureADAuthUrl();
 * window.location.href = authUrl;
 */
export function getAzureADAuthUrl(state?: string): string {
  const authState = state || generateState();

  const params = new URLSearchParams({
    client_id: AZURE_AD_CLIENT_ID,
    response_type: "code",
    redirect_uri: AZURE_AD_REDIRECT_URI,
    scope: "openid profile email",
    state: authState,
  });

  return `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Initiates the Azure AD sign-in flow
 *
 * Generates a state token, stores it for validation, and redirects to Azure AD.
 * The user will be redirected back to VITE_AZURE_AD_REDIRECT_URI with an auth code.
 *
 * @throws {Error} If configuration is incomplete
 *
 * @example
 * await signInWithAzureAD();
 */
export async function signInWithAzureAD(): Promise<void> {
  if (!AZURE_AD_CLIENT_ID || !AZURE_AD_REDIRECT_URI) {
    throw new Error(
      "Azure AD configuration incomplete: clientId and redirectUri are required",
    );
  }

  const state = generateState();
  sessionStorage.setItem(STATE_STORAGE_KEY, state);

  const authUrl = getAzureADAuthUrl(state);
  window.location.href = authUrl;
}

/**
 * Callback handler for Azure AD OAuth 2.0 flow
 *
 * Extracts the authorization code and state from URL parameters,
 * validates the state against the stored value, and cleans up the URL.
 *
 * @returns Object with code and state if validation succeeds, null otherwise
 *
 * @example
 * const result = await handleAzureADCallback();
 * if (result) {
 *   await exchangeCodeForSession(result.code);
 * }
 */
export async function handleAzureADCallback(): Promise<{
  code: string;
  state: string;
} | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    return null;
  }

  // Validate state token for CSRF protection
  const storedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  if (state !== storedState) {
    console.error("State validation failed: CSRF token mismatch");
    return null;
  }

  // Clean up URL parameters
  window.history.replaceState({}, document.title, window.location.pathname);

  // Clean up stored state
  sessionStorage.removeItem(STATE_STORAGE_KEY);

  return { code, state };
}

/**
 * Exchanges the authorization code for a Supabase session
 *
 * Calls the marketplace-resolve Supabase Edge Function which:
 * - Exchanges the code for Azure AD tokens (server-side)
 * - Creates a Supabase session with the user's Azure AD identity
 * - Returns session tokens
 *
 * @param code - Authorization code from Azure AD callback
 * @throws {Error} If token exchange fails
 *
 * @example
 * const { code } = await handleAzureADCallback();
 * await exchangeCodeForSession(code);
 */
export async function exchangeCodeForSession(code: string): Promise<void> {
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
          action: "exchange-code",
          code,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    // The edge function handles setting the Supabase session
    // (This would typically be done via Supabase client SDK)
  } catch (error) {
    console.error("Failed to exchange code for session:", error);
    throw error;
  }
}

/**
 * Checks if the current request is a marketplace signup flow
 *
 * Marketplace signups include a special token parameter in the callback URL
 * that must be validated and processed.
 *
 * @returns true if a marketplace token is present in URL parameters
 *
 * @example
 * if (isMarketplaceSignup()) {
 *   const token = getMarketplaceToken();
 *   // Process marketplace signup
 * }
 */
export function isMarketplaceSignup(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has(MARKETPLACE_TOKEN_PARAM);
}

/**
 * Extracts the marketplace purchase token from URL parameters
 *
 * The marketplace token is provided by Azure Marketplace during
 * the subscription flow and must be resolved to get subscription details.
 *
 * @returns The marketplace token if present, null otherwise
 *
 * @example
 * const token = getMarketplaceToken();
 * if (token) {
 *   const subscription = await resolveMarketplaceToken(token);
 * }
 */
export function getMarketplaceToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get(MARKETPLACE_TOKEN_PARAM);
}

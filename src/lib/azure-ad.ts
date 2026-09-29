/**
 * Microsoft Entra federation through Supabase Auth.
 *
 * The browser never exchanges a Microsoft code with Microsoft, decodes an ID
 * token, assigns an organization, or creates an application identity. Supabase
 * owns the OAuth/PKCE verifier and validates the provider response. SyncAI only
 * accepts the callback after Supabase has issued a session and its Auth API has
 * independently returned the same Azure-backed user.
 */
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { supabaseUrl } from "./supabase-config";

export interface AzureADConfig {
  redirectUri: string;
}

const browserOrigin =
  typeof window === "undefined" ? "" : window.location.origin;

export const azureAdConfig: AzureADConfig = {
  redirectUri: browserOrigin
    ? `${browserOrigin}/auth/callback/azure`
    : "",
};

export const AZURE_AD_REDIRECT_URI = azureAdConfig.redirectUri;
export const ENTERPRISE_SSO_ENABLED = true as const;
export const ENTERPRISE_SSO_UNAVAILABLE_MESSAGE =
  "Microsoft Entra sign-in is unavailable in this environment. Use an approved SyncAI account or contact your administrator.";

const MARKETPLACE_TOKEN_PARAM = "marketplace_token";
const PKCE_FLOW_ID_PARAM = "sb_flow_id";
const CALLBACK_PARAMS = [
  "code",
  PKCE_FLOW_ID_PARAM,
  "state",
  "error",
  "error_code",
  "error_description",
] as const;

export interface AzureADCallbackCode {
  code: string;
  flowId?: string;
}

export interface VerifiedAzureSession {
  provider: "azure";
  session: Session;
  user: User;
}

function readableAuthError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return ENTERPRISE_SSO_UNAVAILABLE_MESSAGE;
}

function isAzureBackedUser(user: User): boolean {
  const primary = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;
  return (
    primary === "azure" ||
    (Array.isArray(providers) && providers.includes("azure")) ||
    Boolean(user.identities?.some((identity) => identity.provider === "azure"))
  );
}

function assertSupabaseAzureAuthorizeUrl(value: string): string {
  if (!supabaseUrl) throw new Error(ENTERPRISE_SSO_UNAVAILABLE_MESSAGE);

  const authorizeUrl = new URL(value);
  const expectedOrigin = new URL(supabaseUrl).origin;
  if (
    authorizeUrl.origin !== expectedOrigin ||
    !authorizeUrl.pathname.endsWith("/auth/v1/authorize") ||
    authorizeUrl.searchParams.get("provider") !== "azure"
  ) {
    throw new Error("Supabase returned an invalid Microsoft sign-in URL.");
  }
  return authorizeUrl.toString();
}

/**
 * Ask Supabase Auth to create the Azure authorization request and PKCE
 * verifier. No caller-supplied state or hand-built Microsoft URL is accepted.
 */
export async function getAzureADAuthUrl(): Promise<string> {
  if (!AZURE_AD_REDIRECT_URI) {
    throw new Error(ENTERPRISE_SSO_UNAVAILABLE_MESSAGE);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: AZURE_AD_REDIRECT_URI,
      scopes: "openid profile email",
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    throw new Error(readableAuthError(error));
  }
  return assertSupabaseAzureAuthorizeUrl(data.url);
}

/** Start the supported Supabase-owned Microsoft OAuth/PKCE flow. */
export async function signInWithAzureAD(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error(ENTERPRISE_SSO_UNAVAILABLE_MESSAGE);
  }
  window.location.assign(await getAzureADAuthUrl());
}

/**
 * Parse only a PKCE callback. Supabase validates OAuth state; the stored PKCE
 * verifier and optional flow id bind this callback to the initiating browser.
 */
export async function handleAzureADCallback(): Promise<AzureADCallbackCode> {
  if (typeof window === "undefined") {
    throw new Error("Microsoft sign-in callback requires a browser.");
  }

  const params = new URLSearchParams(window.location.search);
  const providerError = params.get("error_description") || params.get("error");
  if (providerError) {
    throw new Error(`Microsoft sign-in was not completed: ${providerError}`);
  }

  if (
    window.location.hash.includes("access_token=") ||
    window.location.hash.includes("id_token=")
  ) {
    throw new Error("Implicit Microsoft tokens are not accepted by SyncAI.");
  }

  const code = params.get("code")?.trim() ?? "";
  const flowId = params.get(PKCE_FLOW_ID_PARAM)?.trim() || undefined;
  if (!code || code.length > 4096 || /\s/.test(code)) {
    throw new Error(
      "Invalid Microsoft sign-in callback: authorization code is missing or malformed.",
    );
  }

  return { code, flowId };
}

/**
 * Exchange a Supabase PKCE code, then verify the user against the Auth server
 * and require Azure to be one of that user's authenticated identities.
 */
export async function exchangeCodeForSession(
  code: string,
  flowId?: string,
): Promise<VerifiedAzureSession> {
  if (!code.trim()) throw new Error("Microsoft authorization code is required.");

  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error || !data.session || !data.user) {
    throw new Error(readableAuthError(error));
  }

  const { data: verified, error: verificationError } =
    await supabase.auth.getUser();
  if (
    verificationError ||
    !verified.user ||
    verified.user.id !== data.user.id ||
    !isAzureBackedUser(verified.user)
  ) {
    await supabase.auth.signOut();
    throw new Error(
      "Microsoft identity verification did not establish an Azure-backed SyncAI session.",
    );
  }

  return {
    provider: "azure",
    session: data.session,
    user: verified.user,
  };
}

/** Remove single-use callback material without dropping unrelated query data. */
export function clearAzureADCallbackUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
  url.hash = "";
  window.history.replaceState(
    window.history.state,
    document.title,
    url.toString(),
  );
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

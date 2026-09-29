import { createClient } from "@supabase/supabase-js";
import { supabasePublicKey, supabaseUrl } from "./supabase-config";

if (!supabaseUrl || !supabasePublicKey) {
  console.error(
    "Missing Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY). " +
      "The app will load but data features will not work.",
  );
}

/**
 * All requests carry a hard timeout so a hung network or dead backend can never
 * leave a page on an infinite spinner — callers get an AbortError and surface a
 * real error state instead.
 */
const REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabasePublicKey || "placeholder",
  {
    auth: {
      // OAuth and recovery links use an authorization code whose verifier is
      // retained by GoTrue in browser storage.  The dedicated Entra callback
      // performs its own exchange so it can verify the resulting provider and
      // user before routing into the application; other supported Auth links
      // (for example password recovery) continue to be detected automatically.
      flowType: "pkce",
      detectSessionInUrl: (url) => url.pathname !== "/auth/callback/azure",
    },
    global: { fetch: fetchWithTimeout },
  },
);

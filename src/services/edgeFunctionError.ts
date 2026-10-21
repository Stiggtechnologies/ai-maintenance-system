/**
 * supabase-js reports any non-2xx Edge Function response as the generic
 * "Edge Function returned a non-2xx status code". The governed functions
 * return their refusal reason as `{ error }` in the body; surface that so a
 * person sees why (for example "workspace invitation requires an AAL2 session").
 */
export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : "Edge Function request failed";
  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).clone === "function") {
    try {
      const body = (await (context as Response).clone().json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // Not JSON; keep the transport message.
    }
  }
  return fallback;
}

/**
 * Tenant-facing interpretation of the ai-agent-processor cost-guardrail
 * refusals (429 `org_daily_quota_exceeded`, 503 `quota_check_unavailable`
 * — supabase/functions/ai-agent-processor/index.ts).
 *
 * `supabase.functions.invoke` surfaces a non-2xx as a FunctionsHttpError
 * whose `context` is the raw Response; the useful body (which limit
 * tripped, when it resets) is only reachable by reading that Response.
 * Without this helper a quota refusal renders as "Edge Function returned a
 * non-2xx status code" — indistinguishable from an outage, and any "try
 * again shortly" guidance is wrong for a daily cap that resets at UTC
 * midnight.
 */

export interface QuotaRefusalInfo {
  kind: "quota_exceeded" | "quota_unavailable";
  message: string;
  resetsAt: string | null;
}

interface QuotaRefusalBody {
  error?: unknown;
  limit?: unknown;
  resets_at?: unknown;
}

function formatReset(resetsAt: string | null): string {
  if (!resetsAt) return "at midnight UTC";
  const when = new Date(resetsAt);
  if (Number.isNaN(when.getTime())) return "at midnight UTC";
  // Local wall-clock time; the cap window itself is the UTC day.
  return `at ${when.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** Map a parsed ai-agent-processor error body to user-facing copy, or null. */
export function quotaRefusalFromBody(body: unknown): QuotaRefusalInfo | null {
  if (!body || typeof body !== "object") return null;
  const parsed = body as QuotaRefusalBody;
  if (parsed.error === "quota_check_unavailable") {
    return {
      kind: "quota_unavailable",
      message:
        "The AI budget check is temporarily unavailable, so this request was " +
        "not run (nothing was spent). Your operating data and actions are " +
        "unaffected — try again in a few minutes.",
      resetsAt: null,
    };
  }
  if (parsed.error !== "org_daily_quota_exceeded") return null;
  const resetsAt =
    typeof parsed.resets_at === "string" ? parsed.resets_at : null;
  const limitLabel =
    parsed.limit === "max_tokens_per_day"
      ? "daily AI token allowance"
      : "daily AI request allowance";
  return {
    kind: "quota_exceeded",
    message:
      `Your organization's ${limitLabel} is used up for today. ` +
      `It resets ${formatReset(resetsAt)}. ` +
      "If this cap is too low for your team's real workload, ask your " +
      "SyncAI contact to raise your organization's limit.",
    resetsAt,
  };
}

/**
 * Read a quota refusal out of a `supabase.functions.invoke` error.
 * Duck-typed on `error.context` being a Response (FunctionsHttpError) so
 * this file needs no supabase-js import. Returns null for anything that is
 * not a quota refusal — callers keep their existing error handling.
 */
export async function describeQuotaRefusal(
  error: unknown,
): Promise<QuotaRefusalInfo | null> {
  if (!error || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    return quotaRefusalFromBody(body);
  } catch {
    return null;
  }
}

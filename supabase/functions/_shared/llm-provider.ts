/**
 * Resilient LLM provider chain, shared by every edge function that calls a model.
 *
 * WHY THIS EXISTS.
 *
 * Two outages taught two lessons in one day. The copilot was one-shot: a single
 * OpenAI non-200 rendered "copilot unavailable" to the user. And the enrichment
 * loop pointed at the Stigg gateway, which stopped resolving — and then failed
 * SILENTLY for a month, because a background loop has no user to show a banner
 * to. Zero enrichments in 30 days and nothing surfaced it.
 *
 * So: a provider CHAIN with retry, classified errors, and every failure
 * recorded somewhere a person can see.
 *
 * ERROR CLASSIFICATION, BECAUSE RETRYING THE WRONG THING WASTES THE TIMEOUT.
 *
 *   retryable — network failure, 408, 429, 5xx. Try again on the SAME provider
 *               with backoff; transient by nature.
 *   fatal     — 400/401/403/404. Config or auth. Retrying cannot help; fail
 *               over to the next provider immediately.
 *
 * DELIBERATELY DENO-FREE. No Deno globals, fetch and sleep injected — so the
 * exact file that deploys to the edge runtime is unit-tested by vitest. The
 * previous edge-function change shipped untypechecked because Deno is not
 * installed locally; this one cannot.
 */

export interface LlmProvider {
  /** Label for health events, e.g. "stigg-gateway" or "openai-direct". */
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Model to request from THIS provider — a gateway alias like "stigg/fast"
   *  means nothing to OpenAI, so each provider names its own. */
  model: string;
}

export interface LlmCallOptions {
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  /** Attempts per provider on retryable errors. */
  attemptsPerProvider?: number;
  /** Base backoff; doubles per retry. */
  backoffMs?: number;
}

export interface ProviderEvent {
  provider: string;
  outcome: "ok" | "retried" | "failed_over" | "exhausted";
  status: number | null;
  detail: string;
}

export interface LlmResult {
  ok: boolean;
  content: string;
  usage: Record<string, number>;
  /** Which provider ultimately answered. */
  provider: string | null;
  /**
   * The model that ACTUALLY produced the content — not the one requested.
   * When a chain fails over, the two differ, and a governance record that
   * stores the requested model is simply false. Null when nothing answered.
   */
  model: string | null;
  /** The trail, for the health log. Never empty. */
  events: ProviderEvent[];
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

function classify(status: number): "retryable" | "fatal" {
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  return "fatal";
}

/**
 * Build the chain from environment values. The gateway leads when configured;
 * direct OpenAI is the fallback whenever an OpenAI key exists. A chain of one
 * is legal and simply has no failover.
 */
export function buildProviderChain(env: {
  gatewayUrl?: string;
  gatewayKey?: string;
  gatewayModel?: string;
  openaiKey?: string;
  openaiModel?: string;
  /**
   * Last-resort OpenAI model, tried only after `openaiModel` fails. Exists so
   * a frontier model can be the default WITHOUT betting the whole chain on
   * this key having access to it: an unavailable model returns 404, which is
   * classified fatal, so the chain drops to this one instantly instead of
   * going dark. Skipped when it equals openaiModel.
   */
  openaiSafetyModel?: string;
}): LlmProvider[] {
  const chain: LlmProvider[] = [];
  if (env.gatewayUrl && env.gatewayKey) {
    chain.push({
      name: "stigg-gateway",
      baseUrl: env.gatewayUrl,
      apiKey: env.gatewayKey,
      model: env.gatewayModel ?? "stigg/fast",
    });
  }
  if (env.openaiKey) {
    const primary = env.openaiModel ?? "gpt-4o-mini";
    chain.push({
      name: "openai-direct",
      baseUrl: "https://api.openai.com",
      apiKey: env.openaiKey,
      model: primary,
    });
    if (env.openaiSafetyModel && env.openaiSafetyModel !== primary) {
      chain.push({
        name: "openai-safety",
        baseUrl: "https://api.openai.com",
        apiKey: env.openaiKey,
        model: env.openaiSafetyModel,
      });
    }
  }
  return chain;
}

export async function callWithResilience(
  fetchLike: FetchLike,
  providers: LlmProvider[],
  opts: LlmCallOptions,
  sleep: SleepLike = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<LlmResult> {
  const events: ProviderEvent[] = [];
  const attempts = Math.max(1, opts.attemptsPerProvider ?? 2);
  const backoff = opts.backoffMs ?? 800;

  if (providers.length === 0) {
    return {
      ok: false,
      content: "",
      usage: {},
      provider: null,
      model: null,
      events: [
        {
          provider: "(none)",
          outcome: "exhausted",
          status: null,
          detail:
            "No provider configured at all. This is a configuration gap, not an outage.",
        },
      ],
    };
  }

  for (let p = 0; p < providers.length; p++) {
    const provider = providers[p];
    const url = new URL("/v1/chat/completions", provider.baseUrl).toString();
    const hasNext = p < providers.length - 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let status: number | null = null;
      let detail = "";
      let fatal = false;

      try {
        const payload: Record<string, unknown> = {
          model: provider.model,
          temperature: opts.temperature ?? 0.3,
          max_completion_tokens: opts.maxTokens ?? 1200,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userContent },
          ],
        };
        if (opts.jsonMode) payload.response_format = { type: "json_object" };

        const resp = await fetchLike(url, {
          method: "POST",
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify(payload),
        });
        status = resp.status;

        if (resp.ok) {
          const data = await resp.json();
          events.push({
            provider: provider.name,
            outcome: "ok",
            status,
            detail:
              attempt > 1 ? `succeeded on attempt ${attempt}` : "first attempt",
          });
          return {
            ok: true,
            content: data.choices?.[0]?.message?.content ?? "",
            usage: data.usage ?? {},
            provider: provider.name,
            // Prefer what the API says it used over what we asked for; a
            // gateway alias resolves to a concrete model server-side.
            model: data.model ?? provider.model,
            events,
          };
        }

        fatal = classify(resp.status) === "fatal";
        detail = fatal
          ? `fatal status ${resp.status} — configuration or auth, not transient; failing over without retry`
          : `retryable status ${resp.status}`;
      } catch (e) {
        // Network-level failure (DNS, timeout, reset) — exactly what took the
        // gateway path down for a month. Retryable within budget.
        detail = `network failure: ${e instanceof Error ? e.name : "unknown"}`;
      }

      const lastAttempt = fatal || attempt === attempts;
      events.push({
        provider: provider.name,
        outcome: lastAttempt ? (hasNext ? "failed_over" : "exhausted") : "retried",
        status,
        detail,
      });
      if (lastAttempt) break;
      await sleep(backoff * attempt);
    }
  }

  return { ok: false, content: "", usage: {}, provider: null, model: null, events };
}

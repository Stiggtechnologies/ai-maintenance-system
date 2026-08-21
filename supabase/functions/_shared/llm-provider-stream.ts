import type { LlmProvider, ProviderEvent } from "./llm-provider.ts";

export interface LlmStreamOptions {
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
  timeoutMs?: number;
  attemptsPerProvider?: number;
  backoffMs?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void | Promise<void>;
}

export interface LlmStreamResult {
  ok: boolean;
  content: string;
  usage: Record<string, number>;
  provider: string | null;
  model: string | null;
  events: ProviderEvent[];
  firstTokenAtMs: number | null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

function classify(status: number): "retryable" | "fatal" {
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  return "fatal";
}

function combineSignals(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function unsupportedStreamParam(body: string): string | null {
  try {
    const error = JSON.parse(body)?.error;
    const param = typeof error?.param === "string" ? error.param : "";
    const code = String(error?.code ?? "");
    if (
      ["stream_options", "max_completion_tokens"].includes(param) &&
      ["unsupported_value", "unknown_parameter", "unsupported_parameter"].includes(code)
    ) {
      return param;
    }
  } catch {
    // Non-JSON provider body stays a normal fatal/retryable provider error.
  }
  return null;
}

function normalizeUsage(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const usage: Record<string, number> = {};
  for (const key of [
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "input_tokens",
    "output_tokens",
  ]) {
    const n = Number(row[key]);
    if (Number.isFinite(n)) usage[key] = n;
  }
  if (usage.prompt_tokens === undefined && usage.input_tokens !== undefined) {
    usage.prompt_tokens = usage.input_tokens;
  }
  if (
    usage.completion_tokens === undefined &&
    usage.output_tokens !== undefined
  ) {
    usage.completion_tokens = usage.output_tokens;
  }
  return usage;
}

async function consumeChatCompletionStream(
  response: Response,
  onDelta: LlmStreamOptions["onDelta"],
  startedAt: number,
): Promise<{
  content: string;
  usage: Record<string, number>;
  model: string | null;
  firstTokenAtMs: number | null;
}> {
  if (!response.body) throw new Error("stream_body_missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: Record<string, number> = {};
  let model: string | null = null;
  let firstTokenAtMs: number | null = null;

  const consumeLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (typeof payload.model === "string") model = payload.model;
    if (payload.usage) usage = normalizeUsage(payload.usage);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0];
    if (!first || typeof first !== "object") return;
    const delta = (first as { delta?: unknown }).delta;
    if (!delta || typeof delta !== "object") return;
    const text = (delta as { content?: unknown }).content;
    if (typeof text !== "string" || text.length === 0) return;
    if (firstTokenAtMs === null) firstTokenAtMs = Date.now() - startedAt;
    content += text;
    await onDelta(text);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await consumeLine(line);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await consumeLine(buffer);

  return { content, usage, model, firstTokenAtMs };
}

/**
 * Streaming sibling of callWithResilience(). It preserves the same provider
 * ordering and error classification while refusing unsafe mid-stream failover:
 * once a provider has emitted user-visible text, another provider cannot be
 * spliced behind it without risking duplicated or contradictory content.
 */
export async function callWithResilienceStream(
  fetchLike: FetchLike,
  providers: LlmProvider[],
  opts: LlmStreamOptions,
  sleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<LlmStreamResult> {
  const events: ProviderEvent[] = [];
  const attempts = Math.max(1, opts.attemptsPerProvider ?? 2);
  const backoff = opts.backoffMs ?? 800;
  const startedAt = Date.now();

  if (providers.length === 0) {
    return {
      ok: false,
      content: "",
      usage: {},
      provider: null,
      model: null,
      firstTokenAtMs: null,
      events: [
        {
          provider: "(none)",
          outcome: "exhausted",
          status: null,
          detail: "No streaming provider configured.",
        },
      ],
    };
  }

  for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
    const provider = providers[providerIndex];
    const hasNext = providerIndex < providers.length - 1;
    const dropped = new Set<string>();

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let status: number | null = null;
      let fatal = false;
      let renegotiated = false;
      let detail = "";
      try {
        const payload: Record<string, unknown> = {
          model: provider.model,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userContent },
          ],
          stream: true,
        };
        if (!dropped.has("max_completion_tokens")) {
          payload.max_completion_tokens = opts.maxTokens ?? 1200;
        }
        if (!dropped.has("stream_options")) {
          payload.stream_options = { include_usage: true };
        }

        const response = await fetchLike(
          new URL("/v1/chat/completions", provider.baseUrl).toString(),
          {
            method: "POST",
            signal: combineSignals(opts.timeoutMs ?? 90_000, opts.signal),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
            },
            body: JSON.stringify(payload),
          },
        );
        status = response.status;

        if (response.ok) {
          const consumed = await consumeChatCompletionStream(
            response,
            opts.onDelta,
            startedAt,
          );
          if (!consumed.content.trim()) throw new Error("empty_stream_response");
          events.push({
            provider: provider.name,
            outcome: "ok",
            status,
            detail: attempt > 1 ? `stream succeeded on attempt ${attempt}` : "streamed on first attempt",
          });
          return {
            ok: true,
            content: consumed.content,
            usage: consumed.usage,
            provider: provider.name,
            model: consumed.model ?? provider.model,
            events,
            firstTokenAtMs: consumed.firstTokenAtMs,
          };
        }

        const body = await response.text().catch(() => "");
        const reason = body.slice(0, 200).replace(/\s+/g, " ").trim();
        const bad = classify(response.status) === "fatal"
          ? unsupportedStreamParam(body)
          : null;
        if (bad && !dropped.has(bad)) {
          dropped.add(bad);
          renegotiated = true;
          detail = `provider rejected optional parameter "${bad}"; retrying without it — ${reason}`;
        } else {
          fatal = classify(response.status) === "fatal";
          detail = fatal
            ? `fatal status ${response.status}; failing over — ${reason}`
            : `retryable status ${response.status} — ${reason}`;
        }
      } catch (error) {
        if (opts.signal?.aborted) throw error;
        detail = `stream failure before completion: ${error instanceof Error ? error.name : "unknown"}`;
      }

      if (renegotiated) {
        events.push({ provider: provider.name, outcome: "retried", status, detail });
        attempt -= 1;
        continue;
      }
      const lastAttempt = fatal || attempt === attempts;
      events.push({
        provider: provider.name,
        outcome: lastAttempt
          ? hasNext
            ? "failed_over"
            : "exhausted"
          : "retried",
        status,
        detail,
      });
      if (lastAttempt) break;
      await sleep(backoff * attempt);
    }
  }

  return {
    ok: false,
    content: "",
    usage: {},
    provider: null,
    model: null,
    events,
    firstTokenAtMs: null,
  };
}

import { describe, expect, it } from "vitest";
import type { LlmProvider } from "../../../supabase/functions/_shared/llm-provider";
import { callWithResilienceStream } from "../../../supabase/functions/_shared/llm-provider-stream";

const openai: LlmProvider = {
  name: "openai-direct",
  baseUrl: "https://api.openai.com",
  apiKey: "sk-test",
  model: "gpt-test",
};
const gateway: LlmProvider = {
  name: "stigg-gateway",
  baseUrl: "https://gateway.example",
  apiKey: "vk-test",
  model: "stigg/agent",
};

function sse(chunks: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const frames = chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .concat("data: [DONE]\n\n");
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= frames.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(frames[index++]));
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const chunks = [
  { model: "gpt-real", choices: [{ delta: { content: "Hello " } }] },
  { model: "gpt-real", choices: [{ delta: { content: "world" } }] },
  {
    model: "gpt-real",
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  },
];

describe("callWithResilienceStream", () => {
  it("forwards provider deltas before completion and returns the exact accumulated answer", async () => {
    const deltas: string[] = [];
    const result = await callWithResilienceStream(
      async () => sse(chunks),
      [openai],
      {
        systemPrompt: "s",
        userContent: "u",
        onDelta: (text) => {
          deltas.push(text);
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(deltas).toEqual(["Hello ", "world"]);
    expect(result.content).toBe("Hello world");
    expect(result.model).toBe("gpt-real");
    expect(result.usage.total_tokens).toBe(12);
    expect(result.firstTokenAtMs).not.toBeNull();
  });

  it("fails over before any user-visible text on a fatal provider error", async () => {
    const hits: string[] = [];
    const result = await callWithResilienceStream(
      async (url) => {
        hits.push(new URL(url).hostname);
        if (url.includes("gateway.example")) {
          return new Response(JSON.stringify({ error: { message: "bad key" } }), {
            status: 401,
          });
        }
        return sse(chunks);
      },
      [gateway, openai],
      {
        systemPrompt: "s",
        userContent: "u",
        attemptsPerProvider: 1,
        onDelta: () => undefined,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openai-direct");
    expect(hits).toEqual(["gateway.example", "api.openai.com"]);
    expect(result.events[0].outcome).toBe("failed_over");
  });

  it("refuses provider failover after any visible delta", async () => {
    const encoder = new TextEncoder();
    const hits: string[] = [];
    const deltas: string[] = [];
    const result = await callWithResilienceStream(
      async (url) => {
        hits.push(new URL(url).hostname);
        if (!url.includes("gateway.example")) return sse(chunks);
        let pulled = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!pulled) {
                pulled = true;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`,
                  ),
                );
                return;
              }
              controller.error(new Error("socket reset"));
            },
          }),
          { status: 200 },
        );
      },
      [gateway, openai],
      {
        systemPrompt: "s",
        userContent: "u",
        attemptsPerProvider: 1,
        onDelta: (text) => {
          deltas.push(text);
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.content).toBe("partial");
    expect(deltas).toEqual(["partial"]);
    expect(hits).toEqual(["gateway.example"]);
    expect(result.events.at(-1)?.detail).toMatch(/failover refused/i);
  });

  it("negotiates an unsupported stream_options parameter on the same provider", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const result = await callWithResilienceStream(
      async (_url, init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        bodies.push(body);
        if (body.stream_options) {
          return new Response(
            JSON.stringify({
              error: {
                param: "stream_options",
                code: "unsupported_parameter",
                message: "stream_options unsupported",
              },
            }),
            { status: 400 },
          );
        }
        return sse(chunks);
      },
      [openai],
      {
        systemPrompt: "s",
        userContent: "u",
        attemptsPerProvider: 1,
        onDelta: () => undefined,
      },
    );

    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("stream_options");
    expect(bodies[1]).not.toHaveProperty("stream_options");
  });

  it("does not claim success for an empty stream", async () => {
    const result = await callWithResilienceStream(
      async () => sse([{ choices: [], usage: {} }]),
      [openai],
      {
        systemPrompt: "s",
        userContent: "u",
        attemptsPerProvider: 1,
        onDelta: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
  });
});

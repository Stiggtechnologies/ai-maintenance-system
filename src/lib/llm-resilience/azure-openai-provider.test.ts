import { describe, expect, it, vi } from "vitest";
import {
  adaptAzureOpenAiFetch,
  buildAzureOpenAiProvider,
  resolveAzureOpenAiEndpoint,
} from "../../../supabase/functions/_shared/azure-openai-provider";
import { callWithResilience } from "../../../supabase/functions/_shared/llm-provider";

const options = {
  systemPrompt: "system",
  userContent: "user",
  attemptsPerProvider: 1,
};

const config = {
  endpoint: "https://syncai.openai.azure.com",
  accessToken: "managed-identity-token",
  deployment: "syncai-reasoning",
  apiVersion: "2024-10-21",
};

describe("Azure OpenAI provider adapter", () => {
  it("accepts only Microsoft-owned HTTPS AI data-plane origins", () => {
    expect(resolveAzureOpenAiEndpoint(`${config.endpoint}/`)).toBe(
      config.endpoint,
    );
    expect(
      resolveAzureOpenAiEndpoint(
        "https://syncai.openai.azure.com.attacker.example",
      ),
    ).toBeUndefined();
    expect(
      resolveAzureOpenAiEndpoint("http://syncai.openai.azure.com"),
    ).toBeUndefined();
    expect(
      resolveAzureOpenAiEndpoint("https://user@syncai.openai.azure.com"),
    ).toBeUndefined();
    expect(
      resolveAzureOpenAiEndpoint(
        "https://syncai.openai.azure.com/unexpected/path",
      ),
    ).toBeUndefined();
  });

  it("binds the deployment in the Azure URL and removes the model body field", async () => {
    const provider = buildAzureOpenAiProvider(config);
    expect(provider).not.toBeNull();

    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> = {};
    const adapted = adaptAzureOpenAiFetch(async (url, init) => {
      requestUrl = url;
      requestHeaders = new Headers(init.headers);
      requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ready" } }],
          model: "gpt-4o-mini-2024-07-18",
          usage: {},
        }),
        { status: 200 },
      );
    }, config);

    const result = await callWithResilience(adapted, [provider!], options);

    expect(result.provider).toBe("azure-openai");
    expect(requestUrl).toBe(
      "https://syncai.openai.azure.com/openai/deployments/syncai-reasoning/chat/completions?api-version=2024-10-21",
    );
    expect(requestHeaders?.get("authorization")).toBe(
      "Bearer managed-identity-token",
    );
    expect(requestBody).not.toHaveProperty("model");
  });

  it("passes non-Azure fallback requests through untouched", async () => {
    const fetchLike = vi.fn(async () => new Response("ok", { status: 200 }));
    const adapted = adaptAzureOpenAiFetch(fetchLike, config);
    const init = { method: "POST" };
    await adapted("https://api.openai.com/v1/chat/completions", init);
    expect(fetchLike).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      init,
    );
  });

  it("refuses an Azure request carrying the wrong bearer token", async () => {
    const adapted = adaptAzureOpenAiFetch(vi.fn(), config);
    await expect(
      adapted(`${config.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer wrong-token" },
        body: JSON.stringify({ model: config.deployment, messages: [] }),
      }),
    ).rejects.toThrow("azure_openai_authorization_mismatch");
  });
});

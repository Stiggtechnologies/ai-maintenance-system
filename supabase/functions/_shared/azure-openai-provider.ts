/**
 * Azure OpenAI adapter for the already-qualified generic resilience engine.
 *
 * Azure binds a deployment in the request URL and rejects the generic OpenAI
 * `model` field. Keeping that protocol translation here lets Azure workloads
 * reuse `callWithResilience` without changing its reliability-qualified core.
 */

import type { LlmProvider } from "./llm-provider.ts";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AzureOpenAiProviderConfig {
  endpoint: string;
  accessToken: string;
  deployment: string;
  apiVersion?: string;
}

/**
 * Accept only Microsoft-owned Azure AI data-plane hosts before attaching a
 * managed-identity bearer token. This is an SSRF/token-exfiltration boundary.
 */
export function resolveAzureOpenAiEndpoint(value: string): string | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const microsoftHost = [
      ".openai.azure.com",
      ".services.ai.azure.com",
      ".cognitiveservices.azure.com",
    ].some((suffix) => host.endsWith(suffix));
    if (
      url.protocol !== "https:" ||
      !microsoftHost ||
      url.username ||
      url.password ||
      url.port ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function buildAzureOpenAiProvider(
  config: AzureOpenAiProviderConfig,
): LlmProvider | null {
  const endpoint = resolveAzureOpenAiEndpoint(config.endpoint);
  if (!endpoint || !config.accessToken || !config.deployment) return null;
  return {
    name: "azure-openai",
    baseUrl: endpoint,
    apiKey: config.accessToken,
    model: config.deployment,
  };
}

/**
 * Translate only the exact generic request generated for the Azure provider.
 * Requests for later fallback providers pass through untouched.
 */
export function adaptAzureOpenAiFetch(
  fetchLike: FetchLike,
  config: AzureOpenAiProviderConfig,
): FetchLike {
  const endpoint = resolveAzureOpenAiEndpoint(config.endpoint);
  if (!endpoint || !config.accessToken || !config.deployment) {
    throw new Error("azure_openai_not_configured");
  }

  const genericUrl = new URL("/v1/chat/completions", endpoint).toString();
  const target = new URL(
    `/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions`,
    endpoint,
  );
  target.searchParams.set("api-version", config.apiVersion ?? "2024-10-21");

  return async (url, init) => {
    if (url !== genericUrl) return fetchLike(url, init);

    const headers = new Headers(init.headers);
    if (headers.get("authorization") !== `Bearer ${config.accessToken}`) {
      throw new Error("azure_openai_authorization_mismatch");
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    } catch {
      throw new Error("azure_openai_invalid_request_body");
    }
    delete payload.model;

    return fetchLike(target.toString(), {
      ...init,
      headers,
      body: JSON.stringify(payload),
    });
  };
}

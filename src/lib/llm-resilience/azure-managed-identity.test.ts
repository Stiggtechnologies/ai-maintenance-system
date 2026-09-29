import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAzureManagedIdentityAccessToken,
  resetAzureManagedIdentityTokenCache,
} from "../../../supabase/functions/_shared/azure-managed-identity";

beforeEach(resetAzureManagedIdentityTokenCache);

describe("Azure Container Apps managed identity", () => {
  it("requests a Cognitive Services token with the platform header", async () => {
    let requestedUrl = "";
    let requestedHeaders: Headers | undefined;
    const token = await getAzureManagedIdentityAccessToken(
      async (url, init) => {
        requestedUrl = url;
        requestedHeaders = new Headers(init.headers);
        return new Response(
          JSON.stringify({
            access_token: "short-lived-token",
            expires_on: "2000000000",
          }),
          { status: 200 },
        );
      },
      {
        identityEndpoint: "http://127.0.0.1:42356/msi/token",
        identityHeader: "rotating-platform-header",
        clientId: "11111111-1111-4111-8111-111111111111",
        nowMs: 1_900_000_000_000,
      },
    );

    const parsed = new URL(requestedUrl);
    expect(token).toBe("short-lived-token");
    expect(parsed.searchParams.get("api-version")).toBe("2019-08-01");
    expect(parsed.searchParams.get("resource")).toBe(
      "https://cognitiveservices.azure.com",
    );
    expect(parsed.searchParams.get("client_id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(requestedHeaders?.get("x-identity-header")).toBe(
      "rotating-platform-header",
    );
  });

  it("refuses to forward the identity header to a non-local endpoint", async () => {
    const fetchLike = vi.fn();
    await expect(
      getAzureManagedIdentityAccessToken(fetchLike, {
        identityEndpoint: "https://attacker.example/token",
        identityHeader: "must-not-leak",
        clientId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow("azure_managed_identity_not_configured");
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it("caches a usable token without caching past its safety window", async () => {
    const fetchLike = vi.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "cached-token", expires_on: 2_000 }),
          { status: 200 },
        ),
      ),
    );
    const input = {
      identityEndpoint: "http://localhost:42356/msi/token",
      identityHeader: "platform-header",
      clientId: "11111111-1111-4111-8111-111111111111",
      nowMs: 1_000_000,
    };
    expect(await getAzureManagedIdentityAccessToken(fetchLike, input)).toBe(
      "cached-token",
    );
    expect(await getAzureManagedIdentityAccessToken(fetchLike, input)).toBe(
      "cached-token",
    );
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });

  it("never returns an empty or failed token response as configured", async () => {
    await expect(
      getAzureManagedIdentityAccessToken(
        async () => new Response("{}", { status: 500 }),
        {
          identityEndpoint: "http://127.0.0.1/token",
          identityHeader: "platform-header",
          clientId: "11111111-1111-4111-8111-111111111111",
        },
      ),
    ).rejects.toThrow("azure_managed_identity_token_failed_500");
  });
});

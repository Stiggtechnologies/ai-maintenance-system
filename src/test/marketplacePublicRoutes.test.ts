import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyMarketplaceWebhook } from "../../api/marketplace/webhook";

const read = (path: string) => readFileSync(path, "utf8");
const productionEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  VITE_SUPABASE_URL: undefined,
  VERCEL_ENV: "production",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Marketplace app-domain routes", () => {
  it("guards manifest values and blocked evidence gates without acting as a runtime witness", () => {
    const manifest = JSON.parse(
      read("marketplace/partner-center-manifest.json"),
    ) as {
      claims: Record<string, boolean>;
      overallStatus: string;
      previewAndCertification: Record<string, unknown>;
      blockingActions: Array<{
        dependsOn?: string[];
        id: string;
        status: string;
      }>;
      technicalConfiguration: {
        deploymentEvidence: Record<string, unknown>;
        landingPage: Record<string, unknown>;
        connectionWebhook: Record<string, unknown>;
        status: string;
      };
    };
    expect(manifest.overallStatus).toBe("blocked");
    expect(manifest.previewAndCertification).toMatchObject({
      authenticatedLifecycleWitness: "blocked",
      acceptedMeteringWitness: "blocked",
      partnerCenterCertification: "blocked",
      status: "blocked",
    });
    expect(manifest.technicalConfiguration.status).toBe("blocked");
    expect(manifest.technicalConfiguration.deploymentEvidence).toMatchObject({
      mergeCommit: "a0c4186efd1d449fbd80d67d5150d63f18684875",
      statusCommit: "a0c4186efd1d449fbd80d67d5150d63f18684875",
      statusContexts: expect.arrayContaining([
        expect.objectContaining({
          context: "Vercel – ai-maintenance-system",
          deploymentId: "2fyc2u4isGgjpBwRCWueNvPf9V54",
        }),
        expect.objectContaining({
          context: "Vercel – repo",
          deploymentId: "3Re57JFiNpHEe77ac7mZMajSYKKu",
        }),
        expect.objectContaining({
          context: "Vercel – syncai-github",
          deploymentId: "DqYhNWUvqzpMb9aE9pzY1EdWzpr3",
        }),
      ]),
      customDomainAliasToMergeCommit: "blocked",
    });
    expect(manifest.technicalConfiguration.landingPage).toMatchObject({
      controlledReplacement: "https://app.syncai.ca/marketplace/activate",
      implementationMergeCommit: "a0c4186efd1d449fbd80d67d5150d63f18684875",
      replacementProbe: { httpStatus: 200 },
    });
    expect(manifest.technicalConfiguration.connectionWebhook).toMatchObject({
      controlledReplacement: "https://app.syncai.ca/api/marketplace/webhook",
      implementationMergeCommit: "a0c4186efd1d449fbd80d67d5150d63f18684875",
      unconfirmedHistoricalDirectCandidate: {
        permittedAsFallback: false,
        status: "blocked",
      },
      replacementProbe: {
        get: { httpStatus: 405, allow: "POST" },
        unsignedJsonPost: {
          httpStatus: 401,
          error: "marketplace_webhook_token_required",
        },
      },
      productionProjectConfirmation: {
        requiredBeforePartnerCenterUpdate: true,
        authoritativeEvidence: "blocked",
        status: "blocked",
      },
      authenticatedUpstreamLifecycleWitness: "blocked",
      status: "blocked",
    });
    expect(manifest.blockingActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "PC-000", status: "blocked" }),
        expect.objectContaining({
          id: "PC-001",
          dependsOn: ["PC-000"],
          status: "blocked",
        }),
      ]),
    );
    expect(manifest.claims).toMatchObject({
      published: false,
      microsoftCertified: false,
      transactableBuyerProven: false,
    });
  });

  it("serves the activation alias through the existing signup flow", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(
      /path="\/marketplace\/activate"[\s\S]{0,100}element=\{<MarketplaceSignup\s*\/>\}/,
    );
  });

  it("declares the webhook as a Vercel function ahead of the SPA fallback", () => {
    const config = JSON.parse(read("vercel.json")) as {
      functions: Record<string, unknown>;
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(config.functions).toHaveProperty("api/marketplace/webhook.ts");
    expect(config.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });

  it("forwards the exact body, bearer token and Microsoft correlation headers", async () => {
    const raw = '{\n  "action": "Suspend", "quantity": 1\n}\n';
    const fetchImpl = vi.fn(async () =>
      Response.json({ accepted: true }, { status: 202 }),
    );
    const request = new Request(
      "https://app.syncai.ca/api/marketplace/webhook",
      {
        method: "POST",
        headers: {
          authorization: "Bearer signed-microsoft-token",
          "content-type": "application/json; charset=utf-8",
          "x-ms-requestid": "request-123",
          "x-ms-correlationid": "correlation-456",
        },
        body: raw,
      },
    );

    const response = await proxyMarketplaceWebhook(request, {
      env: productionEnv,
      fetchImpl,
    });

    expect(response.status).toBe(202);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(target.toString()).toBe(
      "https://project.supabase.co/functions/v1/marketplace-webhook",
    );
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer signed-microsoft-token",
    );
    expect(new Headers(init.headers).get("x-ms-requestid")).toBe("request-123");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(raw);
  });

  it.each(["GET", "PUT", "DELETE"])(
    "refuses %s without contacting the lifecycle function",
    async (method) => {
      const fetchImpl = vi.fn();
      const response = await proxyMarketplaceWebhook(
        new Request("https://app.syncai.ca/api/marketplace/webhook", {
          method,
        }),
        { env: productionEnv, fetchImpl },
      );
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({
        error: "method_not_allowed",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("fails closed before proxying unsigned, oversized or non-JSON requests", async () => {
    const fetchImpl = vi.fn();
    const requests = [
      new Request("https://app.syncai.ca/api/marketplace/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      new Request("https://app.syncai.ca/api/marketplace/webhook", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "text/plain",
        },
        body: "{}",
      }),
      new Request("https://app.syncai.ca/api/marketplace/webhook", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
          "content-length": String(64 * 1024 + 1),
        },
        body: "{}",
      }),
    ];

    const responses = await Promise.all(
      requests.map((request) =>
        proxyMarketplaceWebhook(request, { env: productionEnv, fetchImpl }),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([401, 415, 413]);
    expect(responses[0]!.headers.get("cache-control")).toBe("no-store");
    expect(responses[0]!.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(responses[0]!.json()).resolves.toEqual({
      error: "marketplace_webhook_token_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not follow or expose an upstream redirect", async () => {
    const response = await proxyMarketplaceWebhook(
      new Request("https://app.syncai.ca/api/marketplace/webhook", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      {
        env: productionEnv,
        fetchImpl: vi.fn(
          async () =>
            new Response(null, {
              status: 307,
              headers: { location: "https://untrusted.example/collect" },
            }),
        ),
      },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });

  it("contains no browser storage, publisher secret or token logging path", () => {
    const proxy = read("api/marketplace/webhook.ts");
    expect(proxy).not.toMatch(/localStorage|sessionStorage/);
    expect(proxy).not.toMatch(/CLIENT_SECRET|SERVICE_ROLE|PUBLISHABLE_KEY/);
    expect(proxy).not.toMatch(/console\.(?:log|info|warn|error)/);
  });
});

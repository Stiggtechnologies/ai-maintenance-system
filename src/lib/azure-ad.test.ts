// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("./supabase", () => ({ supabase: { auth } }));
vi.mock("./supabase-config", () => ({
  supabaseUrl: "https://project.supabase.co",
}));

import {
  ENTERPRISE_SSO_ENABLED,
  clearAzureADCallbackUrl,
  exchangeCodeForSession,
  getAzureADAuthUrl,
  handleAzureADCallback,
} from "./azure-ad";

const azureUser = {
  id: "user-1",
  app_metadata: { provider: "azure", providers: ["azure"] },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-09-29T00:00:00Z",
};
const session = {
  access_token: "verified-supabase-token",
  refresh_token: "refresh",
  expires_in: 3600,
  token_type: "bearer",
  user: azureUser,
};

describe("Microsoft Entra federation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("asks Supabase to create an Azure PKCE authorization request", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "azure",
        url: "https://project.supabase.co/auth/v1/authorize?provider=azure&flow_type=pkce",
      },
      error: null,
    });

    await expect(getAzureADAuthUrl()).resolves.toContain("provider=azure");
    expect(ENTERPRISE_SSO_ENABLED).toBe(true);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "azure",
      options: {
        redirectTo: "http://localhost:3000/auth/callback/azure",
        scopes: "openid profile email",
        skipBrowserRedirect: true,
      },
    });
  });

  it("rejects an authorization URL outside the configured Supabase origin", async () => {
    auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "azure",
        url: "https://attacker.example/auth/v1/authorize?provider=azure",
      },
      error: null,
    });

    await expect(getAzureADAuthUrl()).rejects.toThrow(
      "invalid Microsoft sign-in URL",
    );
  });

  it("accepts only a bounded PKCE code and carries the SDK flow selector", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback/azure?code=code-123&sb_flow_id=flow-456",
    );
    await expect(handleAzureADCallback()).resolves.toEqual({
      code: "code-123",
      flowId: "flow-456",
    });

    window.history.replaceState({}, "", "/auth/callback/azure?code=bad%20code");
    await expect(handleAzureADCallback()).rejects.toThrow("malformed");
  });

  it("surfaces provider refusal and rejects implicit token callbacks", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback/azure?error=access_denied&error_description=Consent%20denied",
    );
    await expect(handleAzureADCallback()).rejects.toThrow("Consent denied");

    window.history.replaceState(
      {},
      "",
      "/auth/callback/azure#access_token=untrusted",
    );
    await expect(handleAzureADCallback()).rejects.toThrow(
      "Implicit Microsoft tokens",
    );
  });

  it("establishes a session only after server verification of the Azure user", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session, user: azureUser },
      error: null,
    });
    auth.getUser.mockResolvedValue({
      data: { user: azureUser },
      error: null,
    });

    await expect(
      exchangeCodeForSession("code-123", "flow-456"),
    ).resolves.toMatchObject({ provider: "azure", user: { id: "user-1" } });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("code-123", {
      flowId: "flow-456",
    });
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("ends the issued session when the verified identity is not Azure-backed", async () => {
    const passwordUser = {
      ...azureUser,
      app_metadata: { provider: "email", providers: ["email"] },
    };
    auth.exchangeCodeForSession.mockResolvedValue({
      data: { session, user: azureUser },
      error: null,
    });
    auth.getUser.mockResolvedValue({
      data: { user: passwordUser },
      error: null,
    });
    auth.signOut.mockResolvedValue({ error: null });

    await expect(exchangeCodeForSession("code-123")).rejects.toThrow(
      "Azure-backed SyncAI session",
    );
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("removes single-use callback material but preserves unrelated parameters", () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback/azure?code=once&sb_flow_id=flow&keep=yes#id_token=gone",
    );
    clearAzureADCallbackUrl();

    expect(window.location.pathname).toBe("/auth/callback/azure");
    expect(window.location.search).toBe("?keep=yes");
    expect(window.location.hash).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_SSO_DISABLED_MESSAGE,
  ENTERPRISE_SSO_ENABLED,
  exchangeCodeForSession,
  getAzureADAuthUrl,
  handleAzureADCallback,
  signInWithAzureAD,
} from "./azure-ad";

describe("enterprise federation safety boundary", () => {
  it("keeps incomplete enterprise SSO disabled", () => {
    expect(ENTERPRISE_SSO_ENABLED).toBe(false);
    expect(() => getAzureADAuthUrl()).toThrow(
      ENTERPRISE_SSO_DISABLED_MESSAGE,
    );
  });

  it("fails closed for every initiation and exchange entry point", async () => {
    await expect(signInWithAzureAD()).rejects.toThrow(
      ENTERPRISE_SSO_DISABLED_MESSAGE,
    );
    await expect(exchangeCodeForSession("untrusted-code")).rejects.toThrow(
      ENTERPRISE_SSO_DISABLED_MESSAGE,
    );
    await expect(handleAzureADCallback()).resolves.toBeNull();
  });
});

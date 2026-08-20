import { describe, expect, it } from "vitest";
import {
  buildPasswordRecoveryRedirect,
  isLocalAuthRedirect,
  resolveAuthAppOrigin,
} from "./auth-redirect";

describe("auth redirect resolution", () => {
  it("uses the configured production application URL ahead of runtime origin", () => {
    expect(
      buildPasswordRecoveryRedirect(
        "https://app.syncai.ca",
        "https://preview-abc.vercel.app",
      ),
    ).toBe("https://app.syncai.ca/signin?mode=recovery");
  });

  it("uses runtime origin only when no configured app URL exists", () => {
    expect(
      buildPasswordRecoveryRedirect("", "http://localhost:3000"),
    ).toBe("http://localhost:3000/signin?mode=recovery");
  });

  it("normalizes configured paths back to their origin", () => {
    expect(
      resolveAuthAppOrigin("https://app.syncai.ca/some/path", ""),
    ).toBe("https://app.syncai.ca");
  });

  it("rejects unusable callback configuration", () => {
    expect(() => resolveAuthAppOrigin("not-a-url", "also-not-a-url")).toThrow(
      /No valid SyncAI application URL/,
    );
  });

  it("detects localhost recovery links as a production defect", () => {
    expect(isLocalAuthRedirect("http://localhost:3000/signin?mode=recovery")).toBe(true);
    expect(isLocalAuthRedirect("http://127.0.0.1:3000/signin?mode=recovery")).toBe(true);
    expect(isLocalAuthRedirect("https://app.syncai.ca/signin?mode=recovery")).toBe(false);
  });
});

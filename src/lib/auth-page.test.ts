import { describe, expect, it } from "vitest";
import {
  initialAuthPage,
  pageAfterWorkspaceAuthorization,
  type AuthPage,
} from "./auth-page";

describe("public auth page state", () => {
  it.each(["signin", "signup", "enterprise"] as const)(
    "opens the requested %s surface",
    (page) => {
      expect(initialAuthPage(`?view=${page}`)).toBe(page);
    },
  );

  it.each(["signin", "signup", "enterprise"] as const)(
    "preserves %s when Supabase reports no authorized workspace session",
    (page) => {
      expect(pageAfterWorkspaceAuthorization(page, false)).toBe(page);
    },
  );

  it("demotes a private app page when workspace authorization is lost", () => {
    expect(pageAfterWorkspaceAuthorization("app", false)).toBe("demo");
  });

  it.each<AuthPage>([
    "demo",
    "signin",
    "signup",
    "enterprise",
    "security",
    "privacy",
    "terms",
  ])("promotes %s after canonical workspace authorization", (page) => {
    expect(pageAfterWorkspaceAuthorization(page, true)).toBe("app");
  });
});

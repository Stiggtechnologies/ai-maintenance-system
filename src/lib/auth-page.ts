export type AuthPage =
  | "demo"
  | "signin"
  | "signup"
  | "enterprise"
  | "app"
  | "security"
  | "privacy"
  | "terms";

export function initialAuthPage(search: string): AuthPage {
  const requested = new URLSearchParams(search).get("view");
  return requested === "signin" ||
    requested === "signup" ||
    requested === "enterprise" ||
    requested === "privacy" ||
    requested === "terms" ||
    requested === "security"
    ? requested
    : "demo";
}

/**
 * A missing or unauthorized session may demote the private application, but it
 * must not erase an explicitly selected public auth surface. Supabase emits an
 * INITIAL_SESSION event for signed-out visitors after the first render.
 */
export function pageAfterWorkspaceAuthorization(
  currentPage: AuthPage,
  workspaceAuthorized: boolean,
): AuthPage {
  if (workspaceAuthorized) return "app";
  return currentPage === "app" ? "demo" : currentPage;
}

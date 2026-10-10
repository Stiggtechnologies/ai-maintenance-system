/** Same-origin return policy shared by sign-in and sign-up; no access decision. */
export function safeAuthReturnTo(
  value: string | null,
  origin: string,
  fallback = "/",
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return fallback;
  try {
    const destination = new URL(value, origin);
    if (destination.origin !== origin || destination.pathname === "/signin")
      return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

/** Pure test-only boundary; never permits remote disposable-fixture writes. */
export function requireLocalEndpoint(value: string, port: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Survival browser acceptance requires the disposable local stack",
    );
  }
  return url;
}

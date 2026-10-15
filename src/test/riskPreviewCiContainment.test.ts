import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "scripts/tests/risk-decision-preview-http-smoke.mjs",
  "utf8",
);
const wrapper = readFileSync(
  "scripts/ci-risk-decision-preview-smoke.sh",
  "utf8",
);
// Execute the actual module body with ONLY its process/network boundaries
// substituted. No shell, SQL, connection or fixture token is used by this test.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const execute = new AsyncFunction(
  "assert",
  "spawnSync",
  "process",
  "fetch",
  "console",
  source.replace(/^import[^\n]*\n/gm, ""),
);
function harness(env: Record<string, string>, api = "http://127.0.0.1:54321") {
  const spawn = vi.fn(
    (
      command: string,
      args: readonly string[],
      options: { env?: Record<string, string | undefined> },
    ) => {
      void args;
      void options;
      if (command === "supabase")
        return {
          status: 0,
          stdout: `API_URL="${api}"\nANON_KEY="synthetic-local-key"\n`,
        };
      throw new Error("synthetic SQL boundary reached");
    },
  );
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    void options;
    return {
      status: 200,
      json: async () => ({ access_token: "synthetic-token" }),
    };
  });
  return {
    spawn,
    fetch,
    run: () => execute(assert, spawn, { env }, fetch, { log: vi.fn() }),
  };
}

describe("risk preview qualification remains isolated to disposable CI", () => {
  it("refuses non-CI before subprocess or login", async () => {
    const h = harness({ GITHUB_ACTIONS: "false" });
    await expect(h.run()).rejects.toThrow("CI-only");
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(["PGHOSTADDR", "PGSERVICE", "PGOPTIONS"])(
    "refuses ambient %s before any subprocess/login/write",
    async (name) => {
      const h = harness({
        GITHUB_ACTIONS: "true",
        [name]: "synthetic-connection-override",
      });
      await expect(h.run()).rejects.toThrow(
        "PostgreSQL connection environment",
      );
      expect(h.spawn).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it("refuses a remote API before login or SQL", async () => {
    const h = harness({ GITHUB_ACTIONS: "true" }, "https://example.invalid");
    await expect(h.run()).rejects.toThrow("CI loopback API");
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("cannot follow even a loopback server's redirect with fixture credentials", async () => {
    const h = harness({ GITHUB_ACTIONS: "true" });
    await expect(h.run()).rejects.toThrow("synthetic SQL boundary reached");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    for (const [, options] of h.fetch.mock.calls)
      expect(options.redirect).toBe("error");
  });

  it("runs the initial native SQL with a cleared and explicitly loopback-bound environment", () => {
    expect(wrapper.includes("env -i")).toBe(true);
    expect(wrapper.includes("PGHOSTADDR=127.0.0.1")).toBe(true);
    expect(wrapper.includes("PGOPTIONS='-c search_path=public'")).toBe(true);
  });

  it("uses only controlled PostgreSQL connection settings in the actual module", async () => {
    const h = harness({
      GITHUB_ACTIONS: "true",
      PATH: "/synthetic/bin",
      GITHUB_TOKEN: "synthetic-token-not-for-SQL",
    });
    await expect(h.run()).rejects.toThrow("synthetic SQL boundary reached");
    expect(h.spawn.mock.calls[1][2].env).toEqual({
      PATH: "/synthetic/bin",
      LC_ALL: "C",
      LANG: "C",
      PGPASSWORD: "postgres",
      PGHOSTADDR: "127.0.0.1",
      PGOPTIONS: "-c search_path=public",
      PGSSLMODE: "disable",
    });
  });
});

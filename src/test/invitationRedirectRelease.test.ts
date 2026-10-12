import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const source = readFileSync(
  "scripts/configure-production-auth.mjs",
  "utf8",
).replace(/^#!.*\n/, "");
it("prepares and verifies the exact invitation callback without broadening existing redirects", async () => {
  let configuration: Record<string, unknown> = {
    uri_allow_list: "https://app.example.test/auth/callback/azure",
  };
  const calls: string[] = [];
  const run = runInNewContext(`(async () => { ${source} })()`, {
    process: {
      env: {
        SUPABASE_ACCESS_TOKEN: "synthetic",
        SUPABASE_PROJECT_ID: "synthetic",
        APP_URL: "https://app.example.test",
      },
    },
    console: { warn() {}, log() {} },
    fetch: async (_url: string, options: { method: string; body?: string }) => {
      calls.push(options.method);
      if (options.body)
        configuration = { ...configuration, ...JSON.parse(options.body) };
      return { ok: true, json: async () => configuration };
    },
  });
  await run;
  expect(calls).toEqual(["GET", "PATCH", "GET"]);
  expect(String(configuration.uri_allow_list).split(",")).toEqual([
    "https://app.example.test/auth/callback/azure",
    "https://app.example.test/signin?mode=recovery",
    "https://app.example.test/signin?returnTo=/start",
  ]);
});
it("fails release verification when the provider does not retain the invitation callback", async () => {
  let configuration: Record<string, unknown> = {};
  let reads = 0;
  const run = runInNewContext(`(async () => { ${source} })()`, {
    process: {
      env: {
        SUPABASE_ACCESS_TOKEN: "synthetic",
        SUPABASE_PROJECT_ID: "synthetic",
        APP_URL: "https://app.example.test",
      },
    },
    console: { warn() {}, log() {} },
    fetch: async (_url: string, options: { method: string; body?: string }) => {
      if (options.body) configuration = JSON.parse(options.body);
      if (options.method === "GET" && ++reads > 1)
        configuration.uri_allow_list =
          "https://app.example.test/signin?mode=recovery";
      return { ok: true, json: async () => configuration };
    },
  });
  await expect(run).rejects.toThrow("invitation redirect missing");
});

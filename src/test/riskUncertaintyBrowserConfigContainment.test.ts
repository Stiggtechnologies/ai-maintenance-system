import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const configPath = "playwright.uncertainty.config.ts";
const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
const baseSource = readFileSync("playwright.config.ts", "utf8");
const demoKey = baseSource.match(/const LOCAL_ANON_KEY =\s*"([^"]+)"/)?.[1];
const execute = new Function(
  "createHash",
  "defineConfig",
  "inherited",
  "process",
  source.replace(/^import[^\n]*\n/gm, "").replace("export default", "return"),
);
function probe(
  env: Record<string, string> = { GITHUB_ACTIONS: "true" },
  key = demoKey,
  url = "http://127.0.0.1:54321",
) {
  const inherited = {
    use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },
    retries: 1,
    workers: 1,
    webServer: {
      command: "npx vite --port 5173 --strictPort",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_ANON_KEY: key,
        VITE_ENVIRONMENT: "e2e",
      },
    },
    projects: [
      {
        name: "chromium",
        use: { browserName: "chromium" },
        testIgnore: /legacy-exclusion/,
      },
    ],
  };
  const define = vi.fn((config) => config);
  return {
    define,
    inherited,
    run: () => execute(createHash, define, inherited, { env }),
  };
}
describe("U18 browser configuration qualification before server launch", () => {
  it.each([undefined, "false"])(
    "rejects non-CI %s before config admission",
    (value) => {
      const h = probe(value === undefined ? {} : { GITHUB_ACTIONS: value });
      expect(h.run).toThrow("U18 browser configuration refused");
      expect(h.define).not.toHaveBeenCalled();
    },
  );
  it.each([
    "PGHOSTADDR",
    "PGSERVICE",
    "PGOPTIONS",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "CONTAINER_HOST",
  ])(
    "rejects ambient %s including empty overrides before config admission",
    (name) => {
      for (const value of ["foreign", ""]) {
        const h = probe({ GITHUB_ACTIONS: "true", [name]: value });
        expect(h.run).toThrow("U18 browser configuration refused");
        expect(h.define).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["foreign-key", "", "eyJ.synthetic.service_role", undefined])(
    "rejects a foreign or privileged resolved key %s",
    (key) => {
      const h = probe();
      h.inherited.webServer.env.VITE_SUPABASE_ANON_KEY = key;
      expect(h.run).toThrow("U18 browser configuration refused");
      expect(h.define).not.toHaveBeenCalled();
    },
  );
  it.each([
    "https://customer.invalid",
    "http://localhost:54321",
    "http://127.0.0.1:54321/",
  ])("rejects noncanonical resolved API %s", (url) => {
    const h = probe({ GITHUB_ACTIONS: "true" }, demoKey, url);
    expect(h.run).toThrow("U18 browser configuration refused");
    expect(h.define).not.toHaveBeenCalled();
  });
  it("admits only the inherited local demo configuration, preserving the other suites", () => {
    const h = probe();
    const result = h.run();
    expect(result.webServer).toEqual(h.inherited.webServer);
    expect(result.retries).toBe(1);
    expect(result.workers).toBe(1);
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]).toEqual({
      ...h.inherited.projects[0],
      testIgnore: [/legacy-exclusion/, "**/risk-uncertainty.spec.ts"],
    });
    expect(result.projects[1]).toEqual({
      name: "u18-chromium",
      testMatch: "**/risk-uncertainty.spec.ts",
      outputDir: "test-results-private/u18",
      use: {
        browserName: "chromium",
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    });
  });
  it("wires this preflight into the actual CI invocation and excludes private diagnostics from upload", () => {
    const e2e = readFileSync(".github/workflows/ci.yml", "utf8").split(
      "\n  e2e:",
    )[1];
    expect(e2e).toContain("--config playwright.uncertainty.config.ts");
    const upload = e2e
      .split("- name: Upload Playwright artifacts")[1]
      ?.split("- name: Stop Supabase")[0];
    expect(upload).toContain("path: test-results/");
    expect(upload).not.toContain("test-results-private");
  });
  it("refuses default/uncontained projects before U18 fixtures or authentication and disables token-bearing diagnostics locally", () => {
    const spec = readFileSync("tests/e2e/risk-uncertainty.spec.ts", "utf8");
    expect(spec).toContain(
      'test.use({ trace: "off", video: "off", screenshot: "off" })',
    );
    const guard =
      spec
        .split("test.beforeAll(")[1]
        ?.split("// Actual disposable-browser witness")[0] ?? "";
    expect(guard).toContain('testInfo.project.name).toBe("u18-chromium")');
    expect(guard).toContain("resolve(testInfo.project.outputDir)");
    expect(guard).toContain('resolve("test-results-private/u18")');
    for (const setting of ["trace", "video", "screenshot"])
      expect(guard).toContain(`testInfo.project.use.${setting}).toBe("off")`);
    expect(spec.indexOf("test.beforeAll(")).toBeLessThan(
      spec.indexOf("function sql("),
    );
  });
  it("executes the actual spec admission guard against default, wrong-output and diagnostic-enabled projects", async () => {
    const spec = readFileSync("tests/e2e/risk-uncertainty.spec.ts", "utf8");
    const guard = spec
      .split("test.beforeAll(async ({ browserName }, testInfo) => {")[1]
      ?.split("});\n\n// Actual disposable-browser witness")[0];
    expect(guard).toBeDefined();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const admit = new AsyncFunction(
      "expect",
      "testInfo",
      "browserName",
      "resolve",
      guard,
    );
    const project = {
      name: "u18-chromium",
      outputDir: resolve("test-results-private/u18"),
      use: { trace: "off", video: "off", screenshot: "off" },
    };
    await expect(
      admit(expect, { project }, "chromium", resolve),
    ).resolves.toBeUndefined();
    await expect(
      admit(expect, { project }, "firefox", resolve),
    ).rejects.toThrow();
    for (const wrong of [
      { ...project, name: "chromium" },
      { ...project, outputDir: "/synthetic/test-results/u18" },
      {
        ...project,
        outputDir: resolve("test-results/nested/test-results-private/u18"),
      },
      { ...project, outputDir: "/alternate-root/test-results-private/u18" },
      ...["trace", "video", "screenshot"].map((setting) => ({
        ...project,
        use: { ...project.use, [setting]: "on" },
      })),
    ])
      await expect(
        admit(expect, { project: wrong }, "chromium", resolve),
      ).rejects.toThrow();
  });
});

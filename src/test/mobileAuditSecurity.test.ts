// @vitest-environment node
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright", () => ({ chromium: { launch: harness.launch } }));
import {
  createAuditOutput,
  runMobileAudit,
  writeAuditArtifact,
} from "../../scripts/mobile-audit.mjs";

const directories: string[] = [];
const env = {
  DEMO_EMAIL: "audit@example.invalid",
  DEMO_PASSWORD: "test-only-not-a-real-credential",
};

function mockBrowser({
  authFails = false,
  redirect = false,
  status = 200,
  screenshotFails = false,
  contextCloseFails = false,
  browserCloseFails = false,
} = {}) {
  let url = "https://app.syncai.ca/signin";
  const page = {
    goto: vi.fn(async (destination: string) => {
      url =
        redirect && !destination.endsWith("/signin")
          ? "https://app.syncai.ca/signin"
          : destination;
      return { status: () => status };
    }),
    getByRole: vi.fn((_role: string, options: { name: RegExp }) => ({
      fill: vi.fn(),
      click: vi.fn(async () => {
        if (/access syncai/i.test(options.name.source))
          url = "https://app.syncai.ca/mission-control";
      }),
    })),
    locator: vi.fn(() => ({ fill: vi.fn() })),
    waitForURL: vi.fn(async () => {
      if (authFails)
        throw new Error("private auth diagnostic must not be reported");
    }),
    waitForLoadState: vi.fn(),
    waitForTimeout: vi.fn(),
    url: () => url,
    evaluate: vi.fn(async () => ({ overflow: 0, wide: [], clipped: [] })),
    screenshot: vi.fn(async (options: { fullPage: boolean }) => {
      expect(options).toEqual({ fullPage: false });
      if (screenshotFails) throw new Error("private screenshot diagnostic");
      return Buffer.from("synthetic-png-not-customer-data");
    }),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {
      if (contextCloseFails)
        throw new Error(`private cleanup diagnostic ${env.DEMO_PASSWORD}`);
    }),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {
      if (browserCloseFails)
        throw new Error(`private cleanup diagnostic ${env.DEMO_PASSWORD}`);
    }),
  };
  harness.launch.mockResolvedValue(browser);
  return { page, context, browser };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("mobile audit private artifacts and honest execution", () => {
  it("allocates distinct owner-only directories, not a shared predictable output", () => {
    const first = createAuditOutput();
    const second = createAuditOutput();
    directories.push(first, second);
    expect(first).not.toBe(second);
    expect(statSync(first).mode & 0o777).toBe(0o700);
    expect(statSync(second).mode & 0o777).toBe(0o700);
  });

  it("creates artifacts owner-only and refuses to overwrite any existing artifact", () => {
    const directory = createAuditOutput();
    directories.push(directory);
    writeAuditArtifact(directory, "index.png", Buffer.from("first"));
    expect(statSync(join(directory, "index.png")).mode & 0o777).toBe(0o600);
    expect(() =>
      writeAuditArtifact(directory, "index.png", Buffer.from("second")),
    ).toThrow();
    expect(readFileSync(join(directory, "index.png"), "utf8")).toBe("first");
  });

  it("refuses a planted artifact symlink without modifying its target", () => {
    const directory = createAuditOutput();
    const fixture = mkdtempSync(join(tmpdir(), "syncai-mobile-audit-target-"));
    directories.push(directory, fixture);
    const target = join(fixture, "target.json");
    writeFileSync(target, "untouched", { mode: 0o600 });
    symlinkSync(target, join(directory, "mobile-audit-report.json"));
    expect(() =>
      writeAuditArtifact(directory, "mobile-audit-report.json", "replacement"),
    ).toThrow();
    expect(readFileSync(target, "utf8")).toBe("untouched");
  });

  it.each([
    "../outside.png",
    "/absolute.png",
    "nested/file.png",
    "..\\outside.png",
    "report.html",
  ])("refuses unsafe or unsupported artifact name %s", (name) => {
    const directory = createAuditOutput();
    directories.push(directory);
    expect(() => writeAuditArtifact(directory, name, "blocked")).toThrow();
    expect(readdirSync(directory)).toEqual([]);
  });

  it.each([
    {},
    { DEMO_EMAIL: env.DEMO_EMAIL },
    { DEMO_PASSWORD: env.DEMO_PASSWORD },
  ])(
    "requires explicit credentials before launching a browser or producing artifacts",
    async (missing) => {
      await expect(
        runMobileAudit({ env: missing, log: vi.fn() }),
      ).rejects.toThrow("DEMO_EMAIL and DEMO_PASSWORD are required");
      expect(harness.launch).not.toHaveBeenCalled();
    },
  );

  it("captures every declared route in a private directory with no page-path writes", async () => {
    const { page, context, browser } = mockBrowser();
    const result = await runMobileAudit({ env, log: vi.fn() });
    directories.push(result.directory);
    expect(result.report).toHaveLength(49);
    expect(result.report.every((row) => row.verdict === "PASS")).toBe(true);
    expect(page.screenshot).toHaveBeenCalledTimes(49);
    expect(
      page.screenshot.mock.calls.every(
        ([options]) => !Object.hasOwn(options, "path"),
      ),
    ).toBe(true);
    for (const name of readdirSync(result.directory))
      expect(statSync(join(result.directory, name)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(result.reportPath, "utf8"))).toEqual(
      result.report,
    );
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("refuses to audit signed-out pages when authentication does not complete", async () => {
    const { page, context, browser } = mockBrowser({ authFails: true });
    const log = vi.fn();
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message: string) => {
          log(message);
          if (message.startsWith("artifacts: ")) {
            directory = message.slice(11);
            directories.push(directory);
          }
        },
      }),
    ).rejects.toThrow("Mobile audit did not complete");
    expect(page.screenshot).not.toHaveBeenCalled();
    const report = JSON.parse(
      readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
    );
    expect(report).toEqual([
      {
        route: "/signin",
        verdict: "AUTH_FAIL",
        note: "Demo sign-in did not reach the authenticated workspace",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("private auth diagnostic");
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("reports redirected routes instead of claiming a signed-out page passed", async () => {
    const { page } = mockBrowser({ redirect: true });
    const result = await runMobileAudit({ env, log: vi.fn() });
    directories.push(result.directory);
    expect(result.report).toHaveLength(49);
    expect(
      result.report.every(
        (row) => row.verdict === "REDIRECTED" && row.finalPath === "/signin",
      ),
    ).toBe(true);
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("does not claim HTTP-error surfaces passed", async () => {
    const { page } = mockBrowser({ status: 404 });
    const result = await runMobileAudit({ env, log: vi.fn() });
    directories.push(result.directory);
    expect(
      result.report.every(
        (row) => row.verdict === "HTTP_FAIL" && row.httpStatus === 404,
      ),
    ).toBe(true);
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it("retains a bounded failed report and closes resources when screenshot capture fails", async () => {
    const { context, browser } = mockBrowser({ screenshotFails: true });
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message: string) => {
          if (message.startsWith("artifacts: ")) {
            directory = message.slice(11);
            directories.push(directory);
          }
        },
      }),
    ).rejects.toThrow("Mobile audit did not complete");
    expect(
      JSON.parse(
        readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
      ),
    ).toEqual([
      {
        route: "/",
        verdict: "AUDIT_FAIL",
        note: "Route inspection or artifact capture failed",
      },
    ]);
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it.each([
    { contextCloseFails: true },
    { browserCloseFails: true },
    { contextCloseFails: true, browserCloseFails: true },
  ])(
    "sanitizes cleanup failures and records that the audit did not complete: %j",
    async (failure) => {
      const { context, browser } = mockBrowser(failure);
      let directory = "";
      await expect(
        runMobileAudit({
          env,
          log: (message: string) => {
            if (message.startsWith("artifacts: ")) {
              directory = message.slice(11);
              directories.push(directory);
            }
          },
        }),
      ).rejects.toThrow(
        "Mobile audit did not complete; inspect the private report",
      );
      const report = JSON.parse(
        readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
      );
      expect(report).toHaveLength(50);
      expect(report.at(-1)).toEqual({
        route: "/setup",
        verdict: "AUDIT_FAIL",
        note: "Browser resource cleanup failed",
      });
      expect(JSON.stringify(report)).not.toContain(
        "private cleanup diagnostic",
      );
      expect(JSON.stringify(report)).not.toContain(env.DEMO_PASSWORD);
      expect(context.close).toHaveBeenCalledOnce();
      expect(browser.close).toHaveBeenCalledOnce();
    },
  );

  it("sanitizes report write failure, preserves a planted target and still closes both resources", async () => {
    const { context, browser } = mockBrowser();
    const fixture = mkdtempSync(join(tmpdir(), "syncai-mobile-audit-target-"));
    directories.push(fixture);
    const target = join(fixture, "target.json");
    writeFileSync(target, "untouched", { mode: 0o600 });
    await expect(
      runMobileAudit({
        env,
        log: (message: string) => {
          if (message.startsWith("artifacts: ")) {
            const directory = message.slice(11);
            directories.push(directory);
            symlinkSync(target, join(directory, "mobile-audit-report.json"));
          }
        },
      }),
    ).rejects.toThrow(
      "Mobile audit did not complete; private report could not be saved",
    );
    expect(readFileSync(target, "utf8")).toBe("untouched");
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });
});

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
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ launch: vi.fn() }));
const setupFault = vi.hoisted(() => ({
  allocation: false,
  permission: false,
  directory: "",
}));
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdtempSync: (...args: Parameters<typeof actual.mkdtempSync>) => {
      if (setupFault.allocation)
        throw new Error(
          "private allocation diagnostic /private-sensitive-path",
        );
      const directory = actual.mkdtempSync(...args);
      setupFault.directory = String(directory);
      return directory;
    },
    chmodSync: (...args: Parameters<typeof actual.chmodSync>) => {
      if (setupFault.permission)
        throw new Error(`private permission diagnostic ${args[0]}`);
      return actual.chmodSync(...args);
    },
  };
});
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
  setupFault.allocation = false;
  setupFault.permission = false;
  setupFault.directory = "";
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("mobile audit private artifacts and honest execution", () => {
  it("sanitizes output allocation failure before attempting authentication or promising a report", async () => {
    setupFault.allocation = true;
    const log = vi.fn();
    await expect(runMobileAudit({ env, log })).rejects.toThrow(
      "Mobile audit did not start; no private output was established",
    );
    expect(log).not.toHaveBeenCalled();
    expect(harness.launch).not.toHaveBeenCalled();
  });

  it("retains an allocated directory on permission failure without claiming a safely established report", async () => {
    setupFault.permission = true;
    const failure = await runMobileAudit({ env, log: vi.fn() }).catch(
      (error: unknown) => error,
    );
    directories.push(setupFault.directory);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Mobile audit did not start; no private output was established",
    );
    expect(statSync(setupFault.directory).isDirectory()).toBe(true);
    expect(readdirSync(setupFault.directory)).toEqual([]);
    expect(harness.launch).not.toHaveBeenCalled();
  });

  it("sanitizes initial output notification and records SETUP_FAIL rather than an unattempted AUTH_FAIL", async () => {
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message) => {
          if (message.startsWith("artifacts: ")) {
            directory = message.slice(11);
            directories.push(directory);
          }
          throw new Error(
            `private notification diagnostic ${directory} ${env.DEMO_PASSWORD}`,
          );
        },
      }),
    ).rejects.toThrow(
      "Mobile audit did not complete; private report saved but output notification failed",
    );
    expect(harness.launch).not.toHaveBeenCalled();
    const report = JSON.parse(
      readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
    );
    expect(report).toEqual([
      {
        route: "/signin",
        verdict: "SETUP_FAIL",
        note: "Audit output notification failed before sign-in was attempted",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(directory);
    expect(JSON.stringify(report)).not.toContain(env.DEMO_PASSWORD);
    expect(
      statSync(join(directory, "mobile-audit-report.json")).mode & 0o777,
    ).toBe(0o600);
  });

  it("records final notification failure before the exclusive report write and closes both resources", async () => {
    const { context, browser } = mockBrowser();
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message) => {
          if (message.startsWith("artifacts: ")) {
            directory = message.slice(11);
            directories.push(directory);
          }
          if (message.startsWith("report target: "))
            throw new Error(`private final notification ${env.DEMO_PASSWORD}`);
        },
      }),
    ).rejects.toThrow(
      "Mobile audit did not complete; private report saved but output notification failed",
    );
    const report = JSON.parse(
      readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
    );
    expect(report).toHaveLength(50);
    expect(report.at(-1)).toEqual({
      route: "/setup",
      verdict: "AUDIT_FAIL",
      note: "Audit output notification failed",
    });
    expect(JSON.stringify(report)).not.toContain(env.DEMO_PASSWORD);
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("classifies browser launch failure before sign-in as SETUP_FAIL and sanitizes its diagnostic", async () => {
    harness.launch.mockRejectedValue(
      new Error(`private browser startup ${env.DEMO_PASSWORD}`),
    );
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message) => {
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
    expect(report).toEqual([
      {
        route: "/signin",
        verdict: "SETUP_FAIL",
        note: "Audit setup failed before sign-in was attempted",
      },
    ]);
  });

  it("attempts both closures when page setup and cleanup fail before authentication", async () => {
    const { context, browser } = mockBrowser({
      contextCloseFails: true,
      browserCloseFails: true,
    });
    context.newPage.mockRejectedValue(
      new Error(`private page startup ${env.DEMO_PASSWORD}`),
    );
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message) => {
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
    expect(report).toEqual([
      {
        route: "/signin",
        verdict: "SETUP_FAIL",
        note: "Audit setup failed before sign-in was attempted",
      },
      {
        route: "/signin",
        verdict: "AUDIT_FAIL",
        note: "Browser resource cleanup failed",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain(env.DEMO_PASSWORD);
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("sanitizes a route notification failure, aborts the sweep, and attempts both closures", async () => {
    const { page, context, browser } = mockBrowser();
    let directory = "";
    await expect(
      runMobileAudit({
        env,
        log: (message) => {
          if (message.startsWith("artifacts: ")) {
            directory = message.slice(11);
            directories.push(directory);
          } else
            throw new Error(`private route notification ${env.DEMO_PASSWORD}`);
        },
      }),
    ).rejects.toThrow(
      "Mobile audit did not complete; private report saved but output notification failed",
    );
    const report = JSON.parse(
      readFileSync(join(directory, "mobile-audit-report.json"), "utf8"),
    );
    expect(report).toHaveLength(2);
    expect(report.at(-1)).toEqual({
      route: "/",
      verdict: "AUDIT_FAIL",
      note: "Audit output notification failed",
    });
    expect(page.screenshot).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain(env.DEMO_PASSWORD);
    expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("sanitizes option getter failures inside the orchestrator without creating output", async () => {
    await expect(
      runMobileAudit({
        get env(): typeof env {
          throw new Error("private option diagnostic");
        },
      }),
    ).rejects.toThrow(
      "Mobile audit did not start; no private output was established",
    );
    expect(harness.launch).not.toHaveBeenCalled();
  });

  it.each(["allocation", "permission", "notification"])(
    "actual CLI refuses %s startup faults with no raw diagnostic or credentials",
    (fault) => {
      const fixture = mkdtempSync(join(tmpdir(), "syncai-mobile-cli-fixture-"));
      directories.push(fixture);
      const script = join(process.cwd(), "scripts/mobile-audit.mjs");
      const childEnv = {
        PATH: process.env.PATH,
        TMPDIR:
          fault === "allocation"
            ? join(fixture, "nonexistent-private-temp")
            : fixture,
        DEMO_EMAIL: env.DEMO_EMAIL,
        DEMO_PASSWORD: env.DEMO_PASSWORD,
      };
      const code = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { pathToFileURL } from 'node:url';
      if (${JSON.stringify(fault)} === 'permission') {
        fs.chmodSync = () => { throw new Error('private CLI permission diagnostic /private-sensitive-path'); };
        syncBuiltinESMExports();
      }
      if (${JSON.stringify(fault)} === 'notification')
        console.log = () => { throw new Error('private CLI notification diagnostic /private-sensitive-path'); };
      process.argv[1] = ${JSON.stringify(script)};
      await import(pathToFileURL(process.argv[1]).href);
    `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        {
          cwd: process.cwd(),
          env: childEnv,
          encoding: "utf8",
          timeout: 10_000,
          maxBuffer: 8192,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        fault === "notification"
          ? "private report saved but output notification failed"
          : "no private output was established",
      );
      expect(result.stderr).not.toContain(fixture);
      expect(result.stderr).not.toContain("private CLI");
      expect(result.stderr).not.toContain("private-sensitive-path");
      expect(result.stderr).not.toContain(env.DEMO_PASSWORD);
      if (fault !== "allocation") {
        const [allocated] = readdirSync(fixture);
        const retained = join(fixture, allocated);
        expect(statSync(retained).mode & 0o777).toBe(0o700);
        if (fault === "permission") expect(readdirSync(retained)).toEqual([]);
        else
          expect(
            JSON.parse(
              readFileSync(join(retained, "mobile-audit-report.json"), "utf8"),
            ),
          ).toMatchObject([{ verdict: "SETUP_FAIL" }]);
      }
    },
  );

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
